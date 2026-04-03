from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List, Dict, Any, Literal, Union
from datetime import datetime
from enum import Enum


class A2ATaskState(str, Enum):
    SUBMITTED = "SUBMITTED"
    WORKING = "WORKING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELED = "CANCELED"
    INPUT_REQUIRED = "INPUT_REQUIRED"
    AUTH_REQUIRED = "AUTH_REQUIRED"
    REJECTED = "REJECTED"


class A2APartType(str, Enum):
    TEXT = "text"
    RAW = "raw"
    URL = "url"
    DATA = "data"


class A2AMessageRole(str, Enum):
    USER = "user"
    AGENT = "agent"
    SYSTEM = "system"


class A2APartSchema(BaseModel):
    part_type: A2APartType
    text: Optional[str] = None
    raw: Optional[bytes] = None
    url: Optional[str] = None
    data: Optional[Any] = None
    mediaType: Optional[str] = None
    filename: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)


class A2APartCreateSchema(BaseModel):
    part_type: A2APartType
    text: Optional[str] = None
    raw: Optional[str] = None
    url: Optional[str] = None
    data: Optional[Any] = None
    mediaType: Optional[str] = None
    filename: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)


class A2AMessageSchema(BaseModel):
    messageId: str
    contextId: Optional[str] = None
    taskId: Optional[str] = None
    role: A2AMessageRole
    parts: List[A2APartSchema] = Field(default_factory=list)
    extensions: Optional[Dict[str, Any]] = Field(default_factory=dict)
    referenceTaskIds: Optional[List[str]] = Field(default_factory=list)
    createdAt: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class A2AMessageCreateSchema(BaseModel):
    messageId: str
    contextId: Optional[str] = None
    taskId: Optional[str] = None
    role: A2AMessageRole
    parts: List[A2APartCreateSchema] = Field(default_factory=list)
    extensions: Optional[Dict[str, Any]] = Field(default_factory=dict)
    referenceTaskIds: Optional[List[str]] = Field(default_factory=list)


class A2AArtifactSchema(BaseModel):
    artifactId: str
    name: Optional[str] = None
    description: Optional[str] = None
    parts: List[A2APartSchema] = Field(default_factory=list)
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)
    extensions: Optional[Dict[str, Any]] = Field(default_factory=dict)
    createdAt: Optional[datetime] = None
    updatedAt: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class A2AArtifactCreateSchema(BaseModel):
    artifactId: str
    name: Optional[str] = None
    description: Optional[str] = None
    parts: List[A2APartCreateSchema] = Field(default_factory=list)
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)
    extensions: Optional[Dict[str, Any]] = Field(default_factory=dict)


class A2ATaskStatusSchema(BaseModel):
    state: A2ATaskState
    timestamp: datetime


class A2ATaskSchema(BaseModel):
    id: str
    contextId: Optional[str] = None
    projectId: int
    tenantId: int
    source: str
    remoteAgentId: Optional[int] = None
    idempotencyKey: Optional[str] = None
    state: A2ATaskState
    inputText: str
    outputText: Optional[str] = None
    errorMessage: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)
    historyLength: int = 0
    createdAt: datetime
    updatedAt: datetime
    finishedAt: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class A2ATaskWithMessagesSchema(A2ATaskSchema):
    messages: List[A2AMessageSchema] = Field(default_factory=list)
    artifacts: List[A2AArtifactSchema] = Field(default_factory=list)


class A2ATaskWithHistorySchema(BaseModel):
    id: str
    contextId: Optional[str] = None
    projectId: int
    tenantId: int
    state: A2ATaskState
    history: List[A2AMessageSchema] = Field(default_factory=list)
    artifacts: List[A2AArtifactSchema] = Field(default_factory=list)
    createdAt: datetime
    updatedAt: datetime
    finishedAt: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class TaskStatusUpdateEvent(BaseModel):
    taskId: str
    contextId: Optional[str] = None
    status: A2ATaskStatusSchema
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)


class TaskArtifactUpdateEvent(BaseModel):
    taskId: str
    contextId: Optional[str] = None
    artifact: A2AArtifactSchema
    append: bool = False
    lastChunk: bool = True


class TaskMessageEvent(BaseModel):
    message: A2AMessageSchema


class StreamResponseTask(BaseModel):
    id: str
    contextId: Optional[str] = None
    state: A2ATaskState
    artifacts: List[A2AArtifactSchema] = Field(default_factory=list)


class StreamResponse(BaseModel):
    task: Optional[StreamResponseTask] = None
    message: Optional[A2AMessageSchema] = None
    statusUpdate: Optional[TaskStatusUpdateEvent] = None
    artifactUpdate: Optional[TaskArtifactUpdateEvent] = None


class SendMessageRequest(BaseModel):
    message: A2AMessageCreateSchema
    taskId: Optional[str] = None
    contextId: Optional[str] = None


class SendStreamingMessageRequest(BaseModel):
    message: A2AMessageCreateSchema
    taskId: Optional[str] = None
    contextId: Optional[str] = None


class GetTaskRequest(BaseModel):
    historyLength: Optional[int] = None


