import os
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_ROOT.parent
DEFAULT_DATA_ROOT = REPO_ROOT / "data"
LEGACY_DATA_ROOT = BACKEND_ROOT / "data"


def get_data_root() -> Path:
    configured = (os.getenv("DATA_ROOT") or "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    if DEFAULT_DATA_ROOT.exists():
        return DEFAULT_DATA_ROOT
    if LEGACY_DATA_ROOT.exists():
        print(f"[DATA_ROOT] legacy path detected: {LEGACY_DATA_ROOT}. Please migrate to {DEFAULT_DATA_ROOT}.")
        return LEGACY_DATA_ROOT
    return DEFAULT_DATA_ROOT


def get_workspace_root() -> Path:
    return get_data_root() / "workspace"


def get_uploads_root() -> Path:
    return get_data_root() / "uploads"


def get_reports_root() -> Path:
    return get_data_root() / "data"


def ensure_data_layout() -> None:
    get_data_root().mkdir(parents=True, exist_ok=True)
    get_workspace_root().mkdir(parents=True, exist_ok=True)
    get_uploads_root().mkdir(parents=True, exist_ok=True)
    get_reports_root().mkdir(parents=True, exist_ok=True)
