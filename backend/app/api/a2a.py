import asyncio
import json
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional, Tuple

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.nanobot import nanobot_service
from app.core.security import CurrentUser, get_current_user
from app.database import SessionLocal, get_db
from app.models.a2a import (
    A2AAuditLog,
    A2AArtifact,
    A2AMessage,
    A2APart,
    A2AProjectConfig,
    A2ARemoteAgent,
    A2ATask,
    A2ATaskEvent,
    A2ATaskWebhook,
    A2AWebhookDelivery,
    A2ATaskState,
)
from app.models.project import Project
from app.schemas.a2a import (
    A2AMessageCreateSchema,
    A2AMessageSchema,
    A2AMessageRole,
    A2APartSchema,
    A2ATaskSchema,
    A2ATaskWithHistorySchema,
    A2ATaskWithMessagesSchema,
    A2AArtifactSchema,
    A2ATaskStatusSchema,
    TaskStatusUpdateEvent,
    TaskArtifactUpdateEvent,
    TaskMessageEvent,
    StreamResponse,
    StreamResponseTask,
    SendMessageRequest,
    SendStreamingMessageRequest,
    GetTaskRequest,
    TaskListRequest,
    CancelTaskRequest,
    PushNotificationConfigCreate,
    PushNotificationConfig,
    A2ATaskState as SchemaTaskState,
    AgentCardPublicSchema,
    AgentCardExtendedSchema,
    AgentSkill,
    AgentProvider,
    AgentSupportedInterface,
    SecuritySchemeApiKey,
    SecuritySchemeHttpAuth,
    SecuritySchemeOAuth2,
    SecuritySchemeOpenIdConnect,
    SecuritySchemeMtls,
    OAuth2Flows,
    VersionNotSupportedError,
)
from app.services.a2a_service import _json_dumps, _json_loads, a2a_runtime, RemoteAgentSecuritySelector
from app.trace import build_error_attributes, trace_service

router = APIRouter()
A2A_API_PREFIX = "/a2a"

SUPPORTED_PROTOCOL_VERSION = "1.0"
SUPPORTED_CAPABILITIES = ["streaming", "push", "task_management", "subscribe"]
SUPPORTED_AUTH = ["bearer", "shared_secret", "none"]


async def verify_a2a_version(
    response: Response,
    a2a_version: Optional[str] = Header(default=None, alias="A2A-Version"),
) -> None:
    if a2a_version is not None and a2a_version != SUPPORTED_PROTOCOL_VERSION:
        error = VersionNotSupportedError(
            code=-32009,
            message=f"Protocol version '{a2a_version}' not supported. Supported version is '{SUPPORTED_PROTOCOL_VERSION}'.",
            data={"supportedVersion": SUPPORTED_PROTOCOL_VERSION},
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=json.dumps(error.model_dump(), ensure_ascii=False),
        )
    response.headers["A2A-Version"] = SUPPORTED_PROTOCOL_VERSION


async def verify_shared_secret(
    request_data: bytes,
    x_a2a_signature: Optional[str] = Header(default=None, alias="X-A2A-Signature"),
    x_a2a_timestamp: Optional[str] = Header(default=None, alias="X-A2A-Timestamp"),
    shared_secret: Optional[str] = None,
) -> bool:
    if not x_a2a_signature or not x_a2a_timestamp:
        return False
    if not shared_secret:
        return False
    try:
        from app.services.a2a_service import SharedSecretAuth
        timestamp = int(x_a2a_timestamp)
        return SharedSecretAuth.verify_signature(shared_secret, request_data, x_a2a_signature, timestamp)
    except (ValueError, TypeError):
        return False


def get_user_bearer_token(current_user: CurrentUser) -> str:
    from app.core.security import create_access_token
    return create_access_token({"sub": str(current_user.id), "is_admin": current_user.is_admin})


class A2AStreamingResponse(StreamingResponse):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.headers["A2A-Version"] = SUPPORTED_PROTOCOL_VERSION


def _mask_error(message: str) -> str:
    if not message:
        return "internal_error"
    return "request_failed"


def _json_serialize(obj: Any) -> Any:
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, enum.Enum):
        return obj.value
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


AGENT_SKILLS = [
    AgentSkill(
        id="dataclaw-data-analysis",
        name="Data Analysis",
        description="Analyze datasets, generate insights, and produce visualizations",
        tags=["data", "analysis", "analytics", "visualization"],
        examples=[],
        inputModes=["text", "data"],
        outputModes=["text", "artifact", "stream"],
        securityRequirements=[],
    ),
    AgentSkill(
        id="dataclaw-nl2sql",
        name="Natural Language to SQL",
        description="Convert natural language queries into SQL statements",
        tags=["nl2sql", "sql", "query", "database"],
        examples=[],
        inputModes=["text"],
        outputModes=["text", "data"],
        securityRequirements=[],
    ),
    AgentSkill(
        id="dataclaw-artifact-preview",
        name="Artifact Preview & Download",
        description="Generate and serve previews for data artifacts",
        tags=["artifact", "preview", "download", "export"],
        examples=[],
        inputModes=["text", "data"],
        outputModes=["artifact", "stream"],
        securityRequirements=[],
    ),
]

AGENT_PROVIDER = AgentProvider(
    organization="DataClaw",
    url="https://dataclaw.io",
)

AGENT_SUPPORTED_INTERFACES = [
    AgentSupportedInterface(
        url="/message:send",
        protocolBinding="http",
        protocolVersion="1.0",
    ),
    AgentSupportedInterface(
        url="/message:stream",
        protocolBinding="http",
        protocolVersion="1.0",
    ),
]

