import asyncio
import base64
import binascii
from typing import Any, Dict, List, Optional, Literal, Tuple
import mimetypes
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import json
import re
import os
from datetime import datetime

from app.api import upload, llm, skills, users, datasources, projects, semantic
from app.connectors.postgres import postgres_connector
from app.connectors.clickhouse import clickhouse_connector
from app.core.artifacts import extract_artifacts
from app.core.files import ensure_artifact_access, resolve_artifact_target
from app.core.nanobot import nanobot_service
from app.core.session_alias_store import session_alias_store
from app.context import current_session_id, current_progress_callback, current_viz_data, current_data_source, current_file_url
from app.database import engine, Base
# Import all models to ensure they are registered
from app.models.user import User
from app.models.project import Project
from app.models.datasource import DataSource

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database tables
Base.metadata.create_all(bind=engine)

# Mount static directory for reports
data_dir = os.path.join(os.path.dirname(__file__), "data", "data")
os.makedirs(data_dir, exist_ok=True)
app.mount("/reports", StaticFiles(directory=data_dir), name="reports")

app.include_router(upload.router, prefix="/api/v1")
app.include_router(llm.router, prefix="/api/v1")
app.include_router(skills.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(projects.router, prefix="/api/v1")
app.include_router(datasources.router, prefix="/api/v1")
app.include_router(semantic.router, prefix="/api/v1")

STREAM_DELTA_CHUNK_SIZE = 48
PREVIEWABLE_TEXT_EXTENSIONS = {
    ".txt",
    ".md",
    ".json",
    ".csv",
    ".tsv",
    ".yaml",
    ".yml",
    ".xml",
    ".log",
}

@app.on_event("startup")
async def startup_event():
    # Initialize nanobot in background
    try:
        await nanobot_service.start()
    except Exception as e:
        print(f"Nanobot startup failed: {e}")

@app.on_event("shutdown")
async def shutdown_event():
    await nanobot_service.stop()

@app.get("/")
def read_root():
    return {"Hello": "DataClaw Backend"}

@app.get("/connect/postgres")
def test_postgres():
    if postgres_connector.test_connection():
        return {"status": "success", "message": "Connected to PostgreSQL"}
    raise HTTPException(status_code=500, detail="Failed to connect to PostgreSQL")

@app.get("/connect/clickhouse")
def test_clickhouse():
    if clickhouse_connector.test_connection():
        return {"status": "success", "message": "Connected to ClickHouse"}
    raise HTTPException(status_code=500, detail="Failed to connect to ClickHouse")

@app.get("/nanobot/status")
def nanobot_status():
    if nanobot_service.agent:
        return {"status": "running", "model": nanobot_service.agent.model}
    return {"status": "stopped"}


def _guess_mime_type(path: os.PathLike[str] | str) -> str:
    mime_type, _ = mimetypes.guess_type(str(path))
    return mime_type or "application/octet-stream"


def _resolve_checked_target(target: str) -> os.PathLike[str]:
    path = resolve_artifact_target(target)
    if path is None:
        raise HTTPException(status_code=404, detail="目标文件不存在")
    try:
        return ensure_artifact_access(path, require_file=True)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="目标文件不存在")
    except PermissionError:
        raise HTTPException(status_code=403, detail="非法路径访问")


def _is_previewable(path: os.PathLike[str], mime_type: str) -> bool:
    suffix = os.path.splitext(str(path))[1].lower()
    if suffix in {".html", ".htm", ".pdf", ".pptx"}:
        return True
    if suffix in PREVIEWABLE_TEXT_EXTENSIONS:
        return True
    return mime_type.startswith("image/") or mime_type.startswith("text/")


def _encode_web_root(path: Path) -> str:
    return base64.urlsafe_b64encode(str(path).encode("utf-8")).decode("utf-8").rstrip("=")


def _decode_web_root(token: str) -> Path:
    padding = "=" * (-len(token) % 4)
    try:
        decoded = base64.urlsafe_b64decode((token + padding).encode("utf-8")).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="非法预览目录标识")
    return Path(decoded)


@app.get("/nanobot/artifacts/download")
def download_artifact(target: str = Query(...)):
    resolved = _resolve_checked_target(target)
    return FileResponse(
        path=str(resolved),
        media_type="application/octet-stream",
        filename=os.path.basename(str(resolved)),
    )


