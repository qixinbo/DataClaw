import json
from typing import Any

from nanobot.agent.tools.base import Tool

from app.context import current_knowledge_base_id
from app.services.knowledge_index import knowledge_index_service


class KnowledgeBaseRetrieveTool(Tool):
    @property
    def name(self) -> str:
        return "knowledge_retrieve"

    @property
    def description(self) -> str:
        return "Retrieve relevant context from the selected knowledge base to answer user questions."

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "User question or retrieval query.",
                },
                "knowledge_base_id": {
                    "type": "string",
                    "description": "Optional knowledge base id, defaults to current session setting.",
                },
                "top_k": {
                    "type": "integer",
                    "description": "Maximum number of returned chunks.",
                    "minimum": 1,
                    "maximum": 20,
                },
            },
            "required": ["query"],
        }

    async def execute(self, **kwargs: Any) -> str:
        query = (kwargs.get("query") or "").strip()
        if not query:
            return "Query is required."
        kb_id = (kwargs.get("knowledge_base_id") or current_knowledge_base_id.get() or "").strip()
        if not kb_id:
            return "No knowledge base is selected in this session."
        top_k = kwargs.get("top_k")
        try:
            result = knowledge_index_service.search(kb_id=kb_id, query=query, top_k=top_k)
        except ValueError as exc:
            return str(exc)
        payload = {
            "knowledge_base_id": kb_id,
            "answer": result.get("answer", ""),
            "hits": result.get("hits", []),
        }
        return json.dumps(payload, ensure_ascii=False)
