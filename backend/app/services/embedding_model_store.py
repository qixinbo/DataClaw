import json
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.data_root import get_data_root

class EmbeddingModelStore:
    def __init__(self) -> None:
        self._lock = threading.RLock()

    @staticmethod
    def _file_path() -> Path:
        return get_data_root() / "embedding_models.json"

    def _read(self) -> List[Dict[str, Any]]:
        file_path = self._file_path()
        if not file_path.exists():
            return []
        try:
            with file_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError):
            return []
        if not isinstance(data, list):
            return []
        return data

    def _write(self, data: List[Dict[str, Any]]) -> None:
        file_path = self._file_path()
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with file_path.open("w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def list_models(self) -> List[Dict[str, Any]]:
        with self._lock:
            return self._read()

    def get_model(self, model_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            data = self._read()
            for item in data:
                if item.get("id") == model_id:
                    return item
            return None

    def create_model(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            data = self._read()
            new_model = payload.copy()
            new_model["id"] = uuid.uuid4().hex
            data.append(new_model)
            self._write(data)
            return new_model

    def update_model(self, model_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        with self._lock:
            data = self._read()
            for item in data:
                if item.get("id") == model_id:
                    item.update(payload)
                    self._write(data)
                    return item
            return None

    def delete_model(self, model_id: str) -> bool:
        with self._lock:
            data = self._read()
            initial_len = len(data)
            data = [item for item in data if item.get("id") != model_id]
            if len(data) < initial_len:
                self._write(data)
                return True
            return False

embedding_model_store = EmbeddingModelStore()
