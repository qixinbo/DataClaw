import asyncio
import json
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional, Tuple

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.nanobot import nanobot_service
from app.core.security import CurrentUser, get_current_user
from app.database import SessionLocal, get_db
from app.models.a2a import (
    A2AAuditLog,
    A2AProjectConfig,
    A2ARemoteAgent,
    A2ATask,
    A2ATaskEvent,
    A2ATaskWebhook,
    A2AWebhookDelivery,
)
from app.models.project import Project
from app.services.a2a_service import _json_dumps, _json_loads, a2a_runtime
from app.trace import build_error_attributes, trace_service

router = APIRouter(prefix="/a2a", tags=["a2a"])

SUPPORTED_PROTOCOL_VERSION = "1.0"
SUPPORTED_CAPABILITIES = ["streaming", "push", "task_management", "subscribe"]
SUPPORTED_AUTH = ["bearer", "shared_secret", "none"]


def _mask_error(message: str) -> str:
    if not message:
        return "internal_error"
    return "request_failed"


class AgentCardResponse(BaseModel):
    name: str
    protocol_version: str
    capabilities: List[str]
    endpoints: Dict[str, str]
    auth: List[str]


class RemoteAgentCreate(BaseModel):
    project_id: int
    name: str = Field(min_length=1, max_length=120)
    base_url: str = Field(min_length=1, max_length=500)
    auth_scheme: Literal["none", "bearer"] = "none"
    auth_token: Optional[str] = None


