import os
import json
import threading
from typing import Any, Dict

from app.core.data_root import get_data_root

_cache_lock = threading.RLock()
_cache_mtime: float = -1.0
_cache_data: Dict[str, Any] = {}

def get_config_file_path() -> str:
    return str(get_data_root() / "web_search_config.json")

def get_web_search_config() -> Dict[str, Any]:
    global _cache_mtime, _cache_data
    config_file = get_config_file_path()
    current_mtime = os.path.getmtime(config_file) if os.path.exists(config_file) else -1.0
    
    with _cache_lock:
        if current_mtime != _cache_mtime:
            if not os.path.exists(config_file):
                _cache_data = {
                    "provider": "duckduckgo",
                    "api_key": "",
                    "base_url": "",
                    "max_results": 5
                }
            else:
                try:
                    with open(config_file, "r") as f:
                        _cache_data = json.load(f)
                except json.JSONDecodeError:
                    _cache_data = {
                        "provider": "duckduckgo",
                        "api_key": "",
                        "base_url": "",
                        "max_results": 5
                    }
            _cache_mtime = current_mtime
        return dict(_cache_data)

def save_web_search_config(config: Dict[str, Any]) -> None:
    global _cache_mtime, _cache_data
    config_file = get_config_file_path()
    os.makedirs(os.path.dirname(config_file), exist_ok=True)
    with _cache_lock:
        with open(config_file, "w") as f:
            json.dump(config, f, indent=2)
        _cache_data = dict(config)
        _cache_mtime = os.path.getmtime(config_file)
