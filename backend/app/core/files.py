import os
from pathlib import Path
from typing import Optional


backend_root = Path(__file__).resolve().parents[2]
data_root = backend_root / "data"
workspace_root = data_root / "workspace"
uploads_root = data_root / "uploads"
reports_root = data_root / "data"
allowed_artifact_roots = (workspace_root, uploads_root, reports_root)


def resolve_upload_file_path(file_url: Optional[str]) -> Path:
    if not file_url:
        raise ValueError("File URL is empty")

    if file_url.startswith("local://"):
        raw_name = file_url.replace("local://", "", 1)
        safe_name = os.path.basename(raw_name)
        file_path = uploads_root / safe_name
        return file_path

    return Path(file_url)


def resolve_artifact_target(target: str) -> Path | None:
    locator = (target or "").strip().strip("'\"")
    if not locator:
        return None
    if locator.startswith("local://"):
        raw_local = locator.replace("local://", "", 1).strip().lstrip("/\\")
        if not raw_local:
            return None
        candidate = Path(raw_local)
        if candidate.is_absolute():
            return candidate
        checks = (
            workspace_root / candidate,
            reports_root / candidate,
            uploads_root / candidate,
            uploads_root / candidate.name,
        )
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
    checks = (
        workspace_root / normalized,
        data_root / normalized,
        backend_root / normalized,
    )
    for candidate in checks:
        if candidate.exists():
            return candidate
    return None


def ensure_artifact_access(path: Path, *, require_file: bool = True) -> Path:
    try:
        resolved = path.resolve(strict=True)
    except FileNotFoundError as exc:
        raise FileNotFoundError("目标文件不存在") from exc
    if require_file and not resolved.is_file():
        raise FileNotFoundError("目标文件不存在")
    if not require_file and not resolved.is_dir():
        raise FileNotFoundError("目标目录不存在")
    for root in allowed_artifact_roots:
        if resolved.is_relative_to(root.resolve()):
            return resolved
    raise PermissionError("非法路径访问")
