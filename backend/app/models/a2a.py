from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import relationship

from app.database import Base


class A2ARemoteAgent(Base):
    __tablename__ = "a2a_remote_agents"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    base_url = Column(String, nullable=False)
    auth_scheme = Column(String, nullable=False, default="none")
    auth_token = Column(String, nullable=True)
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


class A2ATask(Base):
    __tablename__ = "a2a_tasks"

    id = Column(String, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    source = Column(String, nullable=False, default="local")
    remote_agent_id = Column(Integer, ForeignKey("a2a_remote_agents.id"), nullable=True, index=True)
    idempotency_key = Column(String, nullable=True, index=True)
    state = Column(String, nullable=False, index=True, default="SUBMITTED")
    input_text = Column(Text, nullable=False, default="")
    output_text = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    compatibility_mode = Column(Boolean, nullable=False, default=True)
    metadata_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    finished_at = Column(DateTime, nullable=True)

    project = relationship("Project")
    remote_agent = relationship("A2ARemoteAgent")


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
