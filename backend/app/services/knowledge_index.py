import math
import re
import threading
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

from app.services.knowledge_base_store import knowledge_base_store
from app.services.knowledge_global_config_store import knowledge_global_config_store
from app.services.openai_compat import normalize_openai_base_url

try:
    from llama_index.core import Document, VectorStoreIndex
    from llama_index.core.node_parser import SentenceSplitter

    LLAMAINDEX_AVAILABLE = True
except Exception:
    Document = Any
    VectorStoreIndex = Any
    SentenceSplitter = Any
    LLAMAINDEX_AVAILABLE = False


def _tokenize(text: str) -> List[str]:
    return re.findall(r"[a-zA-Z0-9]+|[\u4e00-\u9fff]", (text or "").lower())


def _normalize_embedding_api_base(api_base: str) -> str:
    return normalize_openai_base_url(api_base)


@dataclass
class SearchHit:
    doc_id: str
    title: str
    chunk: str
    score: float
    metadata: Dict[str, Any]


class KnowledgeIndexService:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._cache: Dict[str, Tuple[str, Any, List[Dict[str, Any]]]] = {}

    @staticmethod
    def _signature(kb: Dict[str, Any]) -> str:
        doc_parts = []
        for doc in kb.get("documents", []):
            doc_parts.append(f"{doc.get('id')}:{doc.get('updated_at')}:{len(doc.get('content', ''))}")
        return "|".join(
            [
                str(kb.get("updated_at")),
                str(kb.get("chunk_size")),
                str(kb.get("chunk_overlap")),
                *doc_parts,
            ]
        )

    @staticmethod
    def _fallback_chunks(kb: Dict[str, Any]) -> List[Dict[str, Any]]:
        chunks: List[Dict[str, Any]] = []
        chunk_size = int(kb.get("chunk_size") or 512)
        overlap = int(kb.get("chunk_overlap") or 50)
        step = max(1, chunk_size - overlap)
        for doc in kb.get("documents", []):
            text = doc.get("content") or ""
            if not text:
                continue
            if len(text) <= chunk_size:
                chunks.append(
                    {
                        "doc_id": doc.get("id", ""),
                        "title": doc.get("title", ""),
                        "chunk": text,
                        "metadata": doc.get("metadata") or {},
                    }
                )
                continue
            for start in range(0, len(text), step):
                piece = text[start : start + chunk_size]
                if not piece:
                    continue
                chunks.append(
                    {
                        "doc_id": doc.get("id", ""),
                        "title": doc.get("title", ""),
                        "chunk": piece,
                        "metadata": doc.get("metadata") or {},
                    }
                )
        return chunks

    def _build_index(self, kb: Dict[str, Any]) -> Tuple[Any, List[Dict[str, Any]]]:
        fallback_chunks = self._fallback_chunks(kb)
        if not LLAMAINDEX_AVAILABLE:
            return None, fallback_chunks
        chunk_size = int(kb.get("chunk_size") or 512)
        overlap = int(kb.get("chunk_overlap") or 50)
        splitter = SentenceSplitter(chunk_size=chunk_size, chunk_overlap=overlap)
        docs = [
            Document(
                text=(doc.get("content") or ""),
                metadata={
                    "doc_id": doc.get("id", ""),
                    "title": doc.get("title", ""),
                    **(doc.get("metadata") or {}),
                },
            )
            for doc in kb.get("documents", [])
            if (doc.get("content") or "").strip()
        ]
        if not docs:
            return None, fallback_chunks
        embed_model = self._build_embed_model(kb)
        if embed_model is not None:
            index = VectorStoreIndex.from_documents(
                docs,
                transformations=[splitter],
                embed_model=embed_model,
            )
        else:
            index = VectorStoreIndex.from_documents(docs, transformations=[splitter])
        return index, fallback_chunks

    @staticmethod
    def _build_embed_model(kb: Dict[str, Any]) -> Any:
        from app.services.embedding_model_store import embedding_model_store
        models = embedding_model_store.list_models()
        if not models:
            return None
        
        target_model = None
        kb_model_val = kb.get("embedding_model")
        if kb_model_val:
            # Try matching by ID first, then by model name
            target_model = next((m for m in models if m.get("id") == kb_model_val), None)
            if not target_model:
                target_model = next((m for m in models if m.get("model") == kb_model_val), None)
        
        if not target_model:
            # Fallback to the first model
            target_model = models[0]
            
        api_base = target_model.get("api_base")
        api_key = target_model.get("api_key")
        model_name = target_model.get("model")
        
        if not api_base or not api_key or not model_name:
            return None
        api_base = _normalize_embedding_api_base(api_base)
        try:
            from llama_index.embeddings.openai_like import OpenAILikeEmbedding

            return OpenAILikeEmbedding(
                model_name=model_name,
                api_base=api_base,
                api_key=api_key,
                embed_batch_size=10,
            )
        except Exception:
            try:
                from llama_index.embeddings.openai import OpenAIEmbedding

                return OpenAIEmbedding(
                    model_name=model_name,
                    api_base=api_base,
                    api_key=api_key,
                    embed_batch_size=10,
                )
            except Exception:
                return None

    def reindex(self, kb_id: str) -> Dict[str, Any]:
        kb = knowledge_base_store.get(kb_id)
        if not kb:
            raise ValueError("Knowledge base not found")
        with self._lock:
            signature = self._signature(kb)
            index, fallback_chunks = self._build_index(kb)
            self._cache[kb_id] = (signature, index, fallback_chunks)
        return {
            "kb_id": kb_id,
            "status": "ok",
            "documents": len(kb.get("documents", [])),
            "engine": "llamaindex" if LLAMAINDEX_AVAILABLE and index is not None else "fallback",
        }

    @staticmethod
    def _fallback_search(query: str, chunks: List[Dict[str, Any]], top_k: int) -> List[SearchHit]:
        q_tokens = _tokenize(query)
        if not q_tokens:
            return []
        q_set = set(q_tokens)
        scored: List[SearchHit] = []
        for chunk_item in chunks:
            c_tokens = _tokenize(chunk_item.get("chunk", ""))
            if not c_tokens:
                continue
            overlap = sum(1 for t in c_tokens if t in q_set)
            if overlap == 0:
                continue
            score = overlap / math.sqrt(len(c_tokens))
            scored.append(
                SearchHit(
                    doc_id=chunk_item.get("doc_id", ""),
                    title=chunk_item.get("title", ""),
                    chunk=chunk_item.get("chunk", ""),
                    score=float(score),
                    metadata=chunk_item.get("metadata") or {},
                )
            )
        scored.sort(key=lambda x: x.score, reverse=True)
        return scored[:top_k]

    def search(self, kb_id: str, query: str, top_k: int | None = None) -> Dict[str, Any]:
        kb = knowledge_base_store.get(kb_id)
        if not kb:
            raise ValueError("Knowledge base not found")
        if not kb.get("documents"):
            return {"answer": "", "hits": []}
        effective_top_k = int(top_k or kb.get("top_k") or 3)
        with self._lock:
            signature = self._signature(kb)
            cached = self._cache.get(kb_id)
            if not cached or cached[0] != signature:
                index, fallback_chunks = self._build_index(kb)
                cached = (signature, index, fallback_chunks)
                self._cache[kb_id] = cached
            _, index, fallback_chunks = cached
        if index is None:
            hits = self._fallback_search(query=query, chunks=fallback_chunks, top_k=effective_top_k)
            answer = "\n\n".join(hit.chunk for hit in hits)
            return {
                "answer": answer,
                "hits": [hit.__dict__ for hit in hits],
            }
        retriever = index.as_retriever(similarity_top_k=effective_top_k)
        response_nodes = retriever.retrieve(query)
        hits: List[Dict[str, Any]] = []
        for node_with_score in response_nodes:
            node = getattr(node_with_score, "node", None)
            metadata = getattr(node, "metadata", {}) if node is not None else {}
            chunk_text = ""
            if node is not None and hasattr(node, "get_content"):
                chunk_text = node.get_content()
            elif node is not None:
                chunk_text = str(getattr(node, "text", ""))
            hits.append(
                {
                    "doc_id": metadata.get("doc_id", ""),
                    "title": metadata.get("title", ""),
                    "chunk": chunk_text,
                    "score": float(getattr(node_with_score, "score", 0.0) or 0.0),
                    "metadata": metadata,
                }
            )
        if not hits:
            fallback_hits = self._fallback_search(query=query, chunks=fallback_chunks, top_k=effective_top_k)
            return {
                "answer": "\n\n".join(hit.chunk for hit in fallback_hits),
                "hits": [hit.__dict__ for hit in fallback_hits],
            }
        answer = "\n\n".join(item.get("chunk", "") for item in hits if item.get("chunk"))
        return {"answer": answer, "hits": hits}


knowledge_index_service = KnowledgeIndexService()
