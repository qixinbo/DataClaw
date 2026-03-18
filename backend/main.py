import asyncio
from typing import Any, Dict, List, Optional, Literal, Tuple
from fastapi import FastAPI, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import re
from datetime import datetime

from app.api import upload, llm, skills, users, datasources, projects, semantic
from app.connectors.postgres import postgres_connector
from app.connectors.clickhouse import clickhouse_connector
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

app.include_router(upload.router, prefix="/api/v1")
app.include_router(llm.router, prefix="/api/v1")
app.include_router(skills.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(projects.router, prefix="/api/v1")
app.include_router(datasources.router, prefix="/api/v1")
app.include_router(semantic.router, prefix="/api/v1")

STREAM_DELTA_CHUNK_SIZE = 48

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


class BatchDeleteRequest(BaseModel):
    session_ids: List[str]


class SessionFileContextUpdateRequest(BaseModel):
    active_data_file: Optional[Dict[str, Any]] = None
    selected_data_source: Optional[str] = None

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
            message = f"[System: User explicitly requested data analysis. Please use the nl2sql tool to answer the following query.]\n{message}"
        elif request.route_mode == "chat":
            message = f"[System: User explicitly requested normal chat. Do NOT use the nl2sql tool.]\n{message}"

        response = await nanobot_service.process_message(
            message,
            session_id=request.session_id,
            skill_ids=request.skill_ids,
            model_id=request.model_id,
        )

        viz_payload = current_viz_data.get()
        if viz_payload and nanobot_service.agent:
            # Update the last assistant message with viz data
            session = nanobot_service.agent.sessions.get_or_create(request.session_id)
            if session.messages and session.messages[-1].get("role") == "assistant":
                session.messages[-1]["viz"] = viz_payload
                nanobot_service.agent.sessions.save(session)

        return {
            "response": response,
            "viz": viz_payload,
            "routing": {"selected": "agent", "reason": "auto_routed_by_agent"},
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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

            async def _on_progress(content: str, **kwargs: Any) -> None:
                if content:
                    await progress_queue.put(content)

            current_progress_callback.set(_on_progress)

            # Inject instructions if explicitly routed
            message = request.message
            if request.route_mode == "sql" or request.prefer_sql_chart:
                message = f"[System: User explicitly requested data analysis. Please use the nl2sql tool to answer the following query.]\n{message}"
            elif request.route_mode == "chat":
                message = f"[System: User explicitly requested normal chat. Do NOT use the nl2sql tool.]\n{message}"

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
            viz_sent = False

            while True:
                # Check for viz payload during processing
                viz_payload = current_viz_data.get()
                if viz_payload and not viz_sent:
                    yield f"data: {json.dumps({'type': 'viz', **viz_payload}, ensure_ascii=False)}\n\n"
                    viz_sent = True

                if current_task.done() and progress_queue.empty():
                    break
                try:
                    progress = await asyncio.wait_for(progress_queue.get(), timeout=0.2)
                    yield f"data: {json.dumps({'type': 'progress', 'content': progress}, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    continue

            response = await current_task
            text = response or ""

            # Check again for viz payload after task completes if not sent yet
            viz_payload = current_viz_data.get()
            if viz_payload and not viz_sent:
                yield f"data: {json.dumps({'type': 'viz', **viz_payload}, ensure_ascii=False)}\n\n"

            # Persist viz payload to session
            if viz_payload and nanobot_service.agent:
                session = nanobot_service.agent.sessions.get_or_create(request.session_id)
                if session.messages and session.messages[-1].get("role") == "assistant":
                    session.messages[-1]["viz"] = viz_payload
                    nanobot_service.agent.sessions.save(session)

            for idx in range(0, len(text), STREAM_DELTA_CHUNK_SIZE):
                chunk = text[idx: idx + STREAM_DELTA_CHUNK_SIZE]
                yield f"data: {json.dumps({'type': 'delta', 'content': chunk}, ensure_ascii=False)}\n\n"
            
            yield f"data: {json.dumps({'type': 'final', 'content': text}, ensure_ascii=False)}\n\n"
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
def get_sessions():
    if not nanobot_service.agent:
        return session_alias_store.list_cached_sessions()
    sessions = nanobot_service.agent.sessions.list_sessions()
    return session_alias_store.sync_and_list(sessions)

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

@app.post("/nanobot/sessions/{session_id}/ensure")
def ensure_session(session_id: str):
    if not nanobot_service.agent:
        raise HTTPException(status_code=400, detail="Nanobot not running")
    session = nanobot_service.agent.sessions.get_or_create(session_id)
    nanobot_service.agent.sessions.save(session)
    alias = session_alias_store.get_alias(session_id)
    return {
        "key": session.key,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
        "metadata": session.metadata,
        "alias": alias,
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
