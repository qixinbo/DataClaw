from typing import List, Optional
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio

from app.api import upload, llm, skills
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

@app.post("/nanobot/chat")
async def nanobot_chat(request: ChatRequest):
    try:
        response = await nanobot_service.process_message(request.message, skill_ids=request.skill_ids)
        return {"response": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/agent/nl2sql", response_model=NL2SQLResponse)
async def run_nl2sql(request: NL2SQLRequest):
    return await process_nl2sql(request)
