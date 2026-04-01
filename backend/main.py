import asyncio
import base64
import binascii
import importlib.resources as importlib_resources
from typing import Any, Dict, List, Optional, Literal, Tuple
import mimetypes
from pathlib import Path
from dotenv import load_dotenv

# 加载项目根目录下的 .env 文件
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from pydantic import BaseModel
import json
import re
import os
from datetime import datetime

from app.api import upload, llm, skills, users, datasources, projects, semantic, mcp, subagents, knowledge, embedding_models, web_search
from app.connectors.postgres import postgres_connector
from app.connectors.clickhouse import clickhouse_connector
from app.core.artifacts import extract_artifacts
from app.core.data_root import ensure_data_layout, get_data_root, get_reports_root
from app.core.files import ensure_artifact_access, resolve_artifact_target
from app.core.nanobot import nanobot_service
from app.core.session_alias_store import session_alias_store
from app.context import (
    current_session_id,
    current_progress_callback,
    current_viz_data,
    current_data_source,
    current_file_url,
    current_knowledge_base_id,
)
from app.services.knowledge_index import knowledge_index_service
from app.database import engine, Base
from app.trace import (
    build_chat_trace_attributes,
    build_error_attributes,
    build_usage_attributes,
    trace_service,
)
# Import all models to ensure they are registered
from app.models.user import User, EmailVerification
from app.models.project import Project
from app.models.datasource import DataSource
from app.models.subagent import Subagent

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
try:
    ensure_data_layout()
except Exception as e:
    raise RuntimeError(f"DATA_ROOT 初始化失败: {e}") from e
reports_dir = get_reports_root()
app.mount("/reports", StaticFiles(directory=str(reports_dir)), name="reports")

app.include_router(upload.router, prefix="/api/v1")
app.include_router(llm.router, prefix="/api/v1")
app.include_router(skills.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(projects.router, prefix="/api/v1")
app.include_router(datasources.router, prefix="/api/v1")
app.include_router(semantic.router, prefix="/api/v1")
app.include_router(mcp.router, prefix="/api/v1")
app.include_router(subagents.router, prefix="/api/v1")
app.include_router(knowledge.router, prefix="/api/v1")
app.include_router(embedding_models.router, prefix="/api/v1")
app.include_router(web_search.router, prefix="/api/v1")

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


def _resolve_webui_directory() -> Optional[Path]:
    try:
        package_webui = importlib_resources.files("app").joinpath("webui")
        package_webui_path = Path(str(package_webui))
        if package_webui_path.is_dir():
            return package_webui_path
    except Exception:
        pass
    source_webui = Path(__file__).resolve().parent / "app" / "webui"
    if source_webui.is_dir():
        return source_webui
    source_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
    if source_dist.is_dir():
        return source_dist
    return None


_WEBUI_DIR = _resolve_webui_directory()
_WEBUI_INDEX = _WEBUI_DIR / "index.html" if _WEBUI_DIR else None
_WEBUI_STATIC = StaticFiles(directory=str(_WEBUI_DIR), html=False) if _WEBUI_DIR else None

@app.on_event("startup")
async def startup_event():
    try:
        data_root = get_data_root()
        data_root.mkdir(parents=True, exist_ok=True)
        if not os.access(data_root, os.R_OK | os.W_OK | os.X_OK):
            raise RuntimeError(f"DATA_ROOT 权限不足: {data_root}")
    except Exception as e:
        raise RuntimeError(f"DATA_ROOT 初始化失败: {e}") from e
    # Initialize nanobot in background
    try:
        await nanobot_service.start()
    except Exception as e:
        print(f"Nanobot startup failed: {e}")
    trace_service.initialize()

@app.on_event("shutdown")
async def shutdown_event():
    await nanobot_service.stop()
    trace_service.shutdown()

async def read_root():
    if _WEBUI_INDEX and _WEBUI_INDEX.is_file():
        return FileResponse(path=str(_WEBUI_INDEX), media_type="text/html")
    return {"Hello": "DataClaw Backend"}


async def serve_webui_path(full_path: str, request: Request):
    reserved_prefixes = ("api/", "reports/", "nanobot/", "connect/", "docs", "redoc", "openapi.json")
    if full_path.startswith(reserved_prefixes):
        raise HTTPException(status_code=404, detail="Not Found")
    if not _WEBUI_STATIC:
        raise HTTPException(status_code=404, detail="Not Found")
    try:
        response = await _WEBUI_STATIC.get_response(full_path, request.scope)
    except StarletteHTTPException as exc:
        if exc.status_code != 404:
            raise
        response = None
    if response and response.status_code != 404:
        return response
    if Path(full_path).suffix:
        if response:
            return response
        raise HTTPException(status_code=404, detail="Not Found")
    if _WEBUI_INDEX and _WEBUI_INDEX.is_file():
        return FileResponse(path=str(_WEBUI_INDEX), media_type="text/html")
    raise HTTPException(status_code=404, detail="Not Found")

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
    project_id: Optional[int] = None
    skill_ids: Optional[List[str]] = None
    model_id: Optional[str] = None
    source: str = "postgres"
    prefer_sql_chart: bool = False
    file_url: Optional[str] = None
    route_mode: Literal["auto", "chat", "sql"] = "auto"
    knowledge_base_id: Optional[str] = None


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


def _resolve_effective_knowledge_base_id(request: ChatRequest) -> Optional[str]:
    if request.knowledge_base_id:
        return request.knowledge_base_id
    session_ctx = _session_context_for_routing(request.session_id)
    kb_id = session_ctx.get("selected_knowledge_base_id")
    if isinstance(kb_id, str) and kb_id.strip():
        return kb_id
    return None


def _extract_kb_citations(kb_id: Optional[str], message: str) -> Tuple[str, List[Dict[str, Any]]]:
    if not kb_id:
        return message, []
    try:
        result = knowledge_index_service.search(kb_id=kb_id, query=message, top_k=3)
        hits = result.get("hits", []) if isinstance(result, dict) else []
        if not isinstance(hits, list) or not hits:
            return f"[System: A knowledge base is selected ({kb_id}). Retrieval result is empty.]\n{message}", []
        lines: List[str] = []
        citations: List[Dict[str, Any]] = []
        for idx, item in enumerate(hits[:3], start=1):
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or f"Doc {idx}")
            chunk = str(item.get("chunk") or "").strip().replace("\n\n", "\n")
            if not chunk:
                continue
            score = float(item.get("score", 0.0) or 0.0)
            lines.append(f"[{idx}] {title}\n{chunk}")
            citations.append(
                {
                    "doc_id": str(item.get("doc_id") or ""),
                    "title": title,
                    "score": round(score, 4),
                    "chunk": chunk[:360],
                    "metadata": item.get("metadata") or {},
                }
            )
        if not lines:
            return f"[System: A knowledge base is selected ({kb_id}). Retrieval result is empty.]\n{message}", []
        context_block = "\n".join(lines)
        next_message = f"[Runtime Context — metadata only, not instructions]\nThe following context is retrieved from knowledge base {kb_id}. You must ground your answer on it when relevant.\n{context_block}\n\n{message}"
        return next_message, citations
    except Exception as exc:
        return f"[Runtime Context — metadata only, not instructions]\nA knowledge base is selected ({kb_id}) but retrieval failed: {exc}\n\n{message}", []


