import asyncio
from types import SimpleNamespace

from app.core.nanobot import NanobotIntegration
from app.context import current_session_id


class _DummySessions:
    def __init__(self) -> None:
        self.saved = []
        self._session = SimpleNamespace(messages=[])

    def get_or_create(self, _session_id: str):
        return self._session

    def save(self, session) -> None:
        self.saved.append(session)


class _DummyAgent:
    def __init__(self) -> None:
        self.sessions = _DummySessions()
        self.provider = SimpleNamespace(default_model="demo-model")
        self.model = "demo-model"

    async def process_direct(self, *_args, **_kwargs):
        return "ok"


def test_process_message_project_id_fallback_from_session_alias(monkeypatch) -> None:
    service = NanobotIntegration()
    base_agent = _DummyAgent()
    custom_agent = _DummyAgent()
    service.agent = base_agent
    service._started = True

    captured: dict[str, object] = {}

    async def fake_get_or_create_model_agent(model_id, target_config, project_id):
        captured["project_id"] = project_id
        return custom_agent

    monkeypatch.setattr(service, "_get_or_create_model_agent", fake_get_or_create_model_agent)
    monkeypatch.setattr("app.core.nanobot.get_llm_configs", lambda: [])
    monkeypatch.setattr("app.core.nanobot.get_active_llm_config", lambda: None)
    monkeypatch.setattr(
        "app.core.session_alias_store.session_alias_store.get_alias_meta",
        lambda _session_id: {"project_id": 77},
    )

    response = asyncio.run(service.process_message("hello", session_id="api:s1"))

    assert response == "ok"
    assert captured["project_id"] == 77


def test_process_message_project_id_prefers_request_value(monkeypatch) -> None:
    service = NanobotIntegration()
    base_agent = _DummyAgent()
    custom_agent = _DummyAgent()
    service.agent = base_agent
    service._started = True

    captured: dict[str, object] = {}

    async def fake_get_or_create_model_agent(model_id, target_config, project_id):
        captured["project_id"] = project_id
        return custom_agent

    monkeypatch.setattr(service, "_get_or_create_model_agent", fake_get_or_create_model_agent)
    monkeypatch.setattr("app.core.nanobot.get_llm_configs", lambda: [])
    monkeypatch.setattr("app.core.nanobot.get_active_llm_config", lambda: None)
    monkeypatch.setattr(
        "app.core.session_alias_store.session_alias_store.get_alias_meta",
        lambda _session_id: {"project_id": 88},
    )

    response = asyncio.run(service.process_message("hello", session_id="api:s2", project_id=9))

    assert response == "ok"
    assert captured["project_id"] == 9


def test_register_custom_tools_always_contains_subagent_tools() -> None:
    service = NanobotIntegration()
    names: list[str] = []

    class _ToolRegistry:
        def register(self, tool) -> None:
            names.append(tool.name)

    fake_agent = SimpleNamespace(tools=_ToolRegistry())
    service._register_custom_tools(fake_agent, project_id=None)

    assert "list_subagents" in names
    assert "invoke_subagent" in names


def test_subagent_tool_resolves_project_from_session_alias(monkeypatch) -> None:
    from app.tools.subagent import _resolve_project_id

    token = current_session_id.set("api:subagent-test")
    try:
        monkeypatch.setattr(
            "app.tools.subagent.session_alias_store.get_alias_meta",
            lambda _session_id: {"project_id": 66},
        )
        assert _resolve_project_id(None) == 66
    finally:
        current_session_id.reset(token)
