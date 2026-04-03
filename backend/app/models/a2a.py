from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, JSON, Enum as SQLEnum, func
from sqlalchemy.orm import relationship
import enum

from app.database import Base


class A2ATaskState(str, enum.Enum):
    SUBMITTED = "SUBMITTED"
    WORKING = "WORKING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELED = "CANCELED"
    INPUT_REQUIRED = "INPUT_REQUIRED"
    AUTH_REQUIRED = "AUTH_REQUIRED"
    REJECTED = "REJECTED"


class A2APartType(str, enum.Enum):
    TEXT = "text"
    RAW = "raw"
    URL = "url"
    DATA = "data"


class A2AMessageRole(str, enum.Enum):
    USER = "user"
    AGENT = "agent"
    SYSTEM = "system"


class A2ARemoteAgent(Base):
    __tablename__ = "a2a_remote_agents"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    base_url = Column(String, nullable=False)
    auth_scheme = Column(String, nullable=False, default="none")
    auth_token = Column(String, nullable=True)
    shared_secret = Column(String, nullable=True)
    mtls_ca_cert = Column(Text, nullable=True)
    mtls_client_cert = Column(Text, nullable=True)
    mtls_client_key = Column(Text, nullable=True)
    oauth2_client_id = Column(String, nullable=True)
    oauth2_client_secret = Column(String, nullable=True)
    oauth2_token_url = Column(String, nullable=True)
    oauth2_scopes = Column(String, nullable=True)
    oidc_issuer_url = Column(String, nullable=True)
    oidc_client_id = Column(String, nullable=True)
    oidc_client_secret = Column(String, nullable=True)
    protocol_version = Column(String, nullable=True)
    capabilities_json = Column(Text, nullable=False, default="[]")
    card_json = Column(Text, nullable=True)
    card_fetched_at = Column(DateTime, nullable=True)
    healthy = Column(Boolean, nullable=False, default=False)
    failure_count = Column(Integer, nullable=False, default=0)
    circuit_open_until = Column(DateTime, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    project = relationship("Project")


class A2APart(Base):
    __tablename__ = "a2a_parts"

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("a2a_messages.id", ondelete="CASCADE"), nullable=True, index=True)
    artifact_id = Column(Integer, ForeignKey("a2a_artifacts.id", ondelete="CASCADE"), nullable=True, index=True)
    part_type = Column(SQLEnum(A2APartType), nullable=False)
    text_content = Column(Text, nullable=True)
    raw_content = Column(Text, nullable=True)
    url_content = Column(String, nullable=True)
    data_content = Column(Text, nullable=True)
    media_type = Column(String, nullable=True)
    filename = Column(String, nullable=True)
    metadata_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=func.now())

    message = relationship("A2AMessage", back_populates="parts", foreign_keys=[message_id])
    artifact = relationship("A2AArtifact", back_populates="parts", foreign_keys=[artifact_id])


class A2AMessage(Base):
    __tablename__ = "a2a_messages"

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(String, nullable=False, unique=True, index=True)
    context_id = Column(String, nullable=True, index=True)
    task_id = Column(String, ForeignKey("a2a_tasks.id", ondelete="CASCADE"), nullable=True, index=True)
    role = Column(SQLEnum(A2AMessageRole), nullable=False)
    extensions_json = Column(Text, nullable=False, default="{}")
    reference_task_ids_json = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime, default=func.now(), index=True)

    task = relationship("A2ATask", back_populates="messages", foreign_keys=[task_id])
    parts = relationship("A2APart", back_populates="message", cascade="all, delete-orphan")


class A2AArtifact(Base):
    __tablename__ = "a2a_artifacts"

    id = Column(Integer, primary_key=True, index=True)
    artifact_id = Column(String, nullable=False, unique=True, index=True)
    task_id = Column(String, ForeignKey("a2a_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=False, default="{}")
    extensions_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    task = relationship("A2ATask", back_populates="artifacts")
    parts = relationship("A2APart", back_populates="artifact", cascade="all, delete-orphan")


class A2ATask(Base):
    __tablename__ = "a2a_tasks"

    id = Column(String, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    context_id = Column(String, nullable=True, index=True)
    source = Column(String, nullable=False, default="local")
    remote_agent_id = Column(Integer, ForeignKey("a2a_remote_agents.id"), nullable=True, index=True)
    idempotency_key = Column(String, nullable=True, index=True)
    state = Column(SQLEnum(A2ATaskState), nullable=False, index=True, default=A2ATaskState.SUBMITTED)
    input_text = Column(Text, nullable=False, default="")
    output_text = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    compatibility_mode = Column(Boolean, nullable=False, default=True)
    metadata_json = Column(Text, nullable=False, default="{}")
    history_length = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    finished_at = Column(DateTime, nullable=True)

    project = relationship("Project")
    remote_agent = relationship("A2ARemoteAgent")
    messages = relationship("A2AMessage", back_populates="task", cascade="all, delete-orphan", foreign_keys=[A2AMessage.task_id])
    artifacts = relationship("A2AArtifact", back_populates="task", cascade="all, delete-orphan")


class A2ATaskEvent(Base):
    __tablename__ = "a2a_task_events"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String, ForeignKey("a2a_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(String, nullable=False)
    payload_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=func.now(), index=True)

    task = relationship("A2ATask")


class A2ATaskWebhook(Base):
    __tablename__ = "a2a_task_webhooks"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String, ForeignKey("a2a_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    target_url = Column(String, nullable=False)
    secret = Column(String, nullable=True)
    auth_header = Column(String, nullable=True)
    enabled = Column(Boolean, nullable=False, default=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    task = relationship("A2ATask")


class A2AWebhookDelivery(Base):
    __tablename__ = "a2a_webhook_deliveries"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String, ForeignKey("a2a_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    webhook_id = Column(Integer, ForeignKey("a2a_task_webhooks.id", ondelete="CASCADE"), nullable=False, index=True)
    event_id = Column(Integer, ForeignKey("a2a_task_events.id", ondelete="CASCADE"), nullable=False, index=True)
    attempt = Column(Integer, nullable=False, default=0)
    status = Column(String, nullable=False, default="PENDING")
    response_code = Column(Integer, nullable=True)
    response_body = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    next_retry_at = Column(DateTime, nullable=True)
    delivered_at = Column(DateTime, nullable=True)
    dead_letter = Column(Boolean, nullable=False, default=False, index=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    task = relationship("A2ATask")
    webhook = relationship("A2ATaskWebhook")
    event = relationship("A2ATaskEvent")


class A2AProjectConfig(Base):
    __tablename__ = "a2a_project_configs"

    project_id = Column(Integer, ForeignKey("projects.id"), primary_key=True)
    canary_enabled = Column(Boolean, nullable=False, default=False)
    canary_percent = Column(Integer, nullable=False, default=0)
    rollback_to_local = Column(Boolean, nullable=False, default=True)
    compatibility_mode = Column(Boolean, nullable=False, default=True)
    dual_event_write = Column(Boolean, nullable=False, default=True)
    route_mode_default = Column(String, nullable=False, default="local_first")
    fallback_chain_json = Column(Text, nullable=False, default='["local"]')
    alert_thresholds_json = Column(Text, nullable=False, default="{}")
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    project = relationship("Project")


class A2AAuditLog(Base):
    __tablename__ = "a2a_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    actor_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    action = Column(String, nullable=False)
    target_type = Column(String, nullable=False)
    target_id = Column(String, nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True, index=True)
    task_id = Column(String, nullable=True, index=True)
    result = Column(String, nullable=False)
    detail_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=func.now(), index=True)
