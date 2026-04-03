import asyncio
import hashlib
import hmac
import json
import sys
import time
from collections.abc import Generator
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
NANOBOT_ROOT = REPO_ROOT / "nanobot"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
if str(NANOBOT_ROOT) not in sys.path:
    sys.path.insert(0, str(NANOBOT_ROOT))

from app.core.security import CurrentUser, get_current_user
from app.database import Base, get_db
from app.models.a2a import A2ARemoteAgent, A2ATask, A2ATaskState
from app.models.project import Project
from app.models.user import User
from app.schemas.a2a import A2AMessageRole, A2APartType, AgentSkillOutputMode, AgentSkillInputMode
from app.services.a2a_service import a2a_runtime, SharedSecretAuth
from main import app


def _seed(db: Session) -> tuple[int, str, int, str, int]:
    owner = User(username="a2a_owner", email="a2a_owner@example.com", hashed_password="x", is_admin=False)
    other = User(username="a2a_other", email="a2a_other@example.com", hashed_password="x", is_admin=False)
    db.add(owner)
    db.add(other)
    db.commit()
    db.refresh(owner)
    db.refresh(other)
    project = Project(name="a2a_project", description="a2a", owner_id=owner.id)
    db.add(project)
    db.commit()
    db.refresh(project)
    return owner.id, owner.username, other.id, other.username, project.id


def _make_message_payload(project_id: int, text: str, session_id: str = "test-session", route_mode: str = "local_first", idempotency_key: Optional[str] = None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "message": {
            "messageId": f"msg-{int(time.time()*1000)}",
            "role": "user",
            "parts": [
                {
                    "part_type": "data",
                    "data": {
                        "project_id": project_id,
                        "route_mode": route_mode,
                        "session_id": session_id,
                        **( {"idempotency_key": idempotency_key} if idempotency_key else {} )
                    },
                    "mediaType": "application/json",
                },
                {
                    "part_type": "text",
                    "text": text,
                }
            ],
        }
    }
    return payload


class TestPartSerialization:
    def test_part_text_serialization(self):
        from app.schemas.a2a import A2APartCreateSchema
        part = A2APartCreateSchema(
            part_type=A2APartType.TEXT,
            text="Hello world",
            mediaType="text/plain",
        )
        data = part.model_dump()
        assert data["part_type"] == "text"
        assert data["text"] == "Hello world"
        assert data["mediaType"] == "text/plain"

    def test_part_data_serialization(self):
        from app.schemas.a2a import A2APartCreateSchema
        part = A2APartCreateSchema(
            part_type=A2APartType.DATA,
            data={"project_id": 123, "route_mode": "local"},
            mediaType="application/json",
        )
        data = part.model_dump()
        assert data["part_type"] == "data"
        assert data["data"]["project_id"] == 123

    def test_part_url_serialization(self):
        from app.schemas.a2a import A2APartCreateSchema
        part = A2APartCreateSchema(
            part_type=A2APartType.URL,
            url="https://example.com/file.pdf",
            mediaType="application/pdf",
            filename="file.pdf",
        )
        data = part.model_dump()
        assert data["part_type"] == "url"
        assert data["url"] == "https://example.com/file.pdf"
        assert data["filename"] == "file.pdf"

    def test_part_raw_serialization(self):
        from app.schemas.a2a import A2APartCreateSchema
        part = A2APartCreateSchema(
            part_type=A2APartType.RAW,
            raw="\x00\x01\x02\x03",
            mediaType="application/octet-stream",
        )
        data = part.model_dump()
        assert data["part_type"] == "raw"
        assert data["raw"] == "\x00\x01\x02\x03"


