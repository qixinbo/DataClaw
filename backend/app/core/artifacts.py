import mimetypes
import re
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote

from pydantic import BaseModel


LOCAL_URI_PATTERN = re.compile(r"local://[^\s<>'\"\]\)\}]+")
PATH_PATTERN = re.compile(
    r"(?:[A-Za-z]:[\\/][^\s<>'\"]+\.[A-Za-z0-9]{1,12}|/[^\s<>'\"]+\.[A-Za-z0-9]{1,12}|(?:\.\./|\.?/)?(?:[\w\-.]+[\\/])+[\w\-.]+\.[A-Za-z0-9]{1,12})"
)
REPORT_PATH_PATTERN = re.compile(r"data[\\/]data[\\/][\w\-.]+\.[A-Za-z0-9]{1,12}", re.IGNORECASE)
PREVIEWABLE_EXTENSIONS = {
    ".html",
    ".htm",
    ".pdf",
    ".pptx",
    ".txt",
    ".md",
    ".json",
    ".csv",
    ".tsv",
    ".yaml",
    ".yml",
    ".xml",
    ".log",
}


class ArtifactPayload(BaseModel):
    name: str
    mime_type: str
    size: int
    download_url: str
    previewable: bool
    preview_url: str | None = None


def extract_artifacts(content: str, session_messages: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    candidates = _collect_candidate_texts(content, session_messages or [])
    ordered_locators: list[str] = []
    seen_locators: set[str] = set()
    for text in candidates:
        for locator in _extract_locators(text):
            if locator in seen_locators:
                continue
            seen_locators.add(locator)
            ordered_locators.append(locator)
    artifacts: list[dict[str, Any]] = []
    seen_paths: set[Path] = set()
    for locator in ordered_locators:
        path = _resolve_locator(locator)
        if not path or not path.exists() or not path.is_file():
            continue
        resolved = path.resolve()
        if resolved in seen_paths:
            continue
        seen_paths.add(resolved)
        artifact = _build_artifact_payload(locator, resolved)
        artifacts.append(artifact.model_dump(exclude_none=True))
    return artifacts


def _build_artifact_payload(locator: str, path: Path) -> ArtifactPayload:
    mime_type = _guess_mime_type(path)
    previewable = _is_previewable(path, mime_type)
    encoded = quote(locator, safe="")
    preview_url = f"/nanobot/artifacts/preview?target={encoded}" if previewable else None
    return ArtifactPayload(
        name=path.name,
        mime_type=mime_type,
        size=path.stat().st_size,
        download_url=f"/nanobot/artifacts/download?target={encoded}",
        previewable=previewable,
        preview_url=preview_url,
    )


def _guess_mime_type(path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(path.name)
    return mime_type or "application/octet-stream"


def _is_previewable(path: Path, mime_type: str) -> bool:
    if mime_type.startswith("image/") or mime_type.startswith("text/"):
        return True
    extension = path.suffix.lower()
    if extension in PREVIEWABLE_EXTENSIONS:
        return True
    return mime_type in {
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }


def _collect_candidate_texts(content: str, session_messages: list[dict[str, Any]]) -> list[str]:
    texts = [content or ""]
    if not session_messages:
        return texts
    last_user_idx = -1
    for idx, message in enumerate(session_messages):
        if message.get("role") == "user":
            last_user_idx = idx
    if last_user_idx == -1:
        segment = session_messages
    else:
        segment = session_messages[last_user_idx + 1 :]
    for message in segment:
        raw = message.get("content")
        flattened = _flatten_content(raw)
        if flattened:
            texts.append(flattened)
    return texts


def _extract_locators(text: str) -> Iterable[str]:
    if not text:
        return []
    ordered: list[str] = []
    seen: set[str] = set()
    patterns = (LOCAL_URI_PATTERN, REPORT_PATH_PATTERN, PATH_PATTERN)
    for pattern in patterns:
        for match in pattern.findall(text):
            normalized = _normalize_locator(match)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            ordered.append(normalized)
    return ordered


def _normalize_locator(raw_locator: str) -> str:
    locator = raw_locator.strip().strip("`'\"")
    locator = locator.rstrip(".,;:!?)]}")
    return locator


def _resolve_locator(locator: str) -> Path | None:
    backend_root = Path(__file__).resolve().parents[2]
    data_root = backend_root / "data"
    workspace_root = data_root / "workspace"
    uploads_root = data_root / "uploads"
    reports_root = data_root / "data"
    if locator.startswith("local://"):
        raw_local = locator.replace("local://", "", 1).strip().lstrip("/\\")
        if not raw_local:
            return None
        candidate = Path(raw_local)
        if candidate.is_absolute():
            return candidate
        checks = [workspace_root / candidate, reports_root / candidate, uploads_root / candidate, uploads_root / candidate.name]
        for path in checks:
            if path.exists():
                return path
        return uploads_root / candidate.name
    normalized = locator.replace("\\", "/")
    path = Path(locator)
    if path.is_absolute():
        return path
    if normalized.startswith("data/data/"):
        return backend_root / normalized
    checks = [
        workspace_root / normalized,
        data_root / normalized,
        backend_root / normalized,
    ]
    for candidate in checks:
        if candidate.exists():
            return candidate
    return None


def _flatten_content(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        fragments: list[str] = []
        for item in value:
            flattened = _flatten_content(item)
            if flattened:
                fragments.append(flattened)
        return "\n".join(fragments)
    if isinstance(value, dict):
        fragments: list[str] = []
        text = value.get("text")
        if isinstance(text, str):
            fragments.append(text)
        content = value.get("content")
        if content is not None:
            nested = _flatten_content(content)
            if nested:
                fragments.append(nested)
        for field in ("path", "file", "file_path", "url"):
            data = value.get(field)
            if isinstance(data, str):
                fragments.append(data)
        return "\n".join(fragments)
    return str(value)
