from __future__ import annotations

from typing import Any, Dict, Mapping, Optional


def sanitize_attributes(attributes: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    if not attributes:
        return {}
    normalized: Dict[str, Any] = {}
    for key, value in attributes.items():
        if value is None:
            continue
        name = str(key).strip()
        if not name:
            continue
        if isinstance(value, (str, int, float, bool)):
            normalized[name] = value
            continue
        normalized[name] = str(value)
    return normalized


def build_chat_trace_attributes(
    *,
    session_id: str,
    project_id: Optional[int],
    model_id: Optional[str],
    route_mode: str,
    source: str,
    knowledge_base_id: Optional[str],
) -> Dict[str, Any]:
    return sanitize_attributes(
        {
            "session_id": session_id,
            "project_id": project_id,
            "model_id": model_id,
            "route_mode": route_mode,
            "source": source,
            "knowledge_base_id": knowledge_base_id,
            "component": "chat_stream",
        }
    )


def build_usage_attributes(usage: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    if not usage:
        return {}
    return sanitize_attributes(
        {
            "usage.prompt_tokens": usage.get("prompt_tokens"),
            "usage.completion_tokens": usage.get("completion_tokens"),
            "usage.total_tokens": usage.get("total_tokens"),
        }
    )


def build_error_attributes(exc: Exception, *, stage: str) -> Dict[str, Any]:
    return sanitize_attributes(
        {
            "error": True,
            "error.stage": stage,
            "error.type": exc.__class__.__name__,
            "error.message": str(exc),
        }
    )