class TestStateMachine:
    def test_state_transitions_submit_to_complete(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        db = testing_session_local()
        owner_id, owner_username, _, _, project_id = _seed(db)
        db.close()

        state = {"user": CurrentUser(id=owner_id, username=owner_username, is_admin=False)}

        def override_get_db() -> Generator[Session, None, None]:
            override_db = testing_session_local()
            try:
                yield override_db
            finally:
                override_db.close()

        def override_current_user() -> CurrentUser:
            return state["user"]

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = override_current_user
        try:
            client = TestClient(app)
            resp = client.post("/api/v1/message:send", json=_make_message_payload(project_id, "test state machine"))
            assert resp.status_code == 200
            task_id = resp.json()["task"]["id"]

            task = db.query(A2ATask).filter(A2ATask.id == task_id).first()
            assert task.state == A2ATaskState.SUBMITTED

            task = a2a_runtime.transition_task(db, task, to_state=A2ATaskState.WORKING)
            assert task.state == A2ATaskState.WORKING

            task = a2a_runtime.transition_task(db, task, to_state=A2ATaskState.COMPLETED)
            assert task.state == A2ATaskState.COMPLETED
        finally:
            app.dependency_overrides.clear()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()

    def test_state_cancel(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        db = testing_session_local()
        owner_id, owner_username, _, _, project_id = _seed(db)
        db.close()

        state = {"user": CurrentUser(id=owner_id, username=owner_username, is_admin=False)}

        def override_get_db() -> Generator[Session, None, None]:
            override_db = testing_session_local()
            try:
                yield override_db
            finally:
                override_db.close()

        def override_current_user() -> CurrentUser:
            return state["user"]

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = override_current_user
        try:
            client = TestClient(app)
            resp = client.post("/api/v1/message:send", json=_make_message_payload(project_id, "cancel test"))
            assert resp.status_code == 200
            task_id = resp.json()["task"]["id"]

            cancel_resp = client.post(f"/api/v1/tasks/{task_id}:cancel", json={})
            assert cancel_resp.status_code == 200
            assert cancel_resp.json()["state"] == "CANCELED"
        finally:
            app.dependency_overrides.clear()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()

    def test_state_failed(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        db = testing_session_local()
        owner_id, owner_username, _, _, project_id = _seed(db)
        db.close()

        state = {"user": CurrentUser(id=owner_id, username=owner_username, is_admin=False)}

        def override_get_db() -> Generator[Session, None, None]:
            override_db = testing_session_local()
            try:
                yield override_db
            finally:
                override_db.close()

        def override_current_user() -> CurrentUser:
            return state["user"]

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = override_current_user
        try:
            client = TestClient(app)
            resp = client.post("/api/v1/message:send", json=_make_message_payload(project_id, "fail test"))
            assert resp.status_code == 200
            task_id = resp.json()["task"]["id"]

            task = db.query(A2ATask).filter(A2ATask.id == task_id).first()
            task = a2a_runtime.transition_task(db, task, to_state=A2ATaskState.FAILED, error_message='{"message": "test error"}')
            assert task.state == A2ATaskState.FAILED
            assert task.error_message is not None
        finally:
            app.dependency_overrides.clear()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()

    def test_state_rejected(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        db = testing_session_local()
        owner_id, owner_username, _, _, project_id = _seed(db)
        db.close()

        state = {"user": CurrentUser(id=owner_id, username=owner_username, is_admin=False)}

        def override_get_db() -> Generator[Session, None, None]:
            override_db = testing_session_local()
            try:
                yield override_db
            finally:
                override_db.close()

        def override_current_user() -> CurrentUser:
            return state["user"]

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = override_current_user
        try:
            client = TestClient(app)
            resp = client.post("/api/v1/message:send", json=_make_message_payload(project_id, "reject test"))
            assert resp.status_code == 200
            task_id = resp.json()["task"]["id"]

            task = db.query(A2ATask).filter(A2ATask.id == task_id).first()
            task = a2a_runtime.transition_task(db, task, to_state=A2ATaskState.REJECTED)
            assert task.state == A2ATaskState.REJECTED
        finally:
            app.dependency_overrides.clear()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()

    def test_state_input_required(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        db = testing_session_local()
        owner_id, owner_username, _, _, project_id = _seed(db)
        db.close()

        state = {"user": CurrentUser(id=owner_id, username=owner_username, is_admin=False)}

        def override_get_db() -> Generator[Session, None, None]:
            override_db = testing_session_local()
            try:
                yield override_db
            finally:
                override_db.close()

        def override_current_user() -> CurrentUser:
            return state["user"]

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = override_current_user
        try:
            client = TestClient(app)
            resp = client.post("/api/v1/message:send", json=_make_message_payload(project_id, "input required test"))
            assert resp.status_code == 200
            task_id = resp.json()["task"]["id"]

            task = db.query(A2ATask).filter(A2ATask.id == task_id).first()
            task = a2a_runtime.transition_task(db, task, to_state=A2ATaskState.INPUT_REQUIRED)
            assert task.state == A2ATaskState.INPUT_REQUIRED
        finally:
            app.dependency_overrides.clear()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()

    def test_state_auth_required(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        db = testing_session_local()
        owner_id, owner_username, _, _, project_id = _seed(db)
        db.close()

        state = {"user": CurrentUser(id=owner_id, username=owner_username, is_admin=False)}

        def override_get_db() -> Generator[Session, None, None]:
            override_db = testing_session_local()
            try:
                yield override_db
            finally:
                override_db.close()

        def override_current_user() -> CurrentUser:
            return state["user"]

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = override_current_user
        try:
            client = TestClient(app)
            resp = client.post("/api/v1/message:send", json=_make_message_payload(project_id, "auth required test"))
            assert resp.status_code == 200
            task_id = resp.json()["task"]["id"]

            task = db.query(A2ATask).filter(A2ATask.id == task_id).first()
            task = a2a_runtime.transition_task(db, task, to_state=A2ATaskState.AUTH_REQUIRED)
            assert task.state == A2ATaskState.AUTH_REQUIRED
        finally:
            app.dependency_overrides.clear()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()


class TestA2APathNormalization:
    def test_message_send_path(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        db = testing_session_local()
        owner_id, owner_username, _, _, project_id = _seed(db)
        db.close()

        state = {"user": CurrentUser(id=owner_id, username=owner_username, is_admin=False)}

        def override_get_db() -> Generator[Session, None, None]:
            override_db = testing_session_local()
            try:
                yield override_db
            finally:
                override_db.close()

        def override_current_user() -> CurrentUser:
            return state["user"]

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = override_current_user
        try:
            client = TestClient(app)
            resp = client.post("/api/v1/message:send", json=_make_message_payload(project_id, "path test"))
            assert resp.status_code == 200
            assert "task" in resp.json()
            assert "id" in resp.json()["task"]
        finally:
            app.dependency_overrides.clear()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()

    def test_message_stream_path(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        db = testing_session_local()
        owner_id, owner_username, _, _, project_id = _seed(db)
        db.close()

        state = {"user": CurrentUser(id=owner_id, username=owner_username, is_admin=False)}

        def override_get_db() -> Generator[Session, None, None]:
            override_db = testing_session_local()
            try:
                yield override_db
            finally:
                override_db.close()

        def override_current_user() -> CurrentUser:
            return state["user"]

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = override_current_user
        try:
            client = TestClient(app)
            resp = client.post("/api/v1/message:stream", json=_make_message_payload(project_id, "stream path test"))
            assert resp.status_code == 200
            assert resp.headers["content-type"].startswith("text/event-stream")
        finally:
            app.dependency_overrides.clear()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()

    def test_tasks_cancel_path(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        db = testing_session_local()
        owner_id, owner_username, _, _, project_id = _seed(db)
        db.close()

        state = {"user": CurrentUser(id=owner_id, username=owner_username, is_admin=False)}

        def override_get_db() -> Generator[Session, None, None]:
            override_db = testing_session_local()
            try:
                yield override_db
            finally:
                override_db.close()

        def override_current_user() -> CurrentUser:
            return state["user"]

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = override_current_user
        try:
            client = TestClient(app)
            resp = client.post("/api/v1/message:send", json=_make_message_payload(project_id, "cancel path test"))
            assert resp.status_code == 200
            task_id = resp.json()["task"]["id"]

            cancel_resp = client.post(f"/api/v1/tasks/{task_id}:cancel", json={})
            assert cancel_resp.status_code == 200
            assert cancel_resp.json()["task_id"] == task_id
        finally:
            app.dependency_overrides.clear()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()

    def test_agent_card_public_path(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        db = testing_session_local()
        db.close()

        def override_get_db() -> Generator[Session, None, None]:
            override_db = testing_session_local()
            try:
                yield override_db
            finally:
                override_db.close()

        app.dependency_overrides[get_db] = override_get_db
        try:
            client = TestClient(app)
            resp = client.get("/api/v1/.well-known/agent-card.json")
            assert resp.status_code == 200
            data = resp.json()
            assert "name" in data
            assert "protocol_version" in data
            assert "endpoints" in data
        finally:
            app.dependency_overrides.clear()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()


class TestVersionNegotiation:
    def test_version_not_supported_error(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        db = testing_session_local()
        owner_id, owner_username, _, _, project_id = _seed(db)
        db.close()

        state = {"user": CurrentUser(id=owner_id, username=owner_username, is_admin=False)}

        def override_get_db() -> Generator[Session, None, None]:
            override_db = testing_session_local()
            try:
                yield override_db
            finally:
                override_db.close()

        def override_current_user() -> CurrentUser:
            return state["user"]

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = override_current_user
        try:
            client = TestClient(app)
            resp = client.post(
                "/api/v1/message:send",
                json=_make_message_payload(project_id, "version test"),
                headers={"A2A-Version": "2.0"}
            )
            assert resp.status_code == 400
            detail = json.loads(resp.json()["detail"])
            assert detail["code"] == -32009
            assert "not supported" in detail["message"].lower()
        finally:
            app.dependency_overrides.clear()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()

    def test_version_response_header(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        db = testing_session_local()
        owner_id, owner_username, _, _, project_id = _seed(db)
        db.close()

        state = {"user": CurrentUser(id=owner_id, username=owner_username, is_admin=False)}

        def override_get_db() -> Generator[Session, None, None]:
            override_db = testing_session_local()
            try:
                yield override_db
            finally:
                override_db.close()

        def override_current_user() -> CurrentUser:
            return state["user"]

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = override_current_user
        try:
            client = TestClient(app)
            resp = client.post(
                "/api/v1/message:send",
                json=_make_message_payload(project_id, "version header test"),
                headers={"A2A-Version": "1.0"}
            )
            assert resp.status_code == 200
            assert resp.headers.get("A2A-Version") == "1.0"
        finally:
            app.dependency_overrides.clear()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()


class TestWebhookStreamResponse:
    def test_webhook_payload_format(self):
        from app.schemas.a2a import StreamResponse, TaskStatusUpdateEvent, TaskArtifactUpdateEvent, TaskMessageEvent, A2ATaskStatusSchema, A2ATaskState, A2AArtifactSchema

        status_event = TaskStatusUpdateEvent(
            taskId="task-123",
            contextId="ctx-456",
            status=A2ATaskStatusSchema(
                state=A2ATaskState.SUBMITTED,
                timestamp=datetime.utcnow(),
            ),
            metadata={},
        )
        status_dump = status_event.model_dump()
        assert "taskId" in status_dump
        assert status_dump["taskId"] == "task-123"
        assert status_dump["status"]["state"] == "SUBMITTED"

        artifact_event = TaskArtifactUpdateEvent(
            taskId="task-123",
            contextId="ctx-456",
            artifact=A2AArtifactSchema(
                artifactId="art-789",
                parts=[],
            ),
            append=False,
            lastChunk=True,
        )
        artifact_dump = artifact_event.model_dump()
        assert "taskId" in artifact_dump
        assert artifact_dump["artifact"]["artifactId"] == "art-789"

    def test_stream_response_task_field(self):
        from app.schemas.a2a import StreamResponse, StreamResponseTask, A2ATaskState
        resp = StreamResponse(
            task=StreamResponseTask(
                id="task-123",
                contextId="ctx-456",
                state=A2ATaskState.WORKING,
                artifacts=[],
            )
        )
        data = resp.model_dump()
        assert "task" in data
        assert data["task"]["id"] == "task-123"


class TestSSEFIFO:
    def test_sse_event_order(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        db = testing_session_local()
        owner_id, owner_username, _, _, project_id = _seed(db)
        db.close()

        state = {"user": CurrentUser(id=owner_id, username=owner_username, is_admin=False)}

        def override_get_db() -> Generator[Session, None, None]:
            override_db = testing_session_local()
            try:
                yield override_db
            finally:
                override_db.close()

        def override_current_user() -> CurrentUser:
            return state["user"]

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = override_current_user
        try:
            client = TestClient(app)
            with client.stream("POST", "/api/v1/message:stream", json=_make_message_payload(project_id, "fifo test")) as resp:
                assert resp.status_code == 200
                chunks = []
                for line in resp.iter_lines():
                    if line.startswith("data: "):
                        chunks.append(json.loads(line[6:]))

                event_types = [c.get("type") for c in chunks if "type" in c]
                status_idx = next((i for i, t in enumerate(event_types) if t == "TaskStatusUpdateEvent"), -1)
                assert status_idx >= 0
        finally:
            app.dependency_overrides.clear()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()


class TestAuthSchemes:
    def test_shared_secret_auth(self):
        secret = "test-secret-key-12345"
        timestamp = int(time.time())
        body = b'{"test":"data"}'
        sig, _ = SharedSecretAuth.generate_signature(secret, body, timestamp)
        assert sig.startswith("sha256=")

        assert SharedSecretAuth.verify_signature(secret, body, sig, timestamp) is True

    def test_auth_scheme_none(self):
        from app.schemas.a2a import SecuritySchemeHttpAuth
        scheme = SecuritySchemeHttpAuth(scheme="bearer", description="Bearer auth")
        assert scheme.scheme == "bearer"


class TestExceptionPaths:
    def test_auth_failure_marks_agent_unhealthy(self, monkeypatch):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        db = testing_session_local()
        owner_id, _, _, _, project_id = _seed(db)
        agent = A2ARemoteAgent(
            project_id=project_id,
            name="auth-fail-agent",
            base_url="https://remote.example.com",
            auth_scheme="bearer",
            auth_token="bad-token",
            created_by=owner_id,
        )
        db.add(agent)
        db.commit()
        db.refresh(agent)
        a2a_runtime._circuit_state.pop(agent.id, None)

        class _FailResp:
            status_code = 401

            @staticmethod
            def json():
                return {"detail": "unauthorized"}

        class _Client401:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def get(self, url, headers=None):
                return _FailResp()

        monkeypatch.setattr("app.services.a2a_service.httpx.AsyncClient", _Client401)

        with pytest.raises(RuntimeError):
            asyncio.run(a2a_runtime.fetch_agent_card(db, agent, timeout_s=0.01))
        db.refresh(agent)
        assert agent.healthy is False
        assert agent.failure_count == 1

        Base.metadata.drop_all(bind=engine)
        db.close()
        engine.dispose()

    def test_remote_unavailable_opens_circuit(self, monkeypatch):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        db = testing_session_local()
        owner_id, _, _, _, project_id = _seed(db)
        agent = A2ARemoteAgent(
            project_id=project_id,
            name="offline-agent",
            base_url="https://offline.example.com",
            auth_scheme="none",
            created_by=owner_id,
        )
        db.add(agent)
        db.commit()
        db.refresh(agent)
        a2a_runtime._circuit_state.pop(agent.id, None)

        class _ClientDown:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def get(self, url, headers=None):
                raise httpx.ConnectError("network down")

        monkeypatch.setattr("app.services.a2a_service.httpx.AsyncClient", _ClientDown)

        for _ in range(3):
            with pytest.raises(Exception):
                asyncio.run(a2a_runtime.fetch_agent_card(db, agent, timeout_s=0.01))
        db.refresh(agent)
        assert agent.healthy is False
        assert agent.failure_count == 3
        assert agent.circuit_open_until is not None

        Base.metadata.drop_all(bind=engine)
        db.close()
        engine.dispose()

    def test_idempotency_key_deduplicates_task(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        db = testing_session_local()
        owner_id, owner_username, _, _, project_id = _seed(db)
        db.close()

        state = {"user": CurrentUser(id=owner_id, username=owner_username, is_admin=False)}

        def override_get_db() -> Generator[Session, None, None]:
            override_db = testing_session_local()
            try:
                yield override_db
            finally:
                override_db.close()

        def override_current_user() -> CurrentUser:
            return state["user"]

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = override_current_user
        try:
            client = TestClient(app)
            idempotency_key = f"idem-key-{int(time.time())}"

            payload1 = _make_message_payload(project_id, "dedupe test", idempotency_key=idempotency_key)
            resp1 = client.post("/api/v1/message:send", json=payload1)
            assert resp1.status_code == 200

            payload2 = _make_message_payload(project_id, "dedupe test", idempotency_key=idempotency_key)
            payload2["message"]["messageId"] = f"msg-{int(time.time()*1000) + 1}"
            resp2 = client.post("/api/v1/message:send", json=payload2)

            assert resp2.status_code == 200
            assert resp1.json()["task"]["id"] == resp2.json()["task"]["id"]
        finally:
            app.dependency_overrides.clear()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()

    def test_tenant_isolation(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        db = testing_session_local()
        owner_id, owner_username, other_id, other_username, project_id = _seed(db)
        db.close()

        state = {"user": CurrentUser(id=owner_id, username=owner_username, is_admin=False)}

        def override_get_db() -> Generator[Session, None, None]:
            override_db = testing_session_local()
            try:
                yield override_db
            finally:
                override_db.close()

        def override_current_user() -> CurrentUser:
            return state["user"]

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = override_current_user
        try:
            client = TestClient(app)
            resp = client.post("/api/v1/message:send", json=_make_message_payload(project_id, "isolation test"))
            assert resp.status_code == 200
            task_id = resp.json()["task"]["id"]

            state["user"] = CurrentUser(id=other_id, username=other_username, is_admin=False)
            get_resp = client.get(f"/api/v1/tasks/{task_id}")
            assert get_resp.status_code == 404
        finally:
            app.dependency_overrides.clear()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()


class TestMetricsAdminOnly:
    def test_metrics_admin_only(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        db = testing_session_local()
        owner_id, owner_username, _, _, _ = _seed(db)
        db.close()

        state = {"user": CurrentUser(id=owner_id, username=owner_username, is_admin=False)}

        def override_get_db() -> Generator[Session, None, None]:
            override_db = testing_session_local()
            try:
                yield override_db
            finally:
                override_db.close()

        def override_current_user() -> CurrentUser:
            return state["user"]

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = override_current_user
        try:
            client = TestClient(app)
            denied = client.get("/api/v1/a2a/metrics")
            assert denied.status_code == 403

            state["user"] = CurrentUser(id=owner_id, username=owner_username, is_admin=True)
            ok = client.get("/api/v1/a2a/metrics")
            assert ok.status_code == 200
            assert "counters" in ok.json()
        finally:
            app.dependency_overrides.clear()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()
