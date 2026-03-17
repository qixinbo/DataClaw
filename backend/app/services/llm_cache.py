import os
import threading
from typing import Any, Dict, List, Optional

from app.api.llm import DATA_FILE, _load_data

_cache_lock = threading.RLock()
_cache_mtime: float = -1.0
_cache_data: List[Dict[str, Any]] = []


def get_llm_configs() -> List[Dict[str, Any]]:
    global _cache_mtime, _cache_data
    current_mtime = os.path.getmtime(DATA_FILE) if os.path.exists(DATA_FILE) else -1.0
    with _cache_lock:
        if current_mtime != _cache_mtime:
            _cache_data = _load_data()
            _cache_mtime = current_mtime
        return list(_cache_data)


def get_active_llm_config() -> Optional[Dict[str, Any]]:
    configs = get_llm_configs()
    return next((c for c in configs if c.get("is_active")), None)
