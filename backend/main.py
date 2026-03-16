from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
import json
from datetime import datetime

from app.api import upload, llm, skills, users, datasources, projects
from app.connectors.postgres import postgres_connector
from app.connectors.clickhouse import clickhouse_connector
from app.core.nanobot import nanobot_service
from app.core.session_alias_store import session_alias_store
from app.agent.nl2sql import process_nl2sql, NL2SQLRequest, NL2SQLResponse
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


class SessionAliasUpdateRequest(BaseModel):
    title: Optional[str] = None
    pinned: Optional[bool] = None
    archived: Optional[bool] = None


class BatchDeleteRequest(BaseModel):
    session_ids: List[str]


class SessionFileContextUpdateRequest(BaseModel):
    active_data_file: Optional[Dict[str, Any]] = None


def _build_sql_chart_text(nl2sql_result: NL2SQLResponse) -> str:
    chart = nl2sql_result.chart
    can_visualize = bool(chart and chart.can_visualize and chart.chart_spec)
    text = (
        f"已为你生成 SQL 并查询到 {len(nl2sql_result.result)} 行数据。"
        f"{'可视化面板已同步更新图表。' if can_visualize else '本次结果不适合图表展示。'}"
    )
    if chart and chart.reasoning:
        return f"{text}\n\n可视化说明：{chart.reasoning}"
    return text


def _build_sql_chart_viz(nl2sql_result: NL2SQLResponse) -> dict:
    chart = nl2sql_result.chart
    return {
        "sql": nl2sql_result.sql,
        "result": nl2sql_result.result,
        "chart": chart.model_dump() if chart else None,
        "error": nl2sql_result.error,
    }


def _persist_session_turn(
    session_id: str,
    user_message: str,
    assistant_message: str,
    assistant_extra: Optional[dict] = None,
) -> None:
    if not nanobot_service.agent:
        return
    session = nanobot_service.agent.sessions.get_or_create(session_id)
    session.add_message("user", user_message)
    session.add_message("assistant", assistant_message, **(assistant_extra or {}))
    nanobot_service.agent.sessions.save(session)

@app.post("/nanobot/chat")
async def nanobot_chat(request: ChatRequest):
    try:
        if request.prefer_sql_chart:
            nl2sql_result = await process_nl2sql(
                NL2SQLRequest(query=request.message, source=request.source, file_url=request.file_url)
            )
            text = _build_sql_chart_text(nl2sql_result)
            viz_payload = _build_sql_chart_viz(nl2sql_result)
            _persist_session_turn(request.session_id, request.message, text, {"viz": viz_payload})
            return {
                "response": text,
                "viz": viz_payload,
            }
        response = await nanobot_service.process_message(
            request.message,
            session_id=request.session_id,
            skill_ids=request.skill_ids,
            model_id=request.model_id,
        )
        return {"response": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/nanobot/chat/stream")
async def nanobot_chat_stream(request: ChatRequest):
    async def event_generator():
        try:
            if request.prefer_sql_chart:
                nl2sql_result = await process_nl2sql(
                    NL2SQLRequest(query=request.message, source=request.source, file_url=request.file_url)
                )
                persisted_viz_payload = _build_sql_chart_viz(nl2sql_result)
                viz_payload = {
                    "type": "viz",
                    **persisted_viz_payload,
                }
                yield f"data: {json.dumps(viz_payload, ensure_ascii=False)}\n\n"
                text = _build_sql_chart_text(nl2sql_result)
                _persist_session_turn(request.session_id, request.message, text, {"viz": persisted_viz_payload})
                yield f"data: {json.dumps({'type': 'final', 'content': text}, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
                return
            response = await nanobot_service.process_message(
                request.message,
                session_id=request.session_id,
                skill_ids=request.skill_ids,
                model_id=request.model_id,
            )
            text = response or ""
            for ch in text:
                yield f"data: {json.dumps({'type': 'delta', 'content': ch}, ensure_ascii=False)}\n\n"
                await asyncio.sleep(0.008)
            yield f"data: {json.dumps({'type': 'final', 'content': text}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"

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
    if payload.active_data_file is None:
        session.metadata.pop("active_data_file", None)
    else:
        session.metadata["active_data_file"] = payload.active_data_file
    session.updated_at = datetime.now()
    nanobot_service.agent.sessions.save(session)
    return {"status": "success", "metadata": session.metadata}
