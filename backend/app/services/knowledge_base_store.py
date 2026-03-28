import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.data_root import get_data_root


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class KnowledgeBaseStore:
    def __init__(self) -> None:
        self._lock = threading.RLock()

    @staticmethod
    def _file_path() -> Path:
        return get_data_root() / "knowledge_bases.json"

    def _read(self) -> List[Dict[str, Any]]:
        file_path = self._file_path()
        if not file_path.exists():
            return []
        try:
            with file_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            return []
        if not isinstance(data, list):
            return []
        return data

    def _write(self, data: List[Dict[str, Any]]) -> None:
        file_path = self._file_path()
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with file_path.open("w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    @staticmethod
    def _normalize_documents(item: Dict[str, Any]) -> None:
        docs = item.get("documents")
        if not isinstance(docs, list):
            item["documents"] = []
            return
        normalized: List[Dict[str, Any]] = []
        for doc in docs:
            if not isinstance(doc, dict):
                continue
            if not doc.get("id"):
                doc["id"] = str(uuid.uuid4())
            now = _utcnow_iso()
            doc.setdefault("created_at", now)
            doc.setdefault("updated_at", now)
            doc.setdefault("metadata", {})
            normalized.append(doc)
        item["documents"] = normalized

    def list(self, project_id: Optional[int] = None) -> List[Dict[str, Any]]:
        with self._lock:
            data = self._read()
            for item in data:
                self._normalize_documents(item)
            if project_id is None:
                return data
            return [item for item in data if item.get("project_id") == project_id]

    def get(self, kb_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            for item in self._read():
                if item.get("id") == kb_id:
                    self._normalize_documents(item)
                    return item
            return None

    def create(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            data = self._read()
            now = _utcnow_iso()
            item = {
                "id": str(uuid.uuid4()),
                "name": payload["name"],
                "description": payload.get("description"),
                "project_id": payload.get("project_id"),
                "embedding_model": payload.get("embedding_model"),
                "chunk_size": payload.get("chunk_size", 512),
                "chunk_overlap": payload.get("chunk_overlap", 50),
                "top_k": payload.get("top_k", 3),
                "is_active": payload.get("is_active", True),
                "created_at": now,
                "updated_at": now,
                "documents": [],
            }
            data.append(item)
            self._write(data)
            return item

    def update(self, kb_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        with self._lock:
            data = self._read()
            for idx, item in enumerate(data):
                if item.get("id") != kb_id:
                    continue
                for key, value in payload.items():
                    item[key] = value
                item["updated_at"] = _utcnow_iso()
                self._normalize_documents(item)
                data[idx] = item
                self._write(data)
                return item
            return None

    def delete(self, kb_id: str) -> bool:
        with self._lock:
            data = self._read()
            filtered = [item for item in data if item.get("id") != kb_id]
            if len(filtered) == len(data):
                return False
            self._write(filtered)
            return True

    def create_document(self, kb_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        with self._lock:
            data = self._read()
            for idx, item in enumerate(data):
                if item.get("id") != kb_id:
                    continue
                now = _utcnow_iso()
                doc = {
                    "id": str(uuid.uuid4()),
                    "title": payload["title"],
                    "content": payload["content"],
                    "metadata": payload.get("metadata", {}),
                    "created_at": now,
                    "updated_at": now,
                }
                self._normalize_documents(item)
                item["documents"].append(doc)
                item["updated_at"] = now
                data[idx] = item
                self._write(data)
                return doc
            return None

    def update_document(self, kb_id: str, doc_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        with self._lock:
            data = self._read()
            for kb_idx, item in enumerate(data):
                if item.get("id") != kb_id:
                    continue
                self._normalize_documents(item)
                docs = item["documents"]
                for doc_idx, doc in enumerate(docs):
                    if doc.get("id") != doc_id:
                        continue
                    for key, value in payload.items():
                        doc[key] = value
                    doc["updated_at"] = _utcnow_iso()
                    docs[doc_idx] = doc
                    item["updated_at"] = _utcnow_iso()
                    data[kb_idx] = item
                    self._write(data)
                    return doc
                return None
            return None

    def delete_document(self, kb_id: str, doc_id: str) -> bool:
        with self._lock:
            data = self._read()
            for kb_idx, item in enumerate(data):
                if item.get("id") != kb_id:
                    continue
                self._normalize_documents(item)
                docs = item["documents"]
                filtered = [doc for doc in docs if doc.get("id") != doc_id]
                if len(filtered) == len(docs):
                    return False
                item["documents"] = filtered
                item["updated_at"] = _utcnow_iso()
                data[kb_idx] = item
                self._write(data)
                return True
            return False


knowledge_base_store = KnowledgeBaseStore()
