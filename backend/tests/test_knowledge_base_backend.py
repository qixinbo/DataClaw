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

from fastapi.testclient import TestClient

import main
from app.context import current_knowledge_base_id
from app.schemas.knowledge import KnowledgeSearchResponse
from app.tools.knowledge_base import KnowledgeBaseRetrieveTool


def test_knowledge_base_crud_and_search_routes(monkeypatch, tmp_path) -> None:
    async def fake_start():
        return None

    async def fake_stop():
        return None

    monkeypatch.setenv("DATA_ROOT", str(tmp_path))
    monkeypatch.setattr(main.nanobot_service, "start", fake_start)
    monkeypatch.setattr(main.nanobot_service, "stop", fake_stop)

    client = TestClient(main.app)

    create_resp = client.post(
        "/api/v1/knowledge-bases",
        json={"name": "产品手册", "description": "用于问答", "top_k": 2, "chunk_size": 256, "chunk_overlap": 20},
    )
    assert create_resp.status_code == 200
    kb = create_resp.json()
    kb_id = kb["id"]

    list_resp = client.get("/api/v1/knowledge-bases")
    assert list_resp.status_code == 200
    assert any(item["id"] == kb_id for item in list_resp.json())

    doc_resp = client.post(
        f"/api/v1/knowledge-bases/{kb_id}/documents",
        json={"title": "退款规则", "content": "苹果手机支持7天无理由退款", "metadata": {"lang": "zh"}},
    )
    assert doc_resp.status_code == 200
    doc_id = doc_resp.json()["id"]

    reindex_resp = client.post(f"/api/v1/knowledge-bases/{kb_id}/reindex")
    assert reindex_resp.status_code == 200

    search_resp = client.post(f"/api/v1/knowledge-bases/{kb_id}/search", json={"query": "苹果退款", "top_k": 2})
    assert search_resp.status_code == 200
    parsed = KnowledgeSearchResponse(**search_resp.json())
    assert parsed.hits
    assert "苹果" in parsed.answer

    update_resp = client.put(f"/api/v1/knowledge-bases/{kb_id}", json={"name": "售后知识库"})
    assert update_resp.status_code == 200
    assert update_resp.json()["name"] == "售后知识库"

    delete_doc_resp = client.delete(f"/api/v1/knowledge-bases/{kb_id}/documents/{doc_id}")
    assert delete_doc_resp.status_code == 200
    delete_kb_resp = client.delete(f"/api/v1/knowledge-bases/{kb_id}")
    assert delete_kb_resp.status_code == 200


def test_knowledge_global_config_mask_and_validation(monkeypatch, tmp_path) -> None:
    async def fake_start():
        return None

    async def fake_stop():
        return None

    monkeypatch.setenv("DATA_ROOT", str(tmp_path))
    monkeypatch.setattr(main.nanobot_service, "start", fake_start)
    monkeypatch.setattr(main.nanobot_service, "stop", fake_stop)
    client = TestClient(main.app)

    initial_resp = client.get("/api/v1/knowledge-bases/global-config")
    assert initial_resp.status_code == 200
    assert initial_resp.json() == {
        "api_base": None,
        "api_key": None,
        "api_key_masked": None,
        "has_api_key": False,
        "default_embedding_model": None,
    }

    update_resp = client.put(
        "/api/v1/knowledge-bases/global-config",
        json={"api_base": "https://kb.example.com/", "api_key": "sk-knowledge-secret", "default_embedding_model": "text-embedding-3-small"},
    )
    assert update_resp.status_code == 200
    body = update_resp.json()
    assert body["api_base"] == "https://kb.example.com"
    assert body["api_key"] is None
    assert body["has_api_key"] is True
    assert body["api_key_masked"] == "sk-k***********cret"
    assert body["default_embedding_model"] == "text-embedding-3-small"

    get_resp = client.get("/api/v1/knowledge-bases/global-config")
    assert get_resp.status_code == 200
    assert get_resp.json()["api_key"] is None
    assert get_resp.json()["api_key_masked"] == "sk-k***********cret"
    assert get_resp.json()["default_embedding_model"] == "text-embedding-3-small"

    invalid_resp = client.put("/api/v1/knowledge-bases/global-config", json={"api_base": "ftp://kb.example.com"})
    assert invalid_resp.status_code == 422


