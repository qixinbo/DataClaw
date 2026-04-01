import asyncio
import sys
from collections.abc import Generator
from pathlib import Path

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
from app.models.a2a import A2ARemoteAgent
from app.models.project import Project
from app.models.user import User
from app.services.a2a_service import a2a_runtime
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


def test_a2a_send_list_cancel_and_rollout() -> None:
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
        send_resp = client.post(
            "/api/v1/a2a/messages/send",
            json={
                "project_id": project_id,
                "message": "hello a2a",
                "session_id": "test-a2a-session",
                "route_mode": "local_first",
            },
        )
        assert send_resp.status_code == 200
        task_id = send_resp.json()["task"]["id"]

        get_resp = client.get(f"/api/v1/a2a/tasks/{task_id}")
        assert get_resp.status_code == 200
        assert get_resp.json()["project_id"] == project_id

        list_resp = client.get("/api/v1/a2a/tasks", params={"project_id": project_id})
        assert list_resp.status_code == 200
        assert any(item["id"] == task_id for item in list_resp.json())

        cancel_resp = client.post(f"/api/v1/a2a/tasks/{task_id}/cancel")
        assert cancel_resp.status_code == 200
        assert cancel_resp.json()["state"] in {"CANCELED", "COMPLETED", "FAILED"}

        rollout_resp = client.put(
            f"/api/v1/a2a/projects/{project_id}/rollout",
            json={"canary_enabled": True, "canary_percent": 30, "route_mode_default": "a2a_first", "fallback_chain": ["a2a", "local"]},
        )
        assert rollout_resp.status_code == 200
        assert rollout_resp.json()["canary_enabled"] is True
        assert rollout_resp.json()["canary_percent"] == 30
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_a2a_task_tenant_isolation() -> None:
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
        send_resp = client.post(
            "/api/v1/a2a/messages/send",
            json={"project_id": project_id, "message": "tenant isolation", "session_id": "tenant-isolation", "route_mode": "local"},
        )
        assert send_resp.status_code == 200
        task_id = send_resp.json()["task"]["id"]

        state["user"] = CurrentUser(id=other_id, username=other_username, is_admin=False)
        forbidden_resp = client.get(f"/api/v1/a2a/tasks/{task_id}")
        assert forbidden_resp.status_code == 404
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_a2a_metrics_admin_only() -> None:
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


def test_a2a_send_idempotency_key_deduplicates_task() -> None:
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
        payload = {
            "project_id": project_id,
            "message": "dedupe-task",
            "session_id": "idempotency-session",
            "route_mode": "local_first",
            "idempotency_key": "same-key-1",
        }
        first_resp = client.post("/api/v1/a2a/messages/send", json=payload)
        second_resp = client.post("/api/v1/a2a/messages/send", json=payload)
        assert first_resp.status_code == 200
        assert second_resp.status_code == 200
        assert first_resp.json()["task"]["id"] == second_resp.json()["task"]["id"]
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_a2a_fetch_agent_card_auth_failure_marks_agent_unhealthy(monkeypatch) -> None:
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


def test_a2a_fetch_agent_card_remote_unavailable_opens_circuit(monkeypatch) -> None:
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
