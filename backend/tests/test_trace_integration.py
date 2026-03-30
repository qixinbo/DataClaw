import asyncio
import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
NANOBOT_ROOT = REPO_ROOT / "nanobot"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
if str(NANOBOT_ROOT) not in sys.path:
    sys.path.insert(0, str(NANOBOT_ROOT))

import main
from app.trace.attributes import build_chat_trace_attributes, sanitize_attributes
from app.trace.service import TraceService


def test_trace_service_initialize_without_keys(monkeypatch) -> None:
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    service = TraceService()
    assert service.initialize() is False
    assert service.enabled is False
    assert service.initialized is True


def test_trace_attribute_helpers() -> None:
    attrs = sanitize_attributes(
        {
            "session_id": "api:test",
            "project_id": 1,
            "skip_none": None,
            "obj": {"a": 1},
        }
    )
    assert attrs["session_id"] == "api:test"
    assert attrs["project_id"] == 1
    assert "skip_none" not in attrs
    assert attrs["obj"] == "{'a': 1}"
    chat_attrs = build_chat_trace_attributes(
        session_id="api:test",
        project_id=9,
        model_id="model-a",
        route_mode="auto",
        source="postgres",
        knowledge_base_id=None,
    )
    assert chat_attrs["component"] == "chat_stream"
    assert chat_attrs["session_id"] == "api:test"
    assert chat_attrs["project_id"] == 9


def test_nanobot_chat_stream_uses_trace_span(monkeypatch) -> None:
    calls: list[tuple[str, dict]] = []
    updates: list[dict] = []
    trace_updates: list[dict] = []

    class _Span:
        def set_attributes(self, attributes):
            updates.append(attributes)

        def update(self, **kwargs):
            updates.append(kwargs)

        def update_trace(self, **kwargs):
            trace_updates.append(kwargs)

        def record_error(self, _exc, *, stage: str = "unknown"):
            updates.append({"stage": stage})

    class _SpanCtx:
        def __init__(self, name: str, attributes: dict):
            self._name = name
            self._attributes = attributes

        def __enter__(self):
            calls.append((self._name, self._attributes))
            return _Span()

        def __exit__(self, exc_type, exc, tb):
            return False

    def fake_start_span(name: str, *, attributes=None, input_payload=None):
        payload = dict(attributes or {})
        if input_payload is not None:
            payload["input_payload"] = input_payload
        return _SpanCtx(name, payload)

    async def fake_process_message(*args, **kwargs):
        on_stream = kwargs.get("on_stream")
        if on_stream:
            await on_stream("token")
        return "ok"

    async def collect_stream_chunks(response) -> list[str]:
        chunks: list[str] = []
        async for chunk in response.body_iterator:
            chunks.append(chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk)
        return chunks

    monkeypatch.setattr(main.trace_service, "start_span", fake_start_span)
    monkeypatch.setattr(main.nanobot_service, "process_message", fake_process_message)
    monkeypatch.setattr(main.nanobot_service, "agent", None)

    request = main.ChatRequest(message="hello", session_id="api:trace-test", project_id=7)
    response = asyncio.run(main.nanobot_chat_stream(request))
    chunks = asyncio.run(collect_stream_chunks(response))
    content = "".join(chunks)

    assert "token" in content
    assert "ok" in content
    assert calls
    assert calls[0][0] == "chat.stream"
    assert trace_updates and trace_updates[0]["session_id"] == "api:trace-test"
