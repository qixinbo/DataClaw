from typing import List, Optional
from fastapi import FastAPI, HTTPException, Body
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
import json

from app.api import upload, llm, skills, users
from app.connectors.postgres import postgres_connector
from app.connectors.clickhouse import clickhouse_connector
from app.connectors.minio import minio_connector
from app.core.nanobot import nanobot_service
from app.agent.nl2sql import process_nl2sql, NL2SQLRequest, NL2SQLResponse

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router, prefix="/api/v1")
app.include_router(llm.router, prefix="/api/v1")
app.include_router(skills.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")

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

@app.get("/connect/minio")
def test_minio():
    if minio_connector.test_connection():
        return {"status": "success", "message": "Connected to MinIO"}
    raise HTTPException(status_code=500, detail="Failed to connect to MinIO")

@app.get("/nanobot/status")
def nanobot_status():
    if nanobot_service.agent:
        return {"status": "running", "model": nanobot_service.agent.model}
    return {"status": "stopped"}

class ChatRequest(BaseModel):
    message: str
    skill_ids: Optional[List[str]] = None
    model_id: Optional[str] = None

@app.post("/nanobot/chat")
async def nanobot_chat(request: ChatRequest):
    try:
        response = await nanobot_service.process_message(request.message, skill_ids=request.skill_ids, model_id=request.model_id)
        return {"response": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/nanobot/chat/stream")
async def nanobot_chat_stream(request: ChatRequest):
    async def event_generator():
        try:
            response = await nanobot_service.process_message(
                request.message,
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

@app.post("/api/v1/agent/nl2sql", response_model=NL2SQLResponse)
async def run_nl2sql(request: NL2SQLRequest):
    return await process_nl2sql(request)