AGENT_SECURITY_SCHEMES = {
    "bearer": SecuritySchemeHttpAuth(scheme="bearer", description="JWT Bearer token authentication"),
    "apiKey": SecuritySchemeApiKey(name="X-API-Key", in_="header", description="API key authentication"),
    "oauth2": SecuritySchemeOAuth2(
        flows=OAuth2Flows(
            authorizationCode={
                "authorizationUrl": "/oauth/authorize",
                "tokenUrl": "/oauth/token",
                "scopes": {"read": "Read access", "write": "Write access"},
            },
            clientCredentials={"tokenUrl": "/oauth/token", "scopes": {"read": "Read access", "write": "Write access"}},
            deviceCode={"authorizationUrl": "/oauth/device", "tokenUrl": "/oauth/token", "scopes": {"read": "Read access", "write": "Write access"}},
        ),
        description="OAuth2 authentication",
    ),
    "openIdConnect": SecuritySchemeOpenIdConnect(
        openIdConnectUrl="/.well-known/openid-configuration",
        description="OpenID Connect authentication",
        scopes={"openid": "OpenID scope", "profile": "Profile scope"},
    ),
    "mutualTLS": SecuritySchemeMtls(
        description="Mutual TLS authentication",
        caCerts=[],
        clientCert=None,
        clientKey=None,
    ),
    "shared_secret": SecuritySchemeHttpAuth(scheme="hmac-sha256", description="HMAC-SHA256 shared secret authentication"),
}


def _build_public_agent_card() -> AgentCardPublicSchema:
    return AgentCardPublicSchema(
        name="DataClaw A2A Gateway",
        protocol_version=SUPPORTED_PROTOCOL_VERSION,
        capabilities=SUPPORTED_CAPABILITIES,
        endpoints={
            "sendMessage": "/message:send",
            "sendStreamingMessage": "/message:stream",
            "getTask": "/tasks/{task_id}",
            "listTasks": "/tasks",
            "cancelTask": "/tasks/{task_id}:cancel",
            "subscribeTask": "/tasks/{task_id}:subscribe",
            "pushNotificationConfig": "/tasks/{task_id}/pushNotificationConfigs",
        },
        auth=SUPPORTED_AUTH,
        skills=AGENT_SKILLS,
        provider=AGENT_PROVIDER,
        supportedInterfaces=AGENT_SUPPORTED_INTERFACES,
        defaultInputModes=["text", "data"],
        defaultOutputModes=["text", "artifact", "stream"],
        iconUrl="https://dataclaw.io/icon.png",
        documentationUrl="https://docs.dataclaw.io/a2a",
    )


def _build_extended_agent_card(current_user: CurrentUser) -> AgentCardExtendedSchema:
    public_card = _build_public_agent_card()
    return AgentCardExtendedSchema(
        **public_card.model_dump(),
        securitySchemes=AGENT_SECURITY_SCHEMES,
        security=[{"bearer": []}, {"apiKey": []}],
        signatures=[],
        tenantId=current_user.id,
        isAdmin=current_user.is_admin,
    )


class RemoteAgentCreate(BaseModel):
    project_id: int
    name: str = Field(min_length=1, max_length=120)
    base_url: str = Field(min_length=1, max_length=500)
    auth_scheme: Literal["none", "bearer", "shared_secret", "oauth2", "openIdConnect", "mutualTLS"] = "none"
    auth_token: Optional[str] = None
    shared_secret: Optional[str] = None
    mtls_ca_cert: Optional[str] = None
    mtls_client_cert: Optional[str] = None
    mtls_client_key: Optional[str] = None
    oauth2_client_id: Optional[str] = None
    oauth2_client_secret: Optional[str] = None
    oauth2_token_url: Optional[str] = None
    oauth2_scopes: Optional[str] = None
    oidc_issuer_url: Optional[str] = None
    oidc_client_id: Optional[str] = None
    oidc_client_secret: Optional[str] = None


