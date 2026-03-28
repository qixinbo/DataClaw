import sys
from collections.abc import Generator
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
NANOBOT_ROOT = REPO_ROOT / "nanobot"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
if str(NANOBOT_ROOT) not in sys.path:
    sys.path.insert(0, str(NANOBOT_ROOT))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import CurrentUser, get_current_user
from app.database import Base, get_db
from app.models.project import Project
from app.models.subagent import Subagent
from app.models.user import User
from main import app


def _seed_subagent(db: Session) -> tuple[User, Project, Subagent]:
    user = User(
        username="task3-owner",
        email="task3-owner@example.com",
        hashed_password="test",
        is_admin=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    project = Project(
        name="task3-project",
        description="task3",
        owner_id=user.id,
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    subagent = Subagent(
        project_id=project.id,
        name="task3-subagent",
        description="task3",
        instructions="do task3",
        model="gpt",
    )
    db.add(subagent)
    db.commit()
    db.refresh(subagent)
    return user, project, subagent


def test_subagent_detail_route_is_global_and_project_scoped_route_is_invalid() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    db = testing_session_local()
    user, project, subagent = _seed_subagent(db)
    user_id = user.id
    username = user.username
    project_id = project.id
    subagent_id = subagent.id
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

    try:
        client = TestClient(app)
        response = client.get(f"/api/v1/subagents/{subagent_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == subagent_id
        assert body["project_id"] == project_id

        legacy_path_response = client.get(f"/api/v1/projects/{project_id}/subagents/{subagent_id}")
        assert legacy_path_response.status_code == 404
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()