@app.get("/nanobot/artifacts/preview")
def preview_artifact(target: str = Query(...)):
    resolved = _resolve_checked_target(target)
    mime_type = _guess_mime_type(resolved)
    if not _is_previewable(resolved, mime_type):
        raise HTTPException(status_code=415, detail="当前文件类型不支持预览，请使用下载")
    suffix = os.path.splitext(str(resolved))[1].lower()
    if suffix in {".html", ".htm"}:
        root_token = _encode_web_root(Path(resolved).parent)
        entry = Path(resolved).name
        return RedirectResponse(url=f"/nanobot/artifacts/web/{root_token}/{entry}", status_code=307)
    return FileResponse(
        path=str(resolved),
        media_type=mime_type,
        filename=os.path.basename(str(resolved)),
        content_disposition_type="inline",
    )


@app.get("/nanobot/artifacts/web/{root_token}/{resource_path:path}")
def preview_web_artifact_resource(root_token: str, resource_path: str):
    root_dir = _decode_web_root(root_token)
    try:
        safe_root = ensure_artifact_access(root_dir, require_file=False)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Web 预览目录不存在")
    except PermissionError:
        raise HTTPException(status_code=403, detail="非法路径访问")
    candidate = os.path.join(str(safe_root), resource_path)
    try:
        resolved = ensure_artifact_access(Path(candidate), require_file=True)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Web 资源不存在")
    except PermissionError:
        raise HTTPException(status_code=403, detail="非法路径访问")
    if not Path(resolved).is_relative_to(Path(safe_root)):
        raise HTTPException(status_code=403, detail="非法路径访问")
    return FileResponse(
        path=str(resolved),
        media_type=_guess_mime_type(resolved),
        filename=os.path.basename(str(resolved)),
        content_disposition_type="inline",
    )

class ChatRequest(BaseModel):
    message: str
    session_id: str = "api:default"
    skill_ids: Optional[List[str]] = None
    model_id: Optional[str] = None
    source: str = "postgres"
    prefer_sql_chart: bool = False
    file_url: Optional[str] = None
    route_mode: Literal["auto", "chat", "sql"] = "auto"


def _session_context_for_routing(session_id: str) -> Dict[str, Any]:
    if not nanobot_service.agent:
        return {}
    session = nanobot_service.agent.sessions.get_or_create(session_id)
    return session.metadata or {}

def _resolve_effective_source(request: ChatRequest) -> str:
    session_ctx = _session_context_for_routing(request.session_id)
    session_source = (session_ctx.get("selected_data_source") or "").strip().lower()
    request_source = (request.source or "").strip().lower()
    
    effective_source = request_source
    if session_source.startswith("ds:") or session_source == "upload":
        effective_source = session_source
    return effective_source

class SessionAliasUpdateRequest(BaseModel):
    title: Optional[str] = None
    pinned: Optional[bool] = None
    archived: Optional[bool] = None
    project_id: Optional[int] = None


class BatchDeleteRequest(BaseModel):
    session_ids: List[str]


class SessionFileContextUpdateRequest(BaseModel):
    active_data_file: Optional[Dict[str, Any]] = None
    selected_data_source: Optional[str] = None


def _persist_assistant_enrichment(
    session_id: str,
    viz_payload: Optional[Dict[str, Any]] = None,
    artifacts: Optional[List[Dict[str, Any]]] = None,
) -> None:
    if not nanobot_service.agent:
        return
    session = nanobot_service.agent.sessions.get_or_create(session_id)
    if not session.messages or session.messages[-1].get("role") != "assistant":
        return
    changed = False
    if viz_payload:
        session.messages[-1]["viz"] = viz_payload
        changed = True
    if artifacts:
        session.messages[-1]["artifacts"] = artifacts
        changed = True
    if changed:
        nanobot_service.agent.sessions.save(session)

@app.post("/nanobot/chat")
async def nanobot_chat(request: ChatRequest):
    try:
        resolved_source = _resolve_effective_source(request)
        current_data_source.set(resolved_source)
        current_file_url.set(request.file_url)
        current_session_id.set(request.session_id)
        current_viz_data.set({})

        # Inject instructions if explicitly routed
        message = request.message
        if request.route_mode == "sql" or request.prefer_sql_chart:
            message = f"[System: Use the nl2sql tool to answer the query]\n{message}"
        elif request.route_mode == "chat":
            message = f"[System: Normal chat mode. Do NOT use the nl2sql tool]\n{message}"

        # Inject instructions for selected skills
        if request.skill_ids:
            skill_list = ", ".join(request.skill_ids)
            message = f"[System: You must prioritize using the following skills/tools to answer the user's request: {skill_list}]\n{message}"

        response = await nanobot_service.process_message(
            message,
            session_id=request.session_id,
            skill_ids=request.skill_ids,
            model_id=request.model_id,
        )
        text = response or ""
        session_messages = []
        if nanobot_service.agent:
            session = nanobot_service.agent.sessions.get_or_create(request.session_id)
            session_messages = session.messages
        artifacts = extract_artifacts(text, session_messages)

        viz_payload = current_viz_data.get()
        _persist_assistant_enrichment(
            session_id=request.session_id,
            viz_payload=viz_payload if isinstance(viz_payload, dict) else None,
            artifacts=artifacts,
        )

        payload = {
            "response": text,
            "viz": viz_payload,
            "routing": {"selected": "agent", "reason": "auto_routed_by_agent"},
        }
        if artifacts:
            payload["artifacts"] = artifacts
        return payload
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

