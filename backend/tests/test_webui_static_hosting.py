from pathlib import Path
import sys

from fastapi.staticfiles import StaticFiles
from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
NANOBOT_ROOT = REPO_ROOT / "nanobot"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
if str(NANOBOT_ROOT) not in sys.path:
    sys.path.insert(0, str(NANOBOT_ROOT))

import main


def _prepare_webui(monkeypatch, tmp_path: Path) -> None:
    webui_dir = tmp_path / "webui"
    assets_dir = webui_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    (webui_dir / "index.html").write_text("<html><body>dataclaw-webui</body></html>", encoding="utf-8")
    (assets_dir / "app.js").write_text("window.__TASK2__=true;", encoding="utf-8")
    monkeypatch.setattr(main, "_WEBUI_DIR", webui_dir)
    monkeypatch.setattr(main, "_WEBUI_INDEX", webui_dir / "index.html")
    monkeypatch.setattr(main, "_WEBUI_STATIC", StaticFiles(directory=str(webui_dir), html=False))


def _prepare_lifecycle(monkeypatch) -> None:
    async def fake_start():
        return None

    async def fake_stop():
        return None

    monkeypatch.setattr(main.nanobot_service, "start", fake_start)
    monkeypatch.setattr(main.nanobot_service, "stop", fake_stop)


def test_webui_static_assets_served_from_backend(monkeypatch, tmp_path) -> None:
    _prepare_webui(monkeypatch, tmp_path)
    _prepare_lifecycle(monkeypatch)
    client = TestClient(main.app)

    index_resp = client.get("/")
    assert index_resp.status_code == 200
    assert "dataclaw-webui" in index_resp.text

    asset_resp = client.get("/assets/app.js")
    assert asset_resp.status_code == 200
    assert "window.__TASK2__=true;" in asset_resp.text


def test_spa_route_fallback_to_index_html(monkeypatch, tmp_path) -> None:
    _prepare_webui(monkeypatch, tmp_path)
    _prepare_lifecycle(monkeypatch)
    client = TestClient(main.app)

    spa_resp = client.get("/settings/users")
    assert spa_resp.status_code == 200
    assert "dataclaw-webui" in spa_resp.text

    missing_asset_resp = client.get("/assets/missing.js")
    assert missing_asset_resp.status_code == 404


def test_backend_accessible_without_frontend_dev_server(monkeypatch, tmp_path) -> None:
    _prepare_webui(monkeypatch, tmp_path)
    _prepare_lifecycle(monkeypatch)
    client = TestClient(main.app)

    ui_resp = client.get("/")
    assert ui_resp.status_code == 200
    assert "dataclaw-webui" in ui_resp.text

    api_resp = client.get("/nanobot/status")
    assert api_resp.status_code == 200
    assert api_resp.json()["status"] in {"running", "stopped"}
