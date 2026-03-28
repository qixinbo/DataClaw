import json
import threading
from pathlib import Path
from typing import Any, Dict

from app.core.data_root import get_data_root


class KnowledgeGlobalConfigStore:
    def __init__(self) -> None:
        self._lock = threading.RLock()

    @staticmethod
    def _file_path() -> Path:
        return get_data_root() / "knowledge_global_config.json"

    def _read(self) -> Dict[str, Any]:
        file_path = self._file_path()
        if not file_path.exists():
            return {}
        try:
            with file_path.open("r", encoding="utf-8") as file_obj:
                data = json.load(file_obj)
        except (OSError, json.JSONDecodeError):
            return {}
        if not isinstance(data, dict):
            return {}
        return data

    def _write(self, data: Dict[str, Any]) -> None:
        file_path = self._file_path()
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with file_path.open("w", encoding="utf-8") as file_obj:
            json.dump(data, file_obj, indent=2, ensure_ascii=False)

    def get(self) -> Dict[str, Any]:
        with self._lock:
            data = self._read()
            return {
                "api_base": data.get("api_base"),
                "api_key": data.get("api_key"),
                "default_embedding_model": data.get("default_embedding_model"),
            }

    def update(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            current = self.get()
            if "api_base" in payload:
                current["api_base"] = payload.get("api_base")
            if "api_key" in payload:
                current["api_key"] = payload.get("api_key")
            if "default_embedding_model" in payload:
                current["default_embedding_model"] = payload.get("default_embedding_model")
            self._write(current)
            return current


knowledge_global_config_store = KnowledgeGlobalConfigStore()