def test_chat_request_syncs_knowledge_base_metadata(monkeypatch) -> None:
    captured_kb_ids: list[str | None] = []
    captured_messages: list[str] = []

    class _DummySession:
        def __init__(self):
            self.metadata = {}
            self.messages = []
            self.updated_at = None

    class _DummySessions:
        def __init__(self):
            self._sessions: dict[str, _DummySession] = {}

        def get_or_create(self, key: str):
            if key not in self._sessions:
                self._sessions[key] = _DummySession()
            return self._sessions[key]

        def save(self, _session):
            return None

    class _DummyAgent:
        def __init__(self):
            self.sessions = _DummySessions()

    async def fake_process_message(*args, **kwargs):
        captured_kb_ids.append(current_knowledge_base_id.get())
        if args and isinstance(args[0], str):
            captured_messages.append(args[0])
        return "ok"

    def fake_search(*, kb_id: str, query: str, top_k=None):
        assert kb_id == "kb-123"
        assert query == "请回答售后规则"
        return {
            "answer": "命中结果",
            "hits": [
                {"doc_id": "d1", "title": "退款规则", "chunk": "7天无理由退款", "score": 0.9, "metadata": {}},
                {"doc_id": "d2", "title": "售后电话", "chunk": "客服电话 400-1234", "score": 0.7, "metadata": {}},
            ],
        }

    monkeypatch.setattr(main.nanobot_service, "agent", _DummyAgent())
    monkeypatch.setattr(main.nanobot_service, "process_message", fake_process_message)
    monkeypatch.setattr("main.knowledge_index_service.search", fake_search)

    request = main.ChatRequest(message="请回答售后规则", session_id="api:kb-1", knowledge_base_id="kb-123")
    response = asyncio.run(main.nanobot_chat(request))
    assert response["response"] == "ok"
    assert "kb_citations" in response
    assert len(response["kb_citations"]) == 2
    assert response["kb_citations"][0]["title"] == "退款规则"
    assert captured_kb_ids == ["kb-123"]
    assert captured_messages and "7天无理由退款" in captured_messages[0]
    session = main.nanobot_service.agent.sessions.get_or_create("api:kb-1")
    assert session.metadata["selected_knowledge_base_id"] == "kb-123"


def test_knowledge_tool_uses_session_context(monkeypatch) -> None:
    tool = KnowledgeBaseRetrieveTool()
    token = current_knowledge_base_id.set("kb-session")
    called: list[dict] = []

    def fake_search(*, kb_id: str, query: str, top_k=None):
        called.append({"kb_id": kb_id, "query": query, "top_k": top_k})
        return {
            "answer": "命中结果",
            "hits": [{"doc_id": "d1", "title": "t1", "chunk": "命中结果", "score": 1.0, "metadata": {}}],
        }

    monkeypatch.setattr("app.tools.knowledge_base.knowledge_index_service.search", fake_search)
    try:
        output = asyncio.run(tool.execute(query="售后政策"))
    finally:
        current_knowledge_base_id.reset(token)
    assert called and called[0]["kb_id"] == "kb-session"
    assert "命中结果" in output


def test_update_session_context_file_supports_knowledge_base(monkeypatch) -> None:
    class _DummySession:
        def __init__(self):
            self.metadata = {}
            self.updated_at = None

    class _DummySessions:
        def __init__(self):
            self.session = _DummySession()

        def get_or_create(self, _key: str):
            return self.session

        def save(self, _session):
            return None

    class _DummyAgent:
        def __init__(self):
            self.sessions = _DummySessions()

    monkeypatch.setattr(main.nanobot_service, "agent", _DummyAgent())
    payload = main.SessionFileContextUpdateRequest(selected_knowledge_base_id="kb-ctx")
    response = main.update_session_context_file("api:ctx", payload)
    assert response["status"] == "success"
    assert response["metadata"]["selected_knowledge_base_id"] == "kb-ctx"