class RemoteAgentUpdate(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    auth_scheme: Optional[Literal["none", "bearer", "shared_secret", "oauth2", "openIdConnect", "mutualTLS"]] = None
    auth_token: Optional[str] = None
    shared_secret: Optional[str] = None
    mtls_ca_cert: Optional[str] = None
    mtls_client_cert: Optional[str] = None
    mtls_client_key: Optional[str] = None
    oauth2_client_id: Optional[str] = None
    oauth2_client_secret: Optional[str] = None
    oauth2_token_url: Optional[str] = None
    oauth2_scopes: Optional[str] = None
    oidc_issuer_url: Optional[str] = None
    oidc_client_id: Optional[str] = None
    oidc_client_secret: Optional[str] = None


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
    shared_secret_configured: bool = False
    mtls_configured: bool = False
    oauth2_configured: bool = False
    oidc_configured: bool = False


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


def _task_to_schema(task: A2ATask) -> A2ATaskSchema:
    return A2ATaskSchema(
        id=task.id,
        contextId=task.context_id,
        projectId=task.project_id,
        tenantId=task.tenant_id,
        source=task.source,
        remoteAgentId=task.remote_agent_id,
        idempotencyKey=task.idempotency_key,
        state=SchemaTaskState(task.state.value),
        inputText=task.input_text,
        outputText=task.output_text,
        errorMessage=task.error_message,
        metadata=_json_loads(task.metadata_json, {}),
        historyLength=task.history_length or 0,
        createdAt=task.created_at,
        updatedAt=task.updated_at,
        finishedAt=task.finished_at,
    )


def _task_to_with_history(task: A2ATask, history_length: Optional[int] = None) -> A2ATaskWithHistorySchema:
    query = db.query(A2AMessage).filter(A2AMessage.task_id == task.id)
    if history_length is not None and history_length > 0:
        query = query.order_by(A2AMessage.id.desc()).limit(history_length)
        messages = query.all()
        messages = list(reversed(messages))
    else:
        messages = query.order_by(A2AMessage.id.asc()).all()

    message_schemas = []
    for msg in messages:
        parts = db.query(A2APart).filter(A2APart.message_id == msg.id).all()
        part_schemas = []
        for p in parts:
            part_schemas.append(A2APartSchema(
                part_type=p.part_type,
                text=p.text_content,
                raw=p.raw_content,
                url=p.url_content,
                data=p.data_content,
                mediaType=p.media_type,
                filename=p.filename,
                metadata=_json_loads(p.metadata_json, {}),
            ))
        message_schemas.append(A2AMessageSchema(
            messageId=msg.message_id,
            contextId=msg.context_id,
            taskId=msg.task_id,
            role=msg.role,
            parts=part_schemas,
            extensions=_json_loads(msg.extensions_json, {}),
            referenceTaskIds=_json_loads(msg.reference_task_ids_json, []),
            createdAt=msg.created_at,
        ))

    artifacts = db.query(A2AArtifact).filter(A2AArtifact.task_id == task.id).all()
    artifact_schemas = []
    for art in artifacts:
        parts = db.query(A2APart).filter(A2APart.artifact_id == art.id).all()
        part_schemas = []
        for p in parts:
            part_schemas.append(A2APartSchema(
                part_type=p.part_type,
                text=p.text_content,
                raw=p.raw_content,
                url=p.url_content,
                data=p.data_content,
                mediaType=p.media_type,
                filename=p.filename,
                metadata=_json_loads(p.metadata_json, {}),
            ))
        artifact_schemas.append(A2AArtifactSchema(
            artifactId=art.artifact_id,
            name=art.name,
            description=art.description,
            parts=part_schemas,
            metadata=_json_loads(art.metadata_json, {}),
            extensions=_json_loads(art.extensions_json, {}),
            createdAt=art.created_at,
            updatedAt=art.updated_at,
        ))

    return A2ATaskWithHistorySchema(
        id=task.id,
        contextId=task.context_id,
        projectId=task.project_id,
        tenantId=task.tenant_id,
        state=SchemaTaskState(task.state.value),
        history=message_schemas,
        artifacts=artifact_schemas,
        createdAt=task.created_at,
        updatedAt=task.updated_at,
        finishedAt=task.finished_at,
    )


def _task_to_with_messages(task: A2ATask) -> A2ATaskWithMessagesSchema:
    messages = db.query(A2AMessage).filter(A2AMessage.task_id == task.id).order_by(A2AMessage.id.asc()).all()
    message_schemas = []
    for msg in messages:
        parts = db.query(A2APart).filter(A2APart.message_id == msg.id).all()
        part_schemas = []
        for p in parts:
            part_schemas.append(A2APartSchema(
                part_type=p.part_type,
                text=p.text_content,
                raw=p.raw_content,
                url=p.url_content,
                data=p.data_content,
                mediaType=p.media_type,
                filename=p.filename,
                metadata=_json_loads(p.metadata_json, {}),
            ))
        message_schemas.append(A2AMessageSchema(
            messageId=msg.message_id,
            contextId=msg.context_id,
            taskId=msg.task_id,
            role=msg.role,
            parts=part_schemas,
            extensions=_json_loads(msg.extensions_json, {}),
            referenceTaskIds=_json_loads(msg.reference_task_ids_json, []),
            createdAt=msg.created_at,
        ))

    artifacts = db.query(A2AArtifact).filter(A2AArtifact.task_id == task.id).all()
    artifact_schemas = []
    for art in artifacts:
        parts = db.query(A2APart).filter(A2APart.artifact_id == art.id).all()
        part_schemas = []
        for p in parts:
            part_schemas.append(A2APartSchema(
                part_type=p.part_type,
                text=p.text_content,
                raw=p.raw_content,
                url=p.url_content,
                data=p.data_content,
                mediaType=p.media_type,
                filename=p.filename,
                metadata=_json_loads(p.metadata_json, {}),
            ))
        artifact_schemas.append(A2AArtifactSchema(
            artifactId=art.artifact_id,
            name=art.name,
            description=art.description,
            parts=part_schemas,
            metadata=_json_loads(art.metadata_json, {}),
            extensions=_json_loads(art.extensions_json, {}),
            createdAt=art.created_at,
            updatedAt=art.updated_at,
        ))

    return A2ATaskWithMessagesSchema(
        id=task.id,
        contextId=task.context_id,
        projectId=task.project_id,
        tenantId=task.tenant_id,
        source=task.source,
        remoteAgentId=task.remote_agent_id,
        idempotencyKey=task.idempotency_key,
        state=SchemaTaskState(task.state.value),
        inputText=task.input_text,
        outputText=task.output_text,
        errorMessage=task.error_message,
        metadata=_json_loads(task.metadata_json, {}),
        historyLength=task.history_length or 0,
        createdAt=task.created_at,
        updatedAt=task.updated_at,
        finishedAt=task.finished_at,
        messages=message_schemas,
        artifacts=artifact_schemas,
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
        shared_secret_configured=bool(agent.shared_secret),
        mtls_configured=bool(agent.mtls_client_cert and agent.mtls_client_key),
        oauth2_configured=bool(agent.oauth2_client_id and agent.oauth2_token_url),
        oidc_configured=bool(agent.oidc_issuer_url),
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


def _part_to_model(part_schema: A2APartSchema) -> Dict[str, Any]:
    return {
        "text": part_schema.text,
        "raw": part_schema.raw,
        "url": part_schema.url,
        "data": part_schema.data,
        "mediaType": part_schema.mediaType,
        "filename": part_schema.filename,
        "metadata": part_schema.metadata or {},
    }


def _message_to_task_input(message: A2AMessageCreateSchema) -> str:
    text_parts = []
    for part in message.parts:
        if part.part_type.value == "text" and part.text:
            text_parts.append(part.text)
        elif part.part_type.value == "data" and part.data:
            text_parts.append(str(part.data))
    return "\n".join(text_parts) if text_parts else ""


async def _delegate_to_remote(task: A2ATask, agent: A2ARemoteAgent, message: str) -> Tuple[str, Dict[str, Any]]:
    security_selector = RemoteAgentSecuritySelector(agent)
    security_selector.load_security_from_card()
    preferred_scheme = security_selector.get_preferred_auth_scheme()

    payload = {
        "project_id": task.project_id,
        "message": message,
        "session_id": f"a2a-delegate:{task.id}",
        "idempotency_key": task.idempotency_key,
        "route_mode": "local_first",
        "metadata": {"delegated_by": "dataclaw", "task_id": task.id},
    }
    body_bytes = json.dumps(payload).encode("utf-8")
    url = f"{agent.base_url.rstrip('/')}/api/v1/a2a/messages/send"
    path = "/api/v1/a2a/messages/send"

    headers: Dict[str, str] = {"Content-Type": "application/json"}

    if preferred_scheme == "shared_secret" and agent.shared_secret:
        sig_headers = security_selector.create_signed_request_headers("POST", path, body_bytes)
        headers.update(sig_headers)
    else:
        auth_headers = await security_selector.authorize_request("POST", url)
        headers.update(auth_headers)

    mtls_context = security_selector.get_mtls_context()

    if mtls_context:
        async with httpx.AsyncClient(timeout=25.0, ssl=mtls_context) as client:
            resp = await client.post(url, content=body_bytes, headers=headers)
    else:
        async with httpx.AsyncClient(timeout=25.0, verify=True) as client:
            resp = await client.post(url, content=body_bytes, headers=headers)

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
        if task.state in {A2ATaskState.CANCELED, A2ATaskState.REJECTED}:
            return
        with trace_service.start_span("a2a.task.execute", attributes={"task_id": task.id, "project_id": task.project_id, "source": task.source}) as span:
            start_ts = datetime.utcnow().timestamp()
            try:
                task = a2a_runtime.transition_task(db, task, to_state=A2ATaskState.WORKING)
                status_event = _build_status_event(task, compatibility_mode=config.compatibility_mode, dual_event_write=config.dual_event_write)
                status_row = a2a_runtime.append_event(db, task, "TaskStatusUpdateEvent", status_event)
                await a2a_runtime.publish(task.id, status_event)
                await a2a_runtime.notify_webhooks(db, task, status_row)

                input_message = db.query(A2AMessage).filter(A2AMessage.task_id == task.id).order_by(A2AMessage.id.asc()).first()
                message_text = _message_to_task_input(request.message) if input_message is None else task.input_text

                if task.source == "a2a" and task.remote_agent_id:
                    agent = db.query(A2ARemoteAgent).filter(A2ARemoteAgent.id == task.remote_agent_id).first()
                    if not agent:
                        raise RuntimeError("remote_agent_missing")
                    response_text, metadata = await _delegate_to_remote(task, agent, message_text)
                else:
                    response_text = await nanobot_service.process_message(
                        message_text,
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
                    to_state=A2ATaskState.COMPLETED,
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
                if task and task.state not in {A2ATaskState.COMPLETED, A2ATaskState.FAILED, A2ATaskState.CANCELED, A2ATaskState.REJECTED}:
                    task = a2a_runtime.transition_task(db, task, to_state=A2ATaskState.FAILED, error_message=_json_dumps({"message": _mask_error(str(exc))}))
                    fail_event = _build_status_event(task, compatibility_mode=task.compatibility_mode, dual_event_write=True)
                    fail_row = a2a_runtime.append_event(db, task, "TaskStatusUpdateEvent", fail_event)
                    await a2a_runtime.publish(task.id, fail_event)
                    await a2a_runtime.notify_webhooks(db, task, fail_row)
    finally:
        db.close()


@router.get("/.well-known/agent-card.json", response_model=AgentCardPublicSchema)
def get_agent_card_public() -> AgentCardPublicSchema:
    return _build_public_agent_card()


@router.get(f"{A2A_API_PREFIX}/agent-card", response_model=AgentCardPublicSchema)
def get_agent_card() -> AgentCardPublicSchema:
    return _build_public_agent_card()


@router.get(f"{A2A_API_PREFIX}/remote-agents", response_model=List[RemoteAgentView])
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


@router.post(f"{A2A_API_PREFIX}/remote-agents", response_model=RemoteAgentView, status_code=status.HTTP_201_CREATED)
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
        shared_secret=payload.shared_secret,
        mtls_ca_cert=payload.mtls_ca_cert,
        mtls_client_cert=payload.mtls_client_cert,
        mtls_client_key=payload.mtls_client_key,
        oauth2_client_id=payload.oauth2_client_id,
        oauth2_client_secret=payload.oauth2_client_secret,
        oauth2_token_url=payload.oauth2_token_url,
        oauth2_scopes=payload.oauth2_scopes,
        oidc_issuer_url=payload.oidc_issuer_url,
        oidc_client_id=payload.oidc_client_id,
        oidc_client_secret=payload.oidc_client_secret,
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


@router.put(f"{A2A_API_PREFIX}/remote-agents/{{agent_id}}", response_model=RemoteAgentView)
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


@router.delete(f"{A2A_API_PREFIX}/remote-agents/{{agent_id}}")
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


@router.post(f"{A2A_API_PREFIX}/remote-agents/{{agent_id}}/refresh-card", response_model=RemoteAgentView)
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


@router.post(f"{A2A_API_PREFIX}/remote-agents/{{agent_id}}/health-check")
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


@router.post("/message:send")
async def send_message(
    request: SendMessageRequest,
    response: Response,
    x_a2a_token: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
    _version_check: None = Depends(verify_a2a_version),
) -> StreamResponse:
    message = request.message
    project_id = message.parts[0].data.get("project_id") if message.parts and message.parts[0].data else None
    if not project_id:
        raise HTTPException(status_code=400, detail="project_id required in message part data")

    _ensure_project_access(db, project_id, current_user)
    config = a2a_runtime.get_project_config(db, project_id, current_user.id)

    message_id_str = message.messageId
    context_id = request.contextId or message.contextId
    task_id = request.taskId or message.taskId

    existing_task = None
    if task_id:
        existing_task = db.query(A2ATask).filter(A2ATask.id == task_id).first()
        if existing_task and existing_task.tenant_id != current_user.id and not current_user.is_admin:
            raise HTTPException(status_code=404, detail="Task not found")

    input_text = _message_to_task_input(message)

    if existing_task:
        msg_record = A2AMessage(
            message_id=message_id_str,
            context_id=context_id,
            task_id=existing_task.id,
            role=message.role,
            extensions_json=_json_dumps(message.extensions or {}),
            reference_task_ids_json=_json_dumps(message.referenceTaskIds or []),
        )
        db.add(msg_record)
        for idx, part in enumerate(message.parts):
            part_record = A2APart(
                message_id=msg_record.id,
                part_type=part.part_type,
                text_content=part.text,
                raw_content=part.raw,
                url_content=part.url,
                data_content=str(part.data) if part.data else None,
                media_type=part.mediaType,
                filename=part.filename,
                metadata_json=_json_dumps(part.metadata or {}),
            )
            db.add(part_record)
        db.commit()
        asyncio.create_task(_run_task(existing_task.id, request, current_user.id))
        return StreamResponse(
            task=StreamResponseTask(
                id=existing_task.id,
                contextId=existing_task.context_id,
                state=SchemaTaskState(existing_task.state.value),
                artifacts=[],
            )
        )

    route_selected = "local"
    remote_agent_id = None
    agent = None
    if message.parts and message.parts[0].data:
        route_mode = message.parts[0].data.get("route_mode", "auto")
        remote_agent_id_param = message.parts[0].data.get("remote_agent_id")
        if route_mode == "a2a" and remote_agent_id_param:
            agent = _ensure_agent_access(db, remote_agent_id_param, current_user)
            if not agent.healthy and config.rollback_to_local:
                route_selected = "local"
            else:
                route_selected = "a2a"
                remote_agent_id = agent.id

    idempotency_key = message.parts[0].data.get("idempotency_key") if message.parts and message.parts[0].data else None
    metadata = message.parts[0].data.get("metadata", {}) if message.parts and message.parts[0].data else {}

    task = a2a_runtime.create_task(
        db,
        project_id=project_id,
        tenant_id=current_user.id,
        source=route_selected,
        input_text=input_text,
        idempotency_key=idempotency_key,
        remote_agent_id=remote_agent_id,
        compatibility_mode=config.compatibility_mode,
        metadata={"route_selected": route_selected, "token_present": bool(x_a2a_token), "request_metadata": metadata},
        context_id=context_id,
    )

    msg_record = A2AMessage(
        message_id=message_id_str,
        context_id=context_id,
        task_id=task.id,
        role=message.role,
        extensions_json=_json_dumps(message.extensions or {}),
        reference_task_ids_json=_json_dumps(message.referenceTaskIds or []),
    )
    db.add(msg_record)
    for idx, part in enumerate(message.parts):
        part_record = A2APart(
            message_id=msg_record.id,
            part_type=part.part_type,
            text_content=part.text,
            raw_content=part.raw,
            url_content=part.url,
            data_content=str(part.data) if part.data else None,
            media_type=part.mediaType,
            filename=part.filename,
            metadata_json=_json_dumps(part.metadata or {}),
        )
        db.add(part_record)

    task.context_id = context_id
    db.commit()

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

    task_record = db.query(A2ATask).filter(A2ATask.id == task.id).first()
    return StreamResponse(
        task=StreamResponseTask(
            id=task_record.id,
            contextId=task_record.context_id,
            state=SchemaTaskState(task_record.state.value),
            artifacts=[],
        )
    )


@router.post("/message:stream")
async def send_streaming_message(
    request: SendStreamingMessageRequest,
    response: Response,
    x_a2a_token: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
    _version_check: None = Depends(verify_a2a_version),
) -> StreamingResponse:
    message = request.message
    project_id = message.parts[0].data.get("project_id") if message.parts and message.parts[0].data else None
    if not project_id:
        raise HTTPException(status_code=400, detail="project_id required in message part data")

    _ensure_project_access(db, project_id, current_user)
    config = a2a_runtime.get_project_config(db, project_id, current_user.id)

    message_id_str = message.messageId
    context_id = request.contextId or message.contextId
    task_id = request.taskId or message.taskId

    existing_task = None
    if task_id:
        existing_task = db.query(A2ATask).filter(A2ATask.id == task_id).first()

    input_text = _message_to_task_input(message)

    task_context_id = None
    if existing_task:
        msg_record = A2AMessage(
            message_id=message_id_str,
            context_id=context_id,
            task_id=existing_task.id,
            role=message.role,
            extensions_json=_json_dumps(message.extensions or {}),
            reference_task_ids_json=_json_dumps(message.referenceTaskIds or []),
        )
        db.add(msg_record)
        for idx, part in enumerate(message.parts):
            part_record = A2APart(
                message_id=msg_record.id,
                part_type=part.part_type,
                text_content=part.text,
                raw_content=part.raw,
                url_content=part.url,
                data_content=str(part.data) if part.data else None,
                media_type=part.mediaType,
                filename=part.filename,
                metadata_json=_json_dumps(part.metadata or {}),
            )
            db.add(part_record)
        db.commit()
        task_context_id = existing_task.context_id
        asyncio.create_task(_run_task(existing_task.id, request, current_user.id))
        task_id = existing_task.id
    else:
        route_selected = "local"
        remote_agent_id = None
        if message.parts and message.parts[0].data:
            route_mode = message.parts[0].data.get("route_mode", "auto")
            remote_agent_id_param = message.parts[0].data.get("remote_agent_id")
            if route_mode == "a2a" and remote_agent_id_param:
                agent = _ensure_agent_access(db, remote_agent_id_param, current_user)
                if not agent.healthy and config.rollback_to_local:
                    route_selected = "local"
                else:
                    route_selected = "a2a"
                    remote_agent_id = agent.id

        idempotency_key = message.parts[0].data.get("idempotency_key") if message.parts and message.parts[0].data else None
        metadata = message.parts[0].data.get("metadata", {}) if message.parts and message.parts[0].data else {}

        task = a2a_runtime.create_task(
            db,
            project_id=project_id,
            tenant_id=current_user.id,
            source=route_selected,
            input_text=input_text,
            idempotency_key=idempotency_key,
            remote_agent_id=remote_agent_id,
            compatibility_mode=config.compatibility_mode,
            metadata={"route_selected": route_selected, "token_present": bool(x_a2a_token), "request_metadata": metadata},
            context_id=context_id,
        )

        msg_record = A2AMessage(
            message_id=message_id_str,
            context_id=context_id,
            task_id=task.id,
            role=message.role,
            extensions_json=_json_dumps(message.extensions or {}),
            reference_task_ids_json=_json_dumps(message.referenceTaskIds or []),
        )
        db.add(msg_record)
        for idx, part in enumerate(message.parts):
            part_record = A2APart(
                message_id=msg_record.id,
                part_type=part.part_type,
                text_content=part.text,
                raw_content=part.raw,
                url_content=part.url,
                data_content=str(part.data) if part.data else None,
                media_type=part.mediaType,
                filename=part.filename,
                metadata_json=_json_dumps(part.metadata or {}),
            )
            db.add(part_record)

        task.context_id = context_id
        db.commit()
        task_context_id = task.context_id

        event_payload = _build_status_event(task, compatibility_mode=config.compatibility_mode, dual_event_write=config.dual_event_write)
        event_row = a2a_runtime.append_event(db, task, "TaskStatusUpdateEvent", event_payload)
        await a2a_runtime.publish(task.id, event_payload)
        await a2a_runtime.notify_webhooks(db, task, event_row)
        asyncio.create_task(_run_task(task.id, request, current_user.id))
        task_id = task.id

    async def _collect_events_to_queue(task_id: str, queue: asyncio.Queue, context_id: Optional[str]) -> None:
        try:
            history = (
                db.query(A2ATaskEvent)
                .filter(A2ATaskEvent.task_id == task_id)
                .order_by(A2ATaskEvent.id.asc())
                .all()
            )
            for item in history:
                payload = _json_loads(item.payload_json, {})
                if payload.get("type") == "TaskStatusUpdateEvent":
                    task_obj = db.query(A2ATask).filter(A2ATask.id == task_id).first()
                    event = TaskStatusUpdateEvent(
                        taskId=task_id,
                        contextId=task_obj.context_id if task_obj else context_id,
                        status=A2ATaskStatusSchema(
                            state=SchemaTaskState(payload.get("task_status", "WORKING")),
                            timestamp=datetime.utcnow(),
                        ),
                        metadata=payload.get("metadata", {}),
                    )
                    await queue.put(("TaskStatusUpdateEvent", event.model_dump(mode='json')))
                elif payload.get("type") == "TaskArtifactUpdateEvent":
                    task_obj = db.query(A2ATask).filter(A2ATask.id == task_id).first()
                    content = payload.get("artifact", {}).get("content", "")
                    event = TaskArtifactUpdateEvent(
                        taskId=task_id,
                        contextId=task_obj.context_id if task_obj else context_id,
                        artifact=A2AArtifactSchema(
                            artifactId=f"artifact-{item.id}",
                            parts=[A2APartSchema(part_type="text", text=content)],
                        ),
                        append=False,
                        lastChunk=True,
                    )
                    await queue.put(("TaskArtifactUpdateEvent", event.model_dump(mode='json')))
                elif payload.get("type") == "Message":
                    msg_event = TaskMessageEvent(
                        message=A2AMessageSchema(
                            messageId=payload.get("messageId", ""),
                            contextId=payload.get("contextId", context_id),
                            taskId=task_id,
                            role=A2AMessageRole(payload.get("role", "agent")),
                            parts=[A2APartSchema(part_type="text", text=payload.get("content", ""))],
                        )
                    )
                    await queue.put(("Message", msg_event.model_dump(mode='json')))
                else:
                    await queue.put(("raw", payload))

            async for payload in a2a_runtime.subscribe(task_id):
                if payload.get("type") == "TaskStatusUpdateEvent":
                    task_obj = db.query(A2ATask).filter(A2ATask.id == task_id).first()
                    event = TaskStatusUpdateEvent(
                        taskId=task_id,
                        contextId=task_obj.context_id if task_obj else context_id,
                        status=A2ATaskStatusSchema(
                            state=SchemaTaskState(payload.get("task_status", "WORKING")),
                            timestamp=datetime.utcnow(),
                        ),
                        metadata=payload.get("metadata", {}),
                    )
                    await queue.put(("TaskStatusUpdateEvent", event.model_dump(mode='json')))
                elif payload.get("type") == "TaskArtifactUpdateEvent":
                    task_obj = db.query(A2ATask).filter(A2ATask.id == task_id).first()
                    content = payload.get("artifact", {}).get("content", "")
                    event = TaskArtifactUpdateEvent(
                        taskId=task_id,
                        contextId=task_obj.context_id if task_obj else context_id,
                        artifact=A2AArtifactSchema(
                            artifactId=f"artifact-stream-{datetime.utcnow().timestamp()}",
                            parts=[A2APartSchema(part_type="text", text=content)],
                        ),
                        append=False,
                        lastChunk=True,
                    )
                    await queue.put(("TaskArtifactUpdateEvent", event.model_dump(mode='json')))
                elif payload.get("type") == "Message":
                    msg_event = TaskMessageEvent(
                        message=A2AMessageSchema(
                            messageId=payload.get("messageId", ""),
                            contextId=payload.get("contextId", context_id),
                            taskId=task_id,
                            role=A2AMessageRole(payload.get("role", "agent")),
                            parts=[A2APartSchema(part_type="text", text=payload.get("content", ""))],
                        )
                    )
                    await queue.put(("Message", msg_event.model_dump(mode='json')))
                else:
                    await queue.put(("raw", payload))

                if payload.get("task_status") in {"COMPLETED", "FAILED", "CANCELED", "REJECTED"}:
                    await queue.put(("terminal", None))
                    break
        except Exception:
            await queue.put(("error", None))
        finally:
            await queue.put(("close", None))

    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue(maxsize=200)
        collector = asyncio.create_task(_collect_events_to_queue(task_id, queue, task_context_id))

        message_only = True
        while True:
            event_type, event_data = await queue.get()
            if event_type == "close":
                break
            if event_type == "error":
                break
            if event_type == "terminal":
                yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
                break
            if event_type in ("TaskStatusUpdateEvent", "TaskArtifactUpdateEvent"):
                message_only = False
            yield f"data: {json.dumps(event_data, ensure_ascii=False, default=_json_serialize)}\n\n"
            if event_type == "Message":
                break

        if message_only:
            yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"

        collector.cancel()

    return A2AStreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.get("/tasks/{{task_id}}")
def get_task(
    task_id: str,
    response: Response,
    historyLength: Optional[int] = Query(default=None, description="Number of history messages to include"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
    _version_check: None = Depends(verify_a2a_version),
) -> A2ATaskWithHistorySchema:
    task = _ensure_task_access(db, task_id, current_user)
    return _task_to_with_history(task, history_length=historyLength)


@router.get("/tasks")
def list_tasks(
    response: Response,
    contextId: Optional[str] = Query(default=None, description="Filter by context ID"),
    status: Optional[SchemaTaskState] = Query(default=None, description="Filter by task status"),
    pageSize: int = Query(default=20, ge=1, le=100, description="Number of items per page"),
    pageToken: Optional[str] = Query(default=None, description="Pagination token"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
    _version_check: None = Depends(verify_a2a_version),
) -> Dict[str, Any]:
    query = db.query(A2ATask)
    if not current_user.is_admin:
        query = query.filter(A2ATask.tenant_id == current_user.id)

    if contextId:
        query = query.filter(A2ATask.context_id == contextId)
    if status:
        query = query.filter(A2ATask.state == A2ATaskState(status.value))

    total = query.count()
    tasks = query.order_by(A2ATask.created_at.desc()).offset(0).limit(pageSize).all()

    task_schemas = [_task_to_schema(item) for item in tasks]

    return {
        "items": [t.model_dump(mode='json') for t in task_schemas],
        "nextPageToken": str(tasks[-1].id) if tasks else None,
        "contextId": contextId,
    }


@router.post("/tasks/{task_id}:cancel")
async def cancel_task(
    task_id: str,
    request: CancelTaskRequest,
    response: Response,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
    _version_check: None = Depends(verify_a2a_version),
) -> CancelTaskResponse:
    task = _ensure_task_access(db, task_id, current_user)
    if task.state in {A2ATaskState.COMPLETED, A2ATaskState.FAILED, A2ATaskState.CANCELED, A2ATaskState.REJECTED}:
        return CancelTaskResponse(task_id=task.id, state=task.state.value)
    try:
        task = a2a_runtime.transition_task(db, task, to_state=A2ATaskState.CANCELED)
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
    return CancelTaskResponse(task_id=task.id, state=task.state.value)


@router.get("/tasks/{task_id}:subscribe")
async def subscribe_task(
    task_id: str,
    response: Response,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
    _version_check: None = Depends(verify_a2a_version),
) -> StreamingResponse:
    task = _ensure_task_access(db, task_id, current_user)

    async def _collect_subscribe_events_to_queue(task_id: str, queue: asyncio.Queue, context_id: Optional[str]) -> None:
        try:
            initial_events = (
                db.query(A2ATaskEvent)
                .filter(A2ATaskEvent.task_id == task_id)
                .order_by(A2ATaskEvent.id.asc())
                .all()
            )
            for event in initial_events:
                payload = _json_loads(event.payload_json, {})
                if payload.get("type") == "TaskStatusUpdateEvent":
                    evt = TaskStatusUpdateEvent(
                        taskId=task_id,
                        contextId=context_id,
                        status=A2ATaskStatusSchema(
                            state=SchemaTaskState(payload.get("task_status", "WORKING")),
                            timestamp=datetime.utcnow(),
                        ),
                        metadata=payload.get("metadata", {}),
                    )
                    await queue.put(("TaskStatusUpdateEvent", evt.model_dump(mode='json')))
                elif payload.get("type") == "TaskArtifactUpdateEvent":
                    content = payload.get("artifact", {}).get("content", "")
                    evt = TaskArtifactUpdateEvent(
                        taskId=task_id,
                        contextId=context_id,
                        artifact=A2AArtifactSchema(
                            artifactId=f"artifact-{event.id}",
                            parts=[A2APartSchema(part_type="text", text=content)],
                        ),
                        append=False,
                        lastChunk=True,
                    )
                    await queue.put(("TaskArtifactUpdateEvent", evt.model_dump(mode='json')))
                elif payload.get("type") == "Message":
                    msg_event = TaskMessageEvent(
                        message=A2AMessageSchema(
                            messageId=payload.get("messageId", ""),
                            contextId=payload.get("contextId", context_id),
                            taskId=task_id,
                            role=A2AMessageRole(payload.get("role", "agent")),
                            parts=[A2APartSchema(part_type="text", text=payload.get("content", ""))],
                        )
                    )
                    await queue.put(("Message", msg_event.model_dump(mode='json')))
                else:
                    await queue.put(("raw", payload))

            if task.state in {A2ATaskState.COMPLETED, A2ATaskState.FAILED, A2ATaskState.CANCELED, A2ATaskState.REJECTED}:
                await queue.put(("terminal", None))
                return

            async for payload in a2a_runtime.subscribe(task.id):
                if payload.get("type") == "TaskStatusUpdateEvent":
                    evt = TaskStatusUpdateEvent(
                        taskId=task_id,
                        contextId=context_id,
                        status=A2ATaskStatusSchema(
                            state=SchemaTaskState(payload.get("task_status", "WORKING")),
                            timestamp=datetime.utcnow(),
                        ),
                        metadata=payload.get("metadata", {}),
                    )
                    await queue.put(("TaskStatusUpdateEvent", evt.model_dump(mode='json')))
                elif payload.get("type") == "TaskArtifactUpdateEvent":
                    content = payload.get("artifact", {}).get("content", "")
                    evt = TaskArtifactUpdateEvent(
                        taskId=task_id,
                        contextId=context_id,
                        artifact=A2AArtifactSchema(
                            artifactId=f"artifact-stream-{datetime.utcnow().timestamp()}",
                            parts=[A2APartSchema(part_type="text", text=content)],
                        ),
                        append=False,
                        lastChunk=True,
                    )
                    await queue.put(("TaskArtifactUpdateEvent", evt.model_dump(mode='json')))
                elif payload.get("type") == "Message":
                    msg_event = TaskMessageEvent(
                        message=A2AMessageSchema(
                            messageId=payload.get("messageId", ""),
                            contextId=payload.get("contextId", context_id),
                            taskId=task_id,
                            role=A2AMessageRole(payload.get("role", "agent")),
                            parts=[A2APartSchema(part_type="text", text=payload.get("content", ""))],
                        )
                    )
                    await queue.put(("Message", msg_event.model_dump(mode='json')))
                else:
                    await queue.put(("raw", payload))

                if payload.get("task_status") in {"COMPLETED", "FAILED", "CANCELED", "REJECTED"}:
                    await queue.put(("terminal", None))
                    break
        except Exception:
            await queue.put(("error", None))
        finally:
            await queue.put(("close", None))

    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue(maxsize=200)
        collector = asyncio.create_task(_collect_subscribe_events_to_queue(task_id, queue, task.context_id))

        while True:
            event_type, event_data = await queue.get()
            if event_type == "close":
                break
            if event_type == "error":
                break
            if event_type == "terminal":
                yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
                break
            yield f"data: {json.dumps(event_data, ensure_ascii=False, default=_json_serialize)}\n\n"
            if event_type == "Message":
                break

        yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
        collector.cancel()

    return A2AStreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.post("/tasks/{task_id}/pushNotificationConfigs", response_model=PushNotificationConfig, status_code=status.HTTP_201_CREATED)
def create_push_notification_config(
    task_id: str,
    payload: PushNotificationConfigCreate,
    response: Response,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
    _version_check: None = Depends(verify_a2a_version),
) -> PushNotificationConfig:
    task = _ensure_task_access(db, task_id, current_user)
    item = A2ATaskWebhook(
        task_id=task.id,
        target_url=payload.targetUrl,
        secret=payload.secret,
        auth_header=payload.authHeader,
        enabled=payload.enabled,
        created_by=current_user.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return PushNotificationConfig(
        id=item.id,
        taskId=item.task_id,
        targetUrl=item.target_url,
        secret=item.secret,
        authHeader=item.auth_header,
        enabled=item.enabled,
        createdBy=item.created_by,
        createdAt=item.created_at,
    )


@router.get("/tasks/{task_id}/pushNotificationConfigs", response_model=List[PushNotificationConfig])
def list_push_notification_configs(
    task_id: str,
    response: Response,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
    _version_check: None = Depends(verify_a2a_version),
) -> List[PushNotificationConfig]:
    task = _ensure_task_access(db, task_id, current_user)
    items = db.query(A2ATaskWebhook).filter(A2ATaskWebhook.task_id == task.id).order_by(A2ATaskWebhook.id.desc()).all()
    return [
        PushNotificationConfig(
            id=item.id,
            taskId=item.task_id,
            targetUrl=item.target_url,
            secret=item.secret,
            authHeader=item.auth_header,
            enabled=item.enabled,
            createdBy=item.created_by,
            createdAt=item.created_at,
        )
        for item in items
    ]


@router.delete("/tasks/{task_id}/pushNotificationConfigs/{config_id}")
def delete_push_notification_config(
    task_id: str,
    config_id: int,
    response: Response,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
    _version_check: None = Depends(verify_a2a_version),
) -> Dict[str, str]:
    task = _ensure_task_access(db, task_id, current_user)
    item = db.query(A2ATaskWebhook).filter(
        A2ATaskWebhook.id == config_id,
        A2ATaskWebhook.task_id == task.id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Push notification config not found")
    db.delete(item)
    db.commit()
    return {"status": "success"}


@router.get(f"{A2A_API_PREFIX}/extendedAgentCard", response_model=AgentCardExtendedSchema)
def get_extended_agent_card(
    current_user: CurrentUser = Depends(get_current_user),
) -> AgentCardExtendedSchema:
    return _build_extended_agent_card(current_user)


@router.get(f"{A2A_API_PREFIX}/tasks/{{task_id}}/webhooks", response_model=List[TaskWebhookView])
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


@router.post(f"{A2A_API_PREFIX}/tasks/{{task_id}}/webhooks", response_model=TaskWebhookView, status_code=status.HTTP_201_CREATED)
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


@router.delete(f"{A2A_API_PREFIX}/tasks/{{task_id}}/webhooks/{{webhook_id}}")
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


@router.post(f"{A2A_API_PREFIX}/webhook-deliveries/{{delivery_id}}/replay")
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


@router.get(f"{A2A_API_PREFIX}/metrics")
async def get_metrics(current_user: CurrentUser = Depends(get_current_user)) -> Dict[str, Any]:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin permission required")
    return await a2a_runtime.metrics.snapshot()


@router.get(f"{A2A_API_PREFIX}/projects/{{project_id}}/rollout", response_model=RolloutConfigView)
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


@router.put(f"{A2A_API_PREFIX}/projects/{{project_id}}/rollout", response_model=RolloutConfigView)
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


@router.get(f"{A2A_API_PREFIX}/alerts")
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
        "panel": {"metrics_endpoint": "/api/v1/a2a/metrics", "task_list_endpoint": "/tasks"},
    }


@router.get(f"{A2A_API_PREFIX}/audit-logs")
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