class TaskListRequest(BaseModel):
    contextId: Optional[str] = None
    status: Optional[A2ATaskState] = None
    pageSize: int = 20
    pageToken: Optional[str] = None


class CancelTaskRequest(BaseModel):
    pass


class PushNotificationConfigCreate(BaseModel):
    targetUrl: str
    secret: Optional[str] = None
    authHeader: Optional[str] = None
    enabled: bool = True


class PushNotificationConfig(BaseModel):
    id: int
    taskId: str
    targetUrl: str
    secret: Optional[str] = None
    authHeader: Optional[str] = None
    enabled: bool
    createdBy: int
    createdAt: datetime

    model_config = ConfigDict(from_attributes=True)


class VersionNotSupportedError(BaseModel):
    code: int = -32009
    message: str = "Version not supported"
    data: Optional[Dict[str, Any]] = None


class AgentSkillInputMode(str, Enum):
    TEXT = "text"
    DATA = "data"
    RAW = "raw"
    URL = "url"


class AgentSkillOutputMode(str, Enum):
    TEXT = "text"
    DATA = "data"
    ARTIFACT = "artifact"
    STREAM = "stream"


class AgentSkillSecurityRequirement(BaseModel):
    scheme: str
    scopes: Optional[List[str]] = None


class AgentSkillExample(BaseModel):
    input: Dict[str, Any]
    output: Dict[str, Any]


class AgentSkill(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    examples: List[AgentSkillExample] = Field(default_factory=list)
    inputModes: List[AgentSkillInputMode] = Field(default_factory=list)
    outputModes: List[AgentSkillOutputMode] = Field(default_factory=list)
    securityRequirements: List[AgentSkillSecurityRequirement] = Field(default_factory=list)


class AgentProvider(BaseModel):
    organization: str
    url: Optional[str] = None


class AgentSupportedInterface(BaseModel):
    url: str
    protocolBinding: str
    protocolVersion: str
    tenant: Optional[str] = None


class SecuritySchemeApiKey(BaseModel):
    type: Literal["apiKey"] = "apiKey"
    name: str
    in_: str = Field(alias="in")
    description: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True)


class SecuritySchemeHttpAuth(BaseModel):
    type: Literal["http"] = "http"
    scheme: str
    description: Optional[str] = None


class OAuth2AuthorizationCodeFlow(BaseModel):
    authorizationUrl: str
    tokenUrl: str
    scopes: Dict[str, str] = Field(default_factory=dict)
    refreshUrl: Optional[str] = None


class OAuth2ClientCredentialsFlow(BaseModel):
    tokenUrl: str
    scopes: Dict[str, str] = Field(default_factory=dict)
    refreshUrl: Optional[str] = None


class OAuth2DeviceCodeFlow(BaseModel):
    authorizationUrl: str
    tokenUrl: str
    scopes: Dict[str, str] = Field(default_factory=dict)
    deviceAuthorizationUrl: Optional[str] = None


class OAuth2Flows(BaseModel):
    authorizationCode: Optional[OAuth2AuthorizationCodeFlow] = None
    clientCredentials: Optional[OAuth2ClientCredentialsFlow] = None
    deviceCode: Optional[OAuth2DeviceCodeFlow] = None
    implicit: Optional[Dict[str, Any]] = None
    password: Optional[Dict[str, Any]] = None


class SecuritySchemeOAuth2(BaseModel):
    type: Literal["oauth2"] = "oauth2"
    flows: OAuth2Flows
    description: Optional[str] = None


class SecuritySchemeOpenIdConnect(BaseModel):
    type: Literal["openIdConnect"] = "openIdConnect"
    openIdConnectUrl: str
    description: Optional[str] = None
    scopes: Dict[str, str] = Field(default_factory=dict)


class SecuritySchemeMtls(BaseModel):
    type: Literal["mutualTLS"] = "mutualTLS"
    description: Optional[str] = None
    caCerts: Optional[List[str]] = None
    clientCert: Optional[str] = None
    clientKey: Optional[str] = None


class AgentCardPublicSchema(BaseModel):
    name: str
    protocol_version: str = "1.0"
    capabilities: List[str]
    endpoints: Dict[str, str]
    auth: List[str]
    skills: List[AgentSkill] = Field(default_factory=list)
    provider: Optional[AgentProvider] = None
    supportedInterfaces: List[AgentSupportedInterface] = Field(default_factory=list)
    defaultInputModes: List[str] = Field(default_factory=list)
    defaultOutputModes: List[str] = Field(default_factory=list)
    iconUrl: Optional[str] = None
    documentationUrl: Optional[str] = None


class AgentCardExtendedSchema(AgentCardPublicSchema):
    securitySchemes: Optional[Dict[str, Union[SecuritySchemeApiKey, SecuritySchemeHttpAuth, SecuritySchemeOAuth2, SecuritySchemeOpenIdConnect, SecuritySchemeMtls]]] = None
    security: List[Dict[str, List[str]]] = Field(default_factory=list)
    signatures: List[str] = Field(default_factory=list)
    tenantId: Optional[int] = None
    isAdmin: Optional[bool] = None
