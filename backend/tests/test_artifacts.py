from pathlib import Path

from app.core.artifacts import extract_artifacts
from app.core.data_root import get_data_root


def _backend_data_root() -> Path:
    return get_data_root()


def test_extract_artifacts_from_local_and_tool_paths() -> None:
    data_root = _backend_data_root()
    uploads_dir = data_root / "uploads"
    workspace_dir = data_root / "workspace" / "reports"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    workspace_dir.mkdir(parents=True, exist_ok=True)

    upload_file = uploads_dir / "task1-sample.csv"
    upload_file.write_text("a,b\n1,2\n", encoding="utf-8")
    report_file = workspace_dir / "task1-report.html"
    report_file.write_text("<html><body>ok</body></html>", encoding="utf-8")

    content = "请下载 local://task1-sample.csv"
    session_messages = [
        {"role": "user", "content": "生成报告"},
        {"role": "tool", "content": f"输出文件：{report_file}"},
    ]

    artifacts = extract_artifacts(content, session_messages)

    by_name = {item["name"]: item for item in artifacts}
    assert "task1-sample.csv" in by_name
    assert "task1-report.html" in by_name
    assert by_name["task1-sample.csv"]["download_url"].startswith("/nanobot/artifacts/download?target=")
    assert by_name["task1-sample.csv"]["previewable"] is True
    assert by_name["task1-report.html"]["previewable"] is True
    assert by_name["task1-report.html"]["preview_url"].startswith("/nanobot/artifacts/preview?target=")


def test_extract_artifacts_deduplicate_and_skip_missing() -> None:
    data_root = _backend_data_root()
    workspace_dir = data_root / "workspace"
    workspace_dir.mkdir(parents=True, exist_ok=True)

    pdf_file = workspace_dir / "task1-dedup.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 test")
    missing_file = workspace_dir / "task1-missing.pdf"

    content = f"{pdf_file} and {pdf_file} and {missing_file}"
    artifacts = extract_artifacts(content, [])

    assert len(artifacts) == 1
    item = artifacts[0]
    assert item["name"] == "task1-dedup.pdf"
    assert item["mime_type"] == "application/pdf"
    assert item["previewable"] is True