from app.core.streaming_provider import streaming_queue_var

@app.post("/nanobot/chat/stream")
async def nanobot_chat_stream(request: ChatRequest):
    async def event_generator():
        current_task = None
        try:
            resolved_source = _resolve_effective_source(request)
            current_data_source.set(resolved_source)
            current_file_url.set(request.file_url)
            current_session_id.set(request.session_id)
            current_viz_data.set({})

            yield f"data: {json.dumps({'type': 'routing', 'selected': 'agent', 'reason': 'auto_routed_by_agent'}, ensure_ascii=False)}\n\n"
            
            progress_queue: asyncio.Queue[str] = asyncio.Queue()
            # 设置 streaming_queue_var 为当前请求的 progress_queue
            streaming_queue_var.set(progress_queue)

            async def _on_progress(content: str, **kwargs: Any) -> None:
                if content:
                    await progress_queue.put(content)

            current_progress_callback.set(_on_progress)

            # Inject instructions if explicitly routed
            message = request.message
            if request.route_mode == "sql" or request.prefer_sql_chart:
                message = f"[System: Use the nl2sql tool to answer the query]\n{message}"
            elif request.route_mode == "chat":
                message = f"[System: Normal chat mode. Do NOT use the nl2sql tool]\n{message}"

            # Inject instructions for selected skills
            if request.skill_ids:
                skill_list = ", ".join(request.skill_ids)
                message = f"[System: You must prioritize using the following skills/tools to answer the user's request: {skill_list}]\n{message}"

            current_task = asyncio.create_task(
                nanobot_service.process_message(
                    message,
                    session_id=request.session_id,
                    skill_ids=request.skill_ids,
                    model_id=request.model_id,
                    on_progress=_on_progress,
                )
            )
            
            text = ""
            last_viz_hash = None

            while True:
                # Check for viz payload during processing
                viz_payload = current_viz_data.get()
                if viz_payload:
                    try:
                        # Only hash sql and chart to avoid dumping large result arrays every 0.2s
                        current_hash = hash((
                            viz_payload.get("sql"), 
                            viz_payload.get("error"),
                            json.dumps(viz_payload.get("chart"), sort_keys=True)
                        ))
                        if current_hash != last_viz_hash:
                            yield f"data: {json.dumps({'type': 'viz', **viz_payload}, ensure_ascii=False)}\n\n"
                            last_viz_hash = current_hash
                    except Exception as e:
                        print(f"Error checking viz_payload: {e}")

                if current_task.done() and progress_queue.empty():
                    break
                try:
                    progress = await asyncio.wait_for(progress_queue.get(), timeout=0.2)
                    if isinstance(progress, dict):
                        yield f"data: {json.dumps(progress, ensure_ascii=False)}\n\n"
                    else:
                        yield f"data: {json.dumps({'type': 'progress', 'content': progress}, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue

            response = await current_task
            text = response or ""
            session_messages = []
            if nanobot_service.agent:
                session = nanobot_service.agent.sessions.get_or_create(request.session_id)
                session_messages = session.messages
            artifacts = extract_artifacts(text, session_messages)

            # Check again for viz payload after task completes if not sent yet
            viz_payload = current_viz_data.get()
            if viz_payload:
                try:
                    current_hash = hash((
                        viz_payload.get("sql"), 
                        viz_payload.get("error"),
                        json.dumps(viz_payload.get("chart"), sort_keys=True)
                    ))
                    if current_hash != last_viz_hash:
                        yield f"data: {json.dumps({'type': 'viz', **viz_payload}, ensure_ascii=False)}\n\n"
                        last_viz_hash = current_hash
                except Exception as e:
                    pass

            _persist_assistant_enrichment(
                session_id=request.session_id,
                viz_payload=viz_payload if isinstance(viz_payload, dict) else None,
                artifacts=artifacts,
            )
            
            # Since true streaming is enabled via StreamingLiteLLMProvider, 
            # we no longer need to chunk and yield `text` here.
            # Just yield the final text to signal completion and update final state.
            final_payload = {"type": "final", "content": text}
            if artifacts:
                final_payload["artifacts"] = artifacts
            yield f"data: {json.dumps(final_payload, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
        except asyncio.CancelledError:
            raise
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
        finally:
            if current_task and not current_task.done():
                current_task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