class RemoteAgentUpdate(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    auth_scheme: Optional[Literal["none", "bearer"]] = None
    auth_token: Optional[str] = None


class RemoteAgentView(BaseModel):
    id: int
    project_id: int
    name: str
    base_url: str
    auth_scheme: str
    protocol_version: Optional[str] = None
    capabilities: List[str] = []
    healthy: bool
    failure_count: int
    circuit_open_until: Optional[datetime] = None
    card_fetched_at: Optional[datetime] = None


class SendMessageRequest(BaseModel):
    project_id: int
    message: str = Field(min_length=1)
    session_id: str = "api:a2a"
    remote_agent_id: Optional[int] = None
    route_mode: Literal["auto", "local", "a2a", "a2a_first", "local_first", "mcp_first"] = "auto"
    fallback_chain: Optional[List[Literal["a2a", "local", "mcp"]]] = None
    idempotency_key: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class TaskView(BaseModel):
    id: str
    project_id: int
    source: str
    state: str
    remote_agent_id: Optional[int] = None
    input_text: str
    output_text: Optional[str] = None
    error_message: Optional[str] = None
    compatibility_mode: bool
    metadata: Dict[str, Any]
    created_at: datetime
    updated_at: datetime
    finished_at: Optional[datetime] = None


class CancelTaskResponse(BaseModel):
    task_id: str
    state: str


class TaskWebhookCreate(BaseModel):
    target_url: str = Field(min_length=1, max_length=500)
    secret: Optional[str] = None
    auth_header: Optional[str] = None


class TaskWebhookView(BaseModel):
    id: int
    task_id: str
    target_url: str
    enabled: bool
    created_at: datetime
    updated_at: datetime


class RolloutConfigView(BaseModel):
    project_id: int
    canary_enabled: bool
    canary_percent: int
    rollback_to_local: bool
    compatibility_mode: bool
    dual_event_write: bool
    route_mode_default: str
    fallback_chain: List[str]
    alert_thresholds: Dict[str, Any]


class RolloutConfigUpdate(BaseModel):
    canary_enabled: Optional[bool] = None
    canary_percent: Optional[int] = Field(default=None, ge=0, le=100)
    rollback_to_local: Optional[bool] = None
    compatibility_mode: Optional[bool] = None
    dual_event_write: Optional[bool] = None
    route_mode_default: Optional[str] = None
    fallback_chain: Optional[List[str]] = None
    alert_thresholds: Optional[Dict[str, Any]] = None


def _ensure_project_access(db: Session, project_id: int, user: CurrentUser) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not user.is_admin and project.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Resource not found")
    return project


def _ensure_task_access(db: Session, task_id: str, user: CurrentUser) -> A2ATask:
    task = db.query(A2ATask).filter(A2ATask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not user.is_admin and task.tenant_id != user.id:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _ensure_agent_access(db: Session, agent_id: int, user: CurrentUser) -> A2ARemoteAgent:
    agent = db.query(A2ARemoteAgent).filter(A2ARemoteAgent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Remote agent not found")
    project = _ensure_project_access(db, agent.project_id, user)
    if not project:
        raise HTTPException(status_code=404, detail="Remote agent not found")
    return agent


def _task_to_view(task: A2ATask) -> TaskView:
    return TaskView(
        id=task.id,
        project_id=task.project_id,
        source=task.source,
        state=task.state,
        remote_agent_id=task.remote_agent_id,
        input_text=task.input_text,
        output_text=task.output_text,
        error_message=task.error_message,
        compatibility_mode=task.compatibility_mode,
        metadata=_json_loads(task.metadata_json, {}),
        created_at=task.created_at,
        updated_at=task.updated_at,
        finished_at=task.finished_at,
    )


def _agent_to_view(agent: A2ARemoteAgent) -> RemoteAgentView:
    return RemoteAgentView(
        id=agent.id,
        project_id=agent.project_id,
        name=agent.name,
        base_url=agent.base_url,
        auth_scheme=agent.auth_scheme,
        protocol_version=agent.protocol_version,
        capabilities=_json_loads(agent.capabilities_json, []),
        healthy=bool(agent.healthy),
        failure_count=int(agent.failure_count or 0),
        circuit_open_until=agent.circuit_open_until,
        card_fetched_at=agent.card_fetched_at,
    )


def _build_status_event(task: A2ATask, *, compatibility_mode: bool, dual_event_write: bool) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "type": "TaskStatusUpdateEvent",
        "task_id": task.id,
        "task_status": task.state,
        "timestamp": datetime.utcnow().isoformat(),
        "source": task.source,
    }
    if compatibility_mode or dual_event_write:
        payload.update(
            {
                "event": "task_status",
                "status": task.state,
                "taskId": task.id,
            }
        )
    return payload


def _build_artifact_event(task_id: str, content: str, *, compatibility_mode: bool, dual_event_write: bool) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "type": "TaskArtifactUpdateEvent",
        "task_id": task_id,
        "artifact": {"content": content},
        "timestamp": datetime.utcnow().isoformat(),
    }
    if compatibility_mode or dual_event_write:
        payload.update(
            {
                "event": "task_output",
                "taskId": task_id,
                "output": content,
            }
        )
    return payload


async def _delegate_to_remote(task: A2ATask, agent: A2ARemoteAgent, message: str) -> Tuple[str, Dict[str, Any]]:
    headers: Dict[str, str] = {}
    if agent.auth_scheme == "bearer" and agent.auth_token:
        headers["Authorization"] = f"Bearer {agent.auth_token}"
    payload = {
        "project_id": task.project_id,
        "message": message,
        "session_id": f"a2a-delegate:{task.id}",
        "idempotency_key": task.idempotency_key,
        "route_mode": "local_first",
        "metadata": {"delegated_by": "dataclaw", "task_id": task.id},
    }
    url = f"{agent.base_url.rstrip('/')}/api/v1/a2a/messages/send"
    async with httpx.AsyncClient(timeout=25.0, verify=True) as client:
        resp = await client.post(url, json=payload, headers=headers)
    if resp.status_code >= 400:
        raise RuntimeError(f"remote_http_{resp.status_code}")
    body = resp.json()
    content = ""
    if isinstance(body, dict):
        task_obj = body.get("task") or {}
        content = str(task_obj.get("output_text") or body.get("message") or "")
    return content, body


async def _run_task(task_id: str, request: SendMessageRequest, tenant_id: int) -> None:
    db = SessionLocal()
    try:
        task = db.query(A2ATask).filter(A2ATask.id == task_id).first()
        if not task:
            return
        config = a2a_runtime.get_project_config(db, task.project_id, tenant_id)
        if task.state in {"CANCELED", "REJECTED"}:
            return
        with trace_service.start_span("a2a.task.execute", attributes={"task_id": task.id, "project_id": task.project_id, "source": task.source}) as span:
            start_ts = datetime.utcnow().timestamp()
            try:
                task = a2a_runtime.transition_task(db, task, to_state="WORKING")
                status_event = _build_status_event(task, compatibility_mode=config.compatibility_mode, dual_event_write=config.dual_event_write)
                status_row = a2a_runtime.append_event(db, task, "TaskStatusUpdateEvent", status_event)
                await a2a_runtime.publish(task.id, status_event)
                await a2a_runtime.notify_webhooks(db, task, status_row)

                if task.source == "a2a" and task.remote_agent_id:
                    agent = db.query(A2ARemoteAgent).filter(A2ARemoteAgent.id == task.remote_agent_id).first()
                    if not agent:
                        raise RuntimeError("remote_agent_missing")
                    response_text, metadata = await _delegate_to_remote(task, agent, request.message)
                else:
                    response_text = await nanobot_service.process_message(
                        request.message,
                        session_id=f"a2a-task:{task.id}",
                        project_id=task.project_id,
                    )
                    metadata = {"executor": "local"}
                artifact_event_payload = _build_artifact_event(task.id, response_text or "", compatibility_mode=config.compatibility_mode, dual_event_write=config.dual_event_write)
                artifact_event = a2a_runtime.append_event(db, task, "TaskArtifactUpdateEvent", artifact_event_payload)
                await a2a_runtime.publish(task.id, artifact_event_payload)
                await a2a_runtime.notify_webhooks(db, task, artifact_event)
                task = a2a_runtime.transition_task(
                    db,
                    task,
                    to_state="COMPLETED",
                    output_text=response_text or "",
                    metadata=metadata,
                )
                done_event = _build_status_event(task, compatibility_mode=config.compatibility_mode, dual_event_write=config.dual_event_write)
                done_row = a2a_runtime.append_event(db, task, "TaskStatusUpdateEvent", done_event)
                await a2a_runtime.publish(task.id, done_event)
                await a2a_runtime.notify_webhooks(db, task, done_row)
                elapsed = (datetime.utcnow().timestamp() - start_ts) * 1000
                await a2a_runtime.metrics.observe_latency("a2a.execute", elapsed)
            except Exception as exc:
                span.set_attributes(build_error_attributes(exc, stage="a2a_task_execute"))
                await a2a_runtime.metrics.incr("a2a.requests.error")
                task = db.query(A2ATask).filter(A2ATask.id == task.id).first()
                if task and task.state not in {"COMPLETED", "FAILED", "CANCELED", "REJECTED"}:
                    task = a2a_runtime.transition_task(db, task, to_state="FAILED", error_message=_json_dumps({"message": _mask_error(str(exc))}))
                    fail_event = _build_status_event(task, compatibility_mode=task.compatibility_mode, dual_event_write=True)
                    fail_row = a2a_runtime.append_event(db, task, "TaskStatusUpdateEvent", fail_event)
                    await a2a_runtime.publish(task.id, fail_event)
                    await a2a_runtime.notify_webhooks(db, task, fail_row)
    finally:
        db.close()


@router.get("/agent-card", response_model=AgentCardResponse)
def get_agent_card() -> AgentCardResponse:
    return AgentCardResponse(
        name="DataClaw A2A Gateway",
        protocol_version=SUPPORTED_PROTOCOL_VERSION,
        capabilities=SUPPORTED_CAPABILITIES,
        endpoints={
            "send_message": "/api/v1/a2a/messages/send",
            "send_streaming_message": "/api/v1/a2a/messages/stream",
            "get_task": "/api/v1/a2a/tasks/{task_id}",
            "list_tasks": "/api/v1/a2a/tasks",
            "cancel_task": "/api/v1/a2a/tasks/{task_id}/cancel",
            "subscribe_task": "/api/v1/a2a/tasks/{task_id}/subscribe",
        },
        auth=SUPPORTED_AUTH,
    )


@router.get("/remote-agents", response_model=List[RemoteAgentView])
def list_remote_agents(
    project_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> List[RemoteAgentView]:
    query = db.query(A2ARemoteAgent)
    if project_id is not None:
        _ensure_project_access(db, project_id, current_user)
        query = query.filter(A2ARemoteAgent.project_id == project_id)
    if not current_user.is_admin:
        owned_ids = [p.id for p in db.query(Project).filter(Project.owner_id == current_user.id).all()]
        if not owned_ids:
            return []
        query = query.filter(A2ARemoteAgent.project_id.in_(owned_ids))
    return [_agent_to_view(item) for item in query.order_by(A2ARemoteAgent.id.desc()).all()]


@router.post("/remote-agents", response_model=RemoteAgentView, status_code=status.HTTP_201_CREATED)
async def create_remote_agent(
    payload: RemoteAgentCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> RemoteAgentView:
    _ensure_project_access(db, payload.project_id, current_user)
    item = A2ARemoteAgent(
        project_id=payload.project_id,
        name=payload.name.strip(),
        base_url=payload.base_url.strip().rstrip("/"),
        auth_scheme=payload.auth_scheme,
        auth_token=payload.auth_token,
        created_by=current_user.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    try:
        await a2a_runtime.fetch_agent_card(db, item)
    except Exception:
        pass
    a2a_runtime.record_audit(
        db,
        actor_user_id=current_user.id,
        action="create_remote_agent",
        target_type="remote_agent",
        target_id=str(item.id),
        result="ok",
        project_id=item.project_id,
    )
    return _agent_to_view(item)


@router.put("/remote-agents/{agent_id}", response_model=RemoteAgentView)
async def update_remote_agent(
    agent_id: int,
    payload: RemoteAgentUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> RemoteAgentView:
    item = _ensure_agent_access(db, agent_id, current_user)
    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(item, key, value)
    if item.base_url:
        item.base_url = item.base_url.rstrip("/")
    db.add(item)
    db.commit()
    db.refresh(item)
    try:
        await a2a_runtime.fetch_agent_card(db, item)
    except Exception:
        pass
    a2a_runtime.record_audit(
        db,
        actor_user_id=current_user.id,
        action="update_remote_agent",
        target_type="remote_agent",
        target_id=str(item.id),
        result="ok",
        project_id=item.project_id,
    )
    return _agent_to_view(item)


@router.delete("/remote-agents/{agent_id}")
def delete_remote_agent(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, str]:
    item = _ensure_agent_access(db, agent_id, current_user)
    db.delete(item)
    db.commit()
    a2a_runtime.record_audit(
        db,
        actor_user_id=current_user.id,
        action="delete_remote_agent",
        target_type="remote_agent",
        target_id=str(agent_id),
        result="ok",
        project_id=item.project_id,
    )
    return {"status": "success"}


@router.post("/remote-agents/{agent_id}/refresh-card", response_model=RemoteAgentView)
async def refresh_remote_agent_card(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> RemoteAgentView:
    item = _ensure_agent_access(db, agent_id, current_user)
    try:
        card = await a2a_runtime.fetch_agent_card(db, item)
    except Exception as exc:
        a2a_runtime.record_audit(
            db,
            actor_user_id=current_user.id,
            action="refresh_remote_agent_card",
            target_type="remote_agent",
            target_id=str(agent_id),
            result="failed",
            project_id=item.project_id,
            detail={"error": str(exc)},
        )
        raise HTTPException(status_code=502, detail="Remote card fetch failed")
    version = str(card.get("protocol_version") or "")
    if version and version.split(".")[0] != SUPPORTED_PROTOCOL_VERSION.split(".")[0]:
        raise HTTPException(status_code=400, detail="Protocol version incompatible")
    return _agent_to_view(item)


@router.post("/remote-agents/{agent_id}/health-check")
async def health_check_remote_agent(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, Any]:
    item = _ensure_agent_access(db, agent_id, current_user)
    try:
        await a2a_runtime.fetch_agent_card(db, item, timeout_s=5.0)
        return {"healthy": True, "failure_count": item.failure_count}
    except Exception:
        return {"healthy": False, "failure_count": item.failure_count}


@router.post("/messages/send")
async def send_message(
    request: SendMessageRequest,
    x_a2a_token: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, Any]:
    _ensure_project_access(db, request.project_id, current_user)
    config = a2a_runtime.get_project_config(db, request.project_id, current_user.id)
    route = a2a_runtime.resolve_route(
        project_config=config,
        session_id=request.session_id,
        requested_mode=request.route_mode,
        requested_fallback=request.fallback_chain,
    )
    selected_source = "local"
    remote_agent_id = None
    if route.selected == "a2a" and request.remote_agent_id:
        agent = _ensure_agent_access(db, request.remote_agent_id, current_user)
        if not agent.healthy and config.rollback_to_local:
            selected_source = "local"
        else:
            selected_source = "a2a"
            remote_agent_id = agent.id
    task = a2a_runtime.create_task(
        db,
        project_id=request.project_id,
        tenant_id=current_user.id,
        source=selected_source,
        input_text=request.message,
        idempotency_key=request.idempotency_key,
        remote_agent_id=remote_agent_id,
        compatibility_mode=config.compatibility_mode,
        metadata={"route": route.model_dump() if hasattr(route, "model_dump") else route.__dict__, "token_present": bool(x_a2a_token), "request_metadata": request.metadata or {}},
    )
    event_payload = _build_status_event(task, compatibility_mode=config.compatibility_mode, dual_event_write=config.dual_event_write)
    event_row = a2a_runtime.append_event(db, task, "TaskStatusUpdateEvent", event_payload)
    await a2a_runtime.publish(task.id, event_payload)
    await a2a_runtime.notify_webhooks(db, task, event_row)
    asyncio.create_task(_run_task(task.id, request, current_user.id))
    await a2a_runtime.metrics.incr("a2a.requests.total")
    a2a_runtime.record_audit(
        db,
        actor_user_id=current_user.id,
        action="send_message",
        target_type="task",
        target_id=task.id,
        result="accepted",
        project_id=task.project_id,
        task_id=task.id,
    )
    return {"task": _task_to_view(task).model_dump(), "routing": route.__dict__}


@router.post("/messages/stream")
async def send_streaming_message(
    request: SendMessageRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> StreamingResponse:
    response = await send_message(request=request, x_a2a_token=None, db=db, current_user=current_user)
    task_id = response["task"]["id"]

    async def event_generator():
        history = (
            db.query(A2ATaskEvent)
            .filter(A2ATaskEvent.task_id == task_id)
            .order_by(A2ATaskEvent.id.asc())
            .all()
        )
        for item in history:
            payload = _json_loads(item.payload_json, {})
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
        async for payload in a2a_runtime.subscribe(task_id):
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
            if payload.get("task_status") in {"COMPLETED", "FAILED", "CANCELED", "REJECTED"}:
                break
        yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.get("/tasks/{task_id}", response_model=TaskView)
def get_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> TaskView:
    task = _ensure_task_access(db, task_id, current_user)
    return _task_to_view(task)


@router.get("/tasks", response_model=List[TaskView])
def list_tasks(
    project_id: Optional[int] = Query(default=None),
    state: Optional[str] = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> List[TaskView]:
    query = db.query(A2ATask)
    if not current_user.is_admin:
        query = query.filter(A2ATask.tenant_id == current_user.id)
    if project_id is not None:
        _ensure_project_access(db, project_id, current_user)
        query = query.filter(A2ATask.project_id == project_id)
    if state:
        query = query.filter(A2ATask.state == state)
    tasks = query.order_by(A2ATask.created_at.desc()).offset(skip).limit(limit).all()
    return [_task_to_view(item) for item in tasks]


@router.post("/tasks/{task_id}/cancel", response_model=CancelTaskResponse)
async def cancel_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> CancelTaskResponse:
    task = _ensure_task_access(db, task_id, current_user)
    if task.state in {"COMPLETED", "FAILED", "CANCELED", "REJECTED"}:
        return CancelTaskResponse(task_id=task.id, state=task.state)
    try:
        task = a2a_runtime.transition_task(db, task, to_state="CANCELED")
    except ValueError:
        raise HTTPException(status_code=409, detail="Task state transition conflict")
    config = a2a_runtime.get_project_config(db, task.project_id, current_user.id)
    payload = _build_status_event(task, compatibility_mode=config.compatibility_mode, dual_event_write=config.dual_event_write)
    row = a2a_runtime.append_event(db, task, "TaskStatusUpdateEvent", payload)
    await a2a_runtime.publish(task.id, payload)
    await a2a_runtime.notify_webhooks(db, task, row)
    a2a_runtime.record_audit(
        db,
        actor_user_id=current_user.id,
        action="cancel_task",
        target_type="task",
        target_id=task.id,
        result="ok",
        project_id=task.project_id,
        task_id=task.id,
    )
    return CancelTaskResponse(task_id=task.id, state=task.state)


@router.get("/tasks/{task_id}/subscribe")
async def subscribe_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> StreamingResponse:
    task = _ensure_task_access(db, task_id, current_user)
    initial_events = (
        db.query(A2ATaskEvent)
        .filter(A2ATaskEvent.task_id == task.id)
        .order_by(A2ATaskEvent.id.asc())
        .all()
    )

    async def event_generator():
        for event in initial_events:
            payload = _json_loads(event.payload_json, {})
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
        if task.state in {"COMPLETED", "FAILED", "CANCELED", "REJECTED"}:
            yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
            return
        async for payload in a2a_runtime.subscribe(task.id):
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
            if payload.get("task_status") in {"COMPLETED", "FAILED", "CANCELED", "REJECTED"}:
                break
        yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.get("/tasks/{task_id}/webhooks", response_model=List[TaskWebhookView])
def list_task_webhooks(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> List[TaskWebhookView]:
    task = _ensure_task_access(db, task_id, current_user)
    items = db.query(A2ATaskWebhook).filter(A2ATaskWebhook.task_id == task.id).order_by(A2ATaskWebhook.id.desc()).all()
    return [
        TaskWebhookView(
            id=item.id,
            task_id=item.task_id,
            target_url=item.target_url,
            enabled=item.enabled,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )
        for item in items
    ]


@router.post("/tasks/{task_id}/webhooks", response_model=TaskWebhookView, status_code=status.HTTP_201_CREATED)
def create_task_webhook(
    task_id: str,
    payload: TaskWebhookCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> TaskWebhookView:
    task = _ensure_task_access(db, task_id, current_user)
    item = A2ATaskWebhook(
        task_id=task.id,
        target_url=payload.target_url.strip(),
        secret=payload.secret,
        auth_header=payload.auth_header,
        created_by=current_user.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    a2a_runtime.record_audit(
        db,
        actor_user_id=current_user.id,
        action="create_task_webhook",
        target_type="task_webhook",
        target_id=str(item.id),
        result="ok",
        project_id=task.project_id,
        task_id=task.id,
    )
    return TaskWebhookView(
        id=item.id,
        task_id=item.task_id,
        target_url=item.target_url,
        enabled=item.enabled,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.delete("/tasks/{task_id}/webhooks/{webhook_id}")
def delete_task_webhook(
    task_id: str,
    webhook_id: int,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, str]:
    task = _ensure_task_access(db, task_id, current_user)
    item = db.query(A2ATaskWebhook).filter(A2ATaskWebhook.id == webhook_id, A2ATaskWebhook.task_id == task.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Webhook not found")
    db.delete(item)
    db.commit()
    return {"status": "success"}


@router.post("/webhook-deliveries/{delivery_id}/replay")
async def replay_delivery(
    delivery_id: int,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, Any]:
    delivery = db.query(A2AWebhookDelivery).filter(A2AWebhookDelivery.id == delivery_id).first()
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")
    task = _ensure_task_access(db, delivery.task_id, current_user)
    webhook = db.query(A2ATaskWebhook).filter(A2ATaskWebhook.id == delivery.webhook_id).first()
    event = db.query(A2ATaskEvent).filter(A2ATaskEvent.id == delivery.event_id).first()
    if not webhook or not event:
        raise HTTPException(status_code=404, detail="Delivery dependencies not found")
    await a2a_runtime._deliver_once(db, webhook, event, delivery)
    return {"status": delivery.status, "attempt": delivery.attempt, "dead_letter": delivery.dead_letter, "task_id": task.id}


@router.get("/metrics")
async def get_metrics(current_user: CurrentUser = Depends(get_current_user)) -> Dict[str, Any]:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin permission required")
    return await a2a_runtime.metrics.snapshot()


@router.get("/projects/{project_id}/rollout", response_model=RolloutConfigView)
def get_rollout_config(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> RolloutConfigView:
    _ensure_project_access(db, project_id, current_user)
    item = a2a_runtime.get_project_config(db, project_id, current_user.id)
    return RolloutConfigView(
        project_id=item.project_id,
        canary_enabled=item.canary_enabled,
        canary_percent=item.canary_percent,
        rollback_to_local=item.rollback_to_local,
        compatibility_mode=item.compatibility_mode,
        dual_event_write=item.dual_event_write,
        route_mode_default=item.route_mode_default,
        fallback_chain=_json_loads(item.fallback_chain_json, ["local"]),
        alert_thresholds=_json_loads(item.alert_thresholds_json, {}),
    )


@router.put("/projects/{project_id}/rollout", response_model=RolloutConfigView)
def update_rollout_config(
    project_id: int,
    payload: RolloutConfigUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> RolloutConfigView:
    _ensure_project_access(db, project_id, current_user)
    item = a2a_runtime.get_project_config(db, project_id, current_user.id)
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        if key == "fallback_chain":
            item.fallback_chain_json = _json_dumps(value)
            continue
        if key == "alert_thresholds":
            item.alert_thresholds_json = _json_dumps(value)
            continue
        setattr(item, key, value)
    item.updated_by = current_user.id
    db.add(item)
    db.commit()
    db.refresh(item)
    a2a_runtime.record_audit(
        db,
        actor_user_id=current_user.id,
        action="update_rollout_config",
        target_type="project_rollout",
        target_id=str(project_id),
        result="ok",
        project_id=project_id,
    )
    return RolloutConfigView(
        project_id=item.project_id,
        canary_enabled=item.canary_enabled,
        canary_percent=item.canary_percent,
        rollback_to_local=item.rollback_to_local,
        compatibility_mode=item.compatibility_mode,
        dual_event_write=item.dual_event_write,
        route_mode_default=item.route_mode_default,
        fallback_chain=_json_loads(item.fallback_chain_json, ["local"]),
        alert_thresholds=_json_loads(item.alert_thresholds_json, {}),
    )


@router.get("/alerts")
def get_alert_panel(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, Any]:
    _ensure_project_access(db, project_id, current_user)
    config = a2a_runtime.get_project_config(db, project_id, current_user.id)
    thresholds = _json_loads(config.alert_thresholds_json, {})
    defaults = {"error_rate": 0.05, "p95_ms": 3000, "retry_rate": 0.2, "circuit_open_rate": 0.05}
    merged = {**defaults, **thresholds}
    return {
        "project_id": project_id,
        "thresholds": merged,
        "panel": {"metrics_endpoint": "/api/v1/a2a/metrics", "task_list_endpoint": "/api/v1/a2a/tasks"},
    }


@router.get("/audit-logs")
def list_audit_logs(
    project_id: Optional[int] = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    query = db.query(A2AAuditLog)
    if project_id is not None:
        _ensure_project_access(db, project_id, current_user)
        query = query.filter(A2AAuditLog.project_id == project_id)
    elif not current_user.is_admin:
        query = query.filter(A2AAuditLog.actor_user_id == current_user.id)
    rows = query.order_by(A2AAuditLog.created_at.desc()).offset(skip).limit(limit).all()
    return [
        {
            "id": row.id,
            "actor_user_id": row.actor_user_id,
            "action": row.action,
            "target_type": row.target_type,
            "target_id": row.target_id,
            "project_id": row.project_id,
            "task_id": row.task_id,
            "result": row.result,
            "detail": _json_loads(row.detail_json, {}),
            "created_at": row.created_at,
        }
        for row in rows
    ]
