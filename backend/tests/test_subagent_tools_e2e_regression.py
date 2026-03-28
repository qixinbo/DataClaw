import asyncio
import json
import sys
from collections.abc import Generator
from pathlib import Path

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

from app.context import current_session_id
from app.core.security import CurrentUser, get_current_user
from app.database import Base, get_db
from app.models.project import Project
from app.models.user import User
from app.tools.subagent import InvokeSubagentTool, ListSubagentsTool
from main import app


def _seed_owner_and_project(db: Session) -> tuple[User, Project]:
    user = User(
        username="task4-owner",
        email="task4-owner@example.com",
        hashed_password="test",
        is_admin=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    project = Project(
        name="task4-project",
        description="task4",
        owner_id=user.id,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return user, project


def test_create_subagent_then_list_and_invoke_success(monkeypatch) -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    db = testing_session_local()
    user, project = _seed_owner_and_project(db)
    user_id = user.id
    username = user.username
    project_id = project.id
    db.close()

    def override_get_db() -> Generator[Session, None, None]:
        override_db = testing_session_local()
        try:
            yield override_db
        finally:
            override_db.close()

    def override_current_user() -> CurrentUser:
        return CurrentUser(id=user_id, username=username, is_admin=False)

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_current_user

    token = current_session_id.set("api:task4-regression")
    captured: dict[str, object] = {}

    async def fake_process_message(message, session_id, project_id, model_id):
        captured["message"] = message
        captured["session_id"] = session_id
        captured["project_id"] = project_id
        captured["model_id"] = model_id
        return "invoke-ok"

    try:
        monkeypatch.setattr("app.tools.subagent.SessionLocal", testing_session_local)
        monkeypatch.setattr(
            "app.tools.subagent.session_alias_store.get_alias_meta",
            lambda _session_id: {"project_id": project_id},
        )
        monkeypatch.setattr("app.tools.subagent.get_llm_configs", lambda: [])
        monkeypatch.setattr("app.tools.subagent.get_active_llm_config", lambda: None)
        monkeypatch.setattr("app.tools.subagent.nanobot_service.process_message", fake_process_message)

        client = TestClient(app)
        create_response = client.post(
            f"/api/v1/projects/{project_id}/subagents",
            json={
                "name": "task4-subagent",
                "description": "task4-desc",
                "instructions": "focus on regression",
                "model": "gpt-x",
            },
        )
        assert create_response.status_code == 200
        created = create_response.json()
        assert created["project_id"] == project_id
        assert created["name"] == "task4-subagent"

        listed = asyncio.run(ListSubagentsTool().execute())
        listed_payload = json.loads(listed)
        assert len(listed_payload) == 1
        assert listed_payload[0]["name"] == "task4-subagent"
        assert listed_payload[0]["description"] == "task4-desc"

        invoke_result = asyncio.run(
            InvokeSubagentTool().execute(
                subagent_name="task4-subagent",
                task="run regression task",
            )
        )
        assert "completed the task" in invoke_result
        assert "invoke-ok" in invoke_result
        assert captured["project_id"] == project_id
        assert captured["session_id"] == f"api:task4-regression:subagent:{created['id']}"
        assert "focus on regression" in str(captured["message"])
    finally:
        current_session_id.reset(token)
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()