@app.get("/nanobot/sessions")
def get_sessions(project_id: Optional[int] = None):
    if not nanobot_service.agent:
        return session_alias_store.list_cached_sessions(project_id=project_id)
    sessions = nanobot_service.agent.sessions.list_sessions()
    return session_alias_store.sync_and_list(sessions, project_id=project_id)

@app.get("/nanobot/sessions/{session_id}")
def get_session(session_id: str):
    if not nanobot_service.agent:
        raise HTTPException(status_code=400, detail="Nanobot not running")
    session = nanobot_service.agent.sessions.get_or_create(session_id)
    alias = session_alias_store.get_alias(session_id)
    return {
        "key": session.key,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
        "metadata": session.metadata,
        "alias": alias,
        "messages": session.messages
    }

class EnsureSessionRequest(BaseModel):
    project_id: Optional[int] = None

@app.post("/nanobot/sessions/{session_id}/ensure")
def ensure_session(session_id: str, request: EnsureSessionRequest = EnsureSessionRequest()):
    if not nanobot_service.agent:
        raise HTTPException(status_code=400, detail="Nanobot not running")
    session = nanobot_service.agent.sessions.get_or_create(session_id)
    nanobot_service.agent.sessions.save(session)
    
    # Save project_id to the alias store immediately upon creation
    if request.project_id is not None:
        session_alias_store.update_alias_meta(
            session_key=session_id,
            project_id=request.project_id
        )
        
    alias = session_alias_store.get_alias(session_id)
    return {
        "key": session.key,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
        "metadata": session.metadata,
        "alias": alias,
        "project_id": request.project_id
    }

@app.delete("/nanobot/sessions/{session_id}")
def delete_session(session_id: str):
    if not nanobot_service.agent:
        raise HTTPException(status_code=400, detail="Nanobot not running")
    
    # Try to remove from cache and delete file
    session = nanobot_service.agent.sessions.get_or_create(session_id)
    if session:
        nanobot_service.agent.sessions.invalidate(session_id)
        path = nanobot_service.agent.sessions._get_session_path(session_id)
        if path.exists():
            path.unlink()
        session_alias_store.delete_session(session_id)
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Session not found")


@app.post("/nanobot/sessions/batch-delete")
def batch_delete_sessions(request: BatchDeleteRequest):
    if not nanobot_service.agent:
        raise HTTPException(status_code=400, detail="Nanobot not running")
    
    deleted_ids = []
    for session_id in request.session_ids:
        try:
            # Try to remove from cache and delete file
            session = nanobot_service.agent.sessions.get_or_create(session_id)
            if session:
                nanobot_service.agent.sessions.invalidate(session_id)
                path = nanobot_service.agent.sessions._get_session_path(session_id)
                if path.exists():
                    path.unlink()
                session_alias_store.delete_session(session_id)
                deleted_ids.append(session_id)
        except Exception as e:
            print(f"Failed to delete session {session_id}: {e}")
    
    return {"status": "success", "deleted_count": len(deleted_ids), "deleted_ids": deleted_ids}


@app.put("/nanobot/sessions/{session_id}")
def update_session(session_id: str, payload: SessionAliasUpdateRequest):
    updated = session_alias_store.update_alias_meta(
        session_key=session_id,
        alias=payload.title,
        pinned=payload.pinned,
        archived=payload.archived,
        project_id=payload.project_id,
    )
    return {"status": "success", **updated}


@app.put("/nanobot/sessions/{session_id}/context-file")
def update_session_context_file(session_id: str, payload: SessionFileContextUpdateRequest):
    if not nanobot_service.agent:
        raise HTTPException(status_code=400, detail="Nanobot not running")
    session = nanobot_service.agent.sessions.get_or_create(session_id)
    updated_fields = payload.model_fields_set
    if "active_data_file" in updated_fields:
        if payload.active_data_file is None:
            session.metadata.pop("active_data_file", None)
        else:
            session.metadata["active_data_file"] = payload.active_data_file
    if "selected_data_source" in updated_fields:
        if payload.selected_data_source:
            session.metadata["selected_data_source"] = payload.selected_data_source
        else:
            session.metadata.pop("selected_data_source", None)
    session.updated_at = datetime.now()
    nanobot_service.agent.sessions.save(session)
    return {"status": "success", "metadata": session.metadata}
