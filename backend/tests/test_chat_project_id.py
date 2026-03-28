import asyncio
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


def test_nanobot_chat_syncs_project_id(monkeypatch) -> None:
    calls: list[dict[str, object]] = []
    process_kwargs: list[dict[str, object]] = []

    def fake_update_alias_meta(**kwargs):
        calls.append(kwargs)
        return kwargs

    async def fake_process_message(*args, **kwargs):
        process_kwargs.append(kwargs)
        return "ok"

    monkeypatch.setattr(main.session_alias_store, "update_alias_meta", fake_update_alias_meta)
    monkeypatch.setattr(main.nanobot_service, "process_message", fake_process_message)
    monkeypatch.setattr(main.nanobot_service, "agent", None)

    request = main.ChatRequest(message="hello", session_id="api:test-1", project_id=101)
    response = asyncio.run(main.nanobot_chat(request))

    assert response["response"] == "ok"
    assert calls == [{"session_key": "api:test-1", "project_id": 101}]
    assert process_kwargs and process_kwargs[0]["project_id"] == 101


def test_nanobot_chat_without_project_id_does_not_sync(monkeypatch) -> None:
    calls: list[dict[str, object]] = []
    process_kwargs: list[dict[str, object]] = []

    def fake_update_alias_meta(**kwargs):
        calls.append(kwargs)
        return kwargs

    async def fake_process_message(*args, **kwargs):
        process_kwargs.append(kwargs)
        return "ok"

    monkeypatch.setattr(main.session_alias_store, "update_alias_meta", fake_update_alias_meta)
    monkeypatch.setattr(main.nanobot_service, "process_message", fake_process_message)
    monkeypatch.setattr(main.nanobot_service, "agent", None)

    request = main.ChatRequest(message="hello", session_id="api:test-2")
    response = asyncio.run(main.nanobot_chat(request))

    assert response["response"] == "ok"
    assert calls == []
    assert process_kwargs and process_kwargs[0]["project_id"] is None


def test_nanobot_chat_stream_syncs_project_id(monkeypatch) -> None:
    calls: list[dict[str, object]] = []
    process_kwargs: list[dict[str, object]] = []

    def fake_update_alias_meta(**kwargs):
        calls.append(kwargs)
        return kwargs

    async def fake_process_message(*args, **kwargs):
        process_kwargs.append(kwargs)
        on_stream = kwargs.get("on_stream")
        if on_stream:
            await on_stream("stream-token")
        return "stream-complete"

    async def collect_stream_chunks(response) -> list[str]:
        chunks: list[str] = []
        async for chunk in response.body_iterator:
            if isinstance(chunk, bytes):
                chunks.append(chunk.decode("utf-8"))
            else:
                chunks.append(chunk)
        return chunks

    monkeypatch.setattr(main.session_alias_store, "update_alias_meta", fake_update_alias_meta)
    monkeypatch.setattr(main.nanobot_service, "process_message", fake_process_message)
    monkeypatch.setattr(main.nanobot_service, "agent", None)

    request = main.ChatRequest(message="hello", session_id="api:test-3", project_id=202)
    response = asyncio.run(main.nanobot_chat_stream(request))
    chunks = asyncio.run(collect_stream_chunks(response))
    content = "".join(chunks)

    assert "stream-token" in content
    assert "stream-complete" in content
    assert calls == [{"session_key": "api:test-3", "project_id": 202}]
    assert process_kwargs and process_kwargs[0]["project_id"] == 202
