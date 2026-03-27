from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.data_root import get_data_root
from main import app


def _backend_data_root() -> Path:
    return get_data_root()


def test_download_artifact_within_whitelist() -> None:
    uploads_dir = _backend_data_root() / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    sample = uploads_dir / "task2-download.csv"
    sample.write_text("id,name\n1,a\n", encoding="utf-8")

    client = TestClient(app)
    response = client.get("/nanobot/artifacts/download", params={"target": "local://task2-download.csv"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/octet-stream")
    assert response.headers["content-disposition"].startswith("attachment;")
    assert response.content == sample.read_bytes()


def test_download_artifact_rejects_outside_paths() -> None:
    client = TestClient(app)
    response = client.get("/nanobot/artifacts/download", params={"target": "/etc/hosts"})

    assert response.status_code == 403
    assert response.json()["detail"] == "非法路径访问"


def test_preview_artifact_returns_unsupported_for_binary() -> None:
    uploads_dir = _backend_data_root() / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    sample = uploads_dir / "task2-unsupported.bin"
    sample.write_bytes(b"\x00\x01\x02")

    client = TestClient(app)
    response = client.get("/nanobot/artifacts/preview", params={"target": f"local://{sample.name}"})

    assert response.status_code == 415
    assert response.json()["detail"] == "当前文件类型不支持预览，请使用下载"
    download = client.get("/nanobot/artifacts/download", params={"target": f"local://{sample.name}"})
    assert download.status_code == 200
    assert download.content == sample.read_bytes()


def test_preview_html_supports_directory_resources() -> None:
    web_dir = _backend_data_root() / "workspace" / "task2-web"
    web_dir.mkdir(parents=True, exist_ok=True)
    html_file = web_dir / "index.html"
    css_file = web_dir / "styles.css"
    html_file.write_text("<html><head><link rel='stylesheet' href='styles.css'></head><body>ok</body></html>", encoding="utf-8")
    css_file.write_text("body{color:#333;}", encoding="utf-8")

    client = TestClient(app)
    preview = client.get(
        "/nanobot/artifacts/preview",
        params={"target": str(html_file)},
        follow_redirects=False,
    )

    assert preview.status_code == 307
    location = preview.headers["location"]
    assert location.startswith("/nanobot/artifacts/web/")

    html_response = client.get(location)
    assert html_response.status_code == 200
    assert "text/html" in html_response.headers["content-type"]
    assert "styles.css" in html_response.text

    css_response = client.get(location.replace("index.html", "styles.css"))
    assert css_response.status_code == 200
    assert "text/css" in css_response.headers["content-type"]
    assert "color:#333" in css_response.text


@pytest.mark.parametrize(
    ("filename", "payload", "expected_mime"),
    [
        ("task4-image.png", b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR", "image/png"),
        ("task4-preview.pdf", b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n", "application/pdf"),
        (
            "task4-preview.pptx",
            b"PK\x03\x04\x14\x00\x00\x00\x08\x00\x00\x00!\x00",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ),
    ],
)
def test_preview_and_download_supported_types(filename: str, payload: bytes, expected_mime: str) -> None:
    uploads_dir = _backend_data_root() / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    sample = uploads_dir / filename
    sample.write_bytes(payload)

    client = TestClient(app)
    preview = client.get("/nanobot/artifacts/preview", params={"target": f"local://{filename}"})
    assert preview.status_code == 200
    assert preview.headers["content-type"].startswith(expected_mime)

    download = client.get("/nanobot/artifacts/download", params={"target": f"local://{filename}"})
    assert download.status_code == 200
    assert download.content == sample.read_bytes()


def test_web_preview_missing_resource_returns_error_and_download_still_works() -> None:
    web_dir = _backend_data_root() / "workspace" / "task4-web-missing"
    web_dir.mkdir(parents=True, exist_ok=True)
    html_file = web_dir / "index.html"
    html_file.write_text("<html><head><script src='missing.js'></script></head><body>ok</body></html>", encoding="utf-8")

    client = TestClient(app)
    preview = client.get(
        "/nanobot/artifacts/preview",
        params={"target": str(html_file)},
        follow_redirects=False,
    )
    assert preview.status_code == 307
    location = preview.headers["location"]

    missing = client.get(location.replace("index.html", "missing.js"))
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Web 资源不存在"

    download = client.get("/nanobot/artifacts/download", params={"target": str(html_file)})
    assert download.status_code == 200
    assert download.content == html_file.read_bytes()