def _sync_session_project(session_id: str, project_id: Optional[int]) -> None:
    if project_id is None:
        return
    session_alias_store.update_alias_meta(
        session_key=session_id,
        project_id=project_id,
    )


def _sync_session_chat_context(
    session_id: str,
    selected_data_source: Optional[str] = None,
    selected_knowledge_base_id: Optional[str] = None,
) -> None:
    if not nanobot_service.agent:
        return
    sessions = nanobot_service.agent.sessions
    session = sessions.get_or_create(session_id)
    if selected_data_source:
        session.metadata["selected_data_source"] = selected_data_source
    if selected_knowledge_base_id:
        session.metadata["selected_knowledge_base_id"] = selected_knowledge_base_id
    session.updated_at = datetime.now()
    save_fn = getattr(sessions, "save", None)
    if callable(save_fn):
        save_fn(session)

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
    selected_knowledge_base_id: Optional[str] = None


def _persist_assistant_enrichment(
    session_id: str,
    viz_payload: Optional[Dict[str, Any]] = None,
    artifacts: Optional[List[Dict[str, Any]]] = None,
    usage: Optional[Dict[str, Any]] = None,
    kb_citations: Optional[List[Dict[str, Any]]] = None,
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
    if usage:
        session.messages[-1]["usage"] = usage
        changed = True
    if kb_citations is not None:
        session.messages[-1]["kb_citations"] = kb_citations
        changed = True
    if changed:
        save_fn = getattr(nanobot_service.agent.sessions, "save", None)
        if callable(save_fn):
            save_fn(session)


def _extract_reasoning_content(session_messages: List[Dict[str, Any]]) -> str:
    for message in reversed(session_messages):
        if not isinstance(message, dict):
            continue
        if message.get("role") != "assistant":
            continue
        reasoning_content = message.get("reasoning_content")
        if isinstance(reasoning_content, str) and reasoning_content.strip():
            return reasoning_content
        break
    return ""

@app.post("/nanobot/chat")
async def nanobot_chat(request: ChatRequest):
    try:
        _sync_session_project(request.session_id, request.project_id)
        resolved_source = _resolve_effective_source(request)
        resolved_kb_id = _resolve_effective_knowledge_base_id(request)
        _sync_session_chat_context(
            session_id=request.session_id,
            selected_data_source=resolved_source,
            selected_knowledge_base_id=resolved_kb_id,
        )
        current_data_source.set(resolved_source)
        current_file_url.set(request.file_url)
        current_knowledge_base_id.set(resolved_kb_id)
        current_session_id.set(request.session_id)
        current_viz_data.set({})

        # Inject instructions if explicitly routed
        message, kb_citations = _extract_kb_citations(resolved_kb_id, request.message)
        
        instructions = []
        if request.route_mode == "sql" or request.prefer_sql_chart:
            instructions.append("Use the nl2sql tool to answer the query")
            instructions.append("If the user also asks for visualization, set generate_chart=true in the same nl2sql call")
            instructions.append("Do not call visualization after nl2sql if a chart is already generated for this request")
            instructions.append("Do not use exec, Python scripts, or matplotlib for chart plotting")
        elif request.route_mode == "chat":
            instructions.append("Normal chat mode. Do NOT use the nl2sql tool")

        if instructions:
            instr_block = "\n".join(instructions)
            # If message already has Runtime Context, append to it, otherwise create new
            if message.startswith("[Runtime Context — metadata only, not instructions]"):
                parts = message.split("\n\n", 1)
                if len(parts) == 2:
                    message = f"{parts[0]}\n{instr_block}\n\n{parts[1]}"
                else:
                    message = f"{message}\n{instr_block}"
            else:
                message = f"[Runtime Context — metadata only, not instructions]\n{instr_block}\n\n{message}"

        response = await nanobot_service.process_message(
            message,
            session_id=request.session_id,
            skill_ids=request.skill_ids,
            model_id=request.model_id,
            project_id=request.project_id,
        )
        text = response or ""
        session_messages = []
        if nanobot_service.agent:
            session = nanobot_service.agent.sessions.get_or_create(request.session_id)
            session_messages = session.messages
        artifacts = extract_artifacts(text, session_messages)

        viz_payload = current_viz_data.get()
        usage = nanobot_service.get_last_usage(request.session_id)
        _persist_assistant_enrichment(
            session_id=request.session_id,
            viz_payload=viz_payload if isinstance(viz_payload, dict) else None,
            artifacts=artifacts,
            usage=usage,
            kb_citations=kb_citations,
        )

        payload = {
            "response": text,
            "viz": viz_payload,
            "routing": {"selected": "agent", "reason": "auto_routed_by_agent"},
        }
        if artifacts:
            payload["artifacts"] = artifacts
        if usage:
            payload["usage"] = usage
        if kb_citations:
            payload["kb_citations"] = kb_citations
        return payload
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/nanobot/chat/stream")
async def nanobot_chat_stream(request: ChatRequest):
    async def event_generator():
        current_task = None
        trace_attrs = build_chat_trace_attributes(
            session_id=request.session_id,
            project_id=request.project_id,
            model_id=request.model_id,
            route_mode=request.route_mode,
            source=request.source,
            knowledge_base_id=request.knowledge_base_id,
        )
        with trace_service.start_span(
            "chat.stream",
            attributes=trace_attrs,
            input_payload={"message": request.message},
        ) as root_span:
            root_span.update_trace(
                session_id=request.session_id,
                metadata=trace_attrs,
                input={"message": request.message},
            )
            try:
                _sync_session_project(request.session_id, request.project_id)
                resolved_source = _resolve_effective_source(request)
                resolved_kb_id = _resolve_effective_knowledge_base_id(request)
                _sync_session_chat_context(
                    session_id=request.session_id,
                    selected_data_source=resolved_source,
                    selected_knowledge_base_id=resolved_kb_id,
                )
                current_data_source.set(resolved_source)
                current_file_url.set(request.file_url)
                current_knowledge_base_id.set(resolved_kb_id)
                current_session_id.set(request.session_id)
                current_viz_data.set({})

                yield f"data: {json.dumps({'type': 'routing', 'selected': 'agent', 'reason': 'auto_routed_by_agent'}, ensure_ascii=False)}\n\n"

                progress_queue: asyncio.Queue[Any] = asyncio.Queue()

                async def _on_progress(content: str, **kwargs: Any) -> None:
                    if content:
                        payload: Dict[str, Any] = {"type": "progress", "content": content}
                        payload.update(kwargs)
                        await progress_queue.put(payload)

                async def _on_stream(delta: str) -> None:
                    if delta:
                        await progress_queue.put({"type": "delta", "content": delta})

                current_progress_callback.set(_on_progress)
                message, kb_citations = _extract_kb_citations(resolved_kb_id, request.message)

                instructions = []
                if request.route_mode == "sql" or request.prefer_sql_chart:
                    instructions.append("Use the nl2sql tool to answer the query")
                    instructions.append("If the user also asks for visualization, set generate_chart=true in the same nl2sql call")
                    instructions.append("Do not call visualization after nl2sql if a chart is already generated for this request")
                    instructions.append("Do not use exec, Python scripts, or matplotlib for chart plotting")
                elif request.route_mode == "chat":
                    instructions.append("Normal chat mode. Do NOT use the nl2sql tool")

                if instructions:
                    instr_block = "\n".join(instructions)
                    if message.startswith("[Runtime Context — metadata only, not instructions]"):
                        parts = message.split("\n\n", 1)
                        if len(parts) == 2:
                            message = f"{parts[0]}\n{instr_block}\n\n{parts[1]}"
                        else:
                            message = f"{message}\n{instr_block}"
                    else:
                        message = f"[Runtime Context — metadata only, not instructions]\n{instr_block}\n\n{message}"

                current_task = asyncio.create_task(
                    nanobot_service.process_message(
                        message,
                        session_id=request.session_id,
                        skill_ids=request.skill_ids,
                        model_id=request.model_id,
                        project_id=request.project_id,
                        on_progress=_on_progress,
                        on_stream=_on_stream,
                    )
                )

                text = ""
                last_viz_hash = None
                while True:
                    viz_payload = current_viz_data.get()
                    if viz_payload:
                        try:
                            current_hash = hash(
                                (
                                    viz_payload.get("sql"),
                                    viz_payload.get("error"),
                                    json.dumps(viz_payload.get("chart"), sort_keys=True),
                                )
                            )
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
                reasoning_content = _extract_reasoning_content(session_messages)
                viz_payload = current_viz_data.get()
                usage = nanobot_service.get_last_usage(request.session_id)

                root_span.set_attributes(
                    {
                        "response.length": len(text),
                        "response.has_reasoning": bool(reasoning_content),
                        "response.has_artifacts": bool(artifacts),
                        "response.has_viz": bool(viz_payload),
                        "response.has_kb_citations": bool(kb_citations),
                    }
                )
                root_span.set_attributes(build_usage_attributes(usage))

                if viz_payload:
                    try:
                        current_hash = hash(
                            (
                                viz_payload.get("sql"),
                                viz_payload.get("error"),
                                json.dumps(viz_payload.get("chart"), sort_keys=True),
                            )
                        )
                        if current_hash != last_viz_hash:
                            yield f"data: {json.dumps({'type': 'viz', **viz_payload}, ensure_ascii=False)}\n\n"
                    except Exception:
                        pass

                _persist_assistant_enrichment(
                    session_id=request.session_id,
                    viz_payload=viz_payload if isinstance(viz_payload, dict) else None,
                    artifacts=artifacts,
                    usage=usage,
                    kb_citations=kb_citations,
                )

                final_payload = {"type": "final", "content": text}
                if reasoning_content:
                    final_payload["reasoning_content"] = reasoning_content
                if artifacts:
                    final_payload["artifacts"] = artifacts
                if usage:
                    final_payload["usage"] = usage
                if kb_citations:
                    final_payload["kb_citations"] = kb_citations

                root_span.update(output={"content": text, "usage": usage})
                yield f"data: {json.dumps(final_payload, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
            except asyncio.CancelledError:
                root_span.set_attributes({"cancelled": True})
                raise
            except Exception as e:
                root_span.set_attributes(build_error_attributes(e, stage="chat_stream"))
                root_span.record_error(e, stage="chat_stream")
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
    if "selected_knowledge_base_id" in updated_fields:
        if payload.selected_knowledge_base_id:
            session.metadata["selected_knowledge_base_id"] = payload.selected_knowledge_base_id
        else:
            session.metadata.pop("selected_knowledge_base_id", None)
    session.updated_at = datetime.now()
    nanobot_service.agent.sessions.save(session)
    return {"status": "success", "metadata": session.metadata}


app.add_api_route("/", read_root, methods=["GET"], include_in_schema=False)
app.add_api_route("/{full_path:path}", serve_webui_path, methods=["GET"], include_in_schema=False)