def test_knowledge_global_connection_test_route(monkeypatch, tmp_path) -> None:
    async def fake_start():
        return None

    async def fake_stop():
        return None

    class _DummyEmbeddingData:
        embedding = [0.1, 0.2, 0.3]

    class _DummyEmbeddingResp:
        data = [_DummyEmbeddingData()]

    class _DummyEmbeddingsAPI:
        @staticmethod
        def create(model: str, input: str):
            assert model == "text-embedding-3-small"
            assert input == "connection test"
            return _DummyEmbeddingResp()

    class _DummyOpenAI:
        def __init__(self, api_key: str, base_url: str):
            assert api_key == "sk-knowledge-secret"
            assert base_url == "https://kb.example.com"
            self.embeddings = _DummyEmbeddingsAPI()

    monkeypatch.setenv("DATA_ROOT", str(tmp_path))
    monkeypatch.setattr(main.nanobot_service, "start", fake_start)
    monkeypatch.setattr(main.nanobot_service, "stop", fake_stop)
    monkeypatch.setattr("app.api.knowledge.OpenAI", _DummyOpenAI)

    client = TestClient(main.app)
    save_resp = client.put(
        "/api/v1/knowledge-bases/global-config",
        json={
            "api_base": "https://kb.example.com",
            "api_key": "sk-knowledge-secret",
            "default_embedding_model": "text-embedding-3-small",
        },
    )
    assert save_resp.status_code == 200

    test_resp = client.post(
        "/api/v1/knowledge-bases/global-config/test-connection",
        json={"model_name": "text-embedding-3-small"},
    )
    assert test_resp.status_code == 200
    body = test_resp.json()
    assert body["success"] is True
    assert body["model_name"] == "text-embedding-3-small"
    assert body["embedding_dimension"] == 3
    assert body["resolved_api_base"] == "https://kb.example.com"
    assert body["available_models"] == []


def test_knowledge_global_connection_test_route_requires_model_name(monkeypatch, tmp_path) -> None:
    async def fake_start():
        return None

    async def fake_stop():
        return None

    monkeypatch.setenv("DATA_ROOT", str(tmp_path))
    monkeypatch.setattr(main.nanobot_service, "start", fake_start)
    monkeypatch.setattr(main.nanobot_service, "stop", fake_stop)

    client = TestClient(main.app)
    resp = client.post(
        "/api/v1/knowledge-bases/global-config/test-connection",
        json={
            "api_base": "https://api.siliconflow.cn/v1/embeddings",
            "api_key": "ark-key",
        },
    )
    assert resp.status_code == 400
    assert "测试连接必须显式填写向量模型名称" in resp.json()["detail"]


def test_knowledge_global_connection_test_route_returns_remote_error(monkeypatch, tmp_path) -> None:
    async def fake_start():
        return None

    async def fake_stop():
        return None

    class _DummyEmbeddingsAPI:
        @staticmethod
        def create(model: str, input: str):
            assert model == "BAAI/bge-large-zh-v1.5"
            assert input == "connection test"
            raise RuntimeError("Not Found")

    class _DummyOpenAI:
        def __init__(self, api_key: str, base_url: str):
            assert api_key == "sf-key"
            assert base_url == "https://api.siliconflow.cn/v1"
            self.embeddings = _DummyEmbeddingsAPI()

    monkeypatch.setenv("DATA_ROOT", str(tmp_path))
    monkeypatch.setattr(main.nanobot_service, "start", fake_start)
    monkeypatch.setattr(main.nanobot_service, "stop", fake_stop)
    monkeypatch.setattr("app.api.knowledge.OpenAI", _DummyOpenAI)

    client = TestClient(main.app)
    resp = client.post(
        "/api/v1/knowledge-bases/global-config/test-connection",
        json={
            "api_base": "https://api.siliconflow.cn/v1/embeddings",
            "api_key": "sf-key",
            "model_name": "BAAI/bge-large-zh-v1.5",
        },
    )
    assert resp.status_code == 400
    assert "Embedding调用失败" in resp.json()["detail"]


def test_knowledge_document_upload_route(monkeypatch, tmp_path) -> None:
    async def fake_start():
        return None

    async def fake_stop():
        return None

    monkeypatch.setenv("DATA_ROOT", str(tmp_path))
    monkeypatch.setattr(main.nanobot_service, "start", fake_start)
    monkeypatch.setattr(main.nanobot_service, "stop", fake_stop)

    client = TestClient(main.app)
    create_resp = client.post(
        "/api/v1/knowledge-bases",
        json={"name": "上传测试库", "description": "用于上传", "top_k": 2, "chunk_size": 256, "chunk_overlap": 20},
    )
    assert create_resp.status_code == 200
    kb_id = create_resp.json()["id"]

    files = [
        ("files", ("doc1.txt", b"hello knowledge", "text/plain")),
        ("files", ("doc2.md", b"# title\ncontent", "text/markdown")),
    ]
    upload_resp = client.post(
        f"/api/v1/knowledge-bases/{kb_id}/documents/upload",
        files=files,
        data={"metadata": "{\"source\":\"batch\"}"},
    )
    assert upload_resp.status_code == 200
    body = upload_resp.json()
    assert body["status"] == "success"
    assert body["count"] == 2
    assert len(body["documents"]) == 2

    list_resp = client.get(f"/api/v1/knowledge-bases/{kb_id}/documents")
    assert list_resp.status_code == 200
    docs = list_resp.json()
    assert len(docs) == 2
