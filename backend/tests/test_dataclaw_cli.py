import json
import sys
from importlib import import_module
from pathlib import Path

from typer.testing import CliRunner

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
NANOBOT_ROOT = REPO_ROOT / "nanobot"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
if str(NANOBOT_ROOT) not in sys.path:
    sys.path.insert(0, str(NANOBOT_ROOT))

app = import_module("app.cli").app

runner = CliRunner()


class _FakeProcess:
    def __init__(self, pid: int = 9527, exit_code: int | None = None) -> None:
        self.pid = pid
        self._exit_code = exit_code

    def poll(self):
        return self._exit_code


def test_start_command_writes_state(monkeypatch, tmp_path) -> None:
    pid_file = tmp_path / "run" / "state.json"
    log_file = tmp_path / "run" / "service.log"

    monkeypatch.setattr("app.cli.subprocess.Popen", lambda *args, **kwargs: _FakeProcess())
    monkeypatch.setattr("app.cli._wait_for_server_ready", lambda *_args, **_kwargs: True)

    result = runner.invoke(
        app,
        [
            "start",
            "--host",
            "127.0.0.1",
            "--port",
            "18999",
            "--pid-file",
            str(pid_file),
            "--log-file",
            str(log_file),
        ],
    )

    assert result.exit_code == 0
    assert "已启动" in result.stdout
    assert pid_file.exists()
    state = json.loads(pid_file.read_text(encoding="utf-8"))
    assert state["pid"] == 9527
    assert state["host"] == "127.0.0.1"
    assert state["port"] == 18999


def test_status_command_reports_running(monkeypatch, tmp_path) -> None:
    pid_file = tmp_path / "run" / "state.json"
    pid_file.parent.mkdir(parents=True, exist_ok=True)
    pid_file.write_text(
        json.dumps({"pid": 9527, "host": "127.0.0.1", "port": 18080}, ensure_ascii=False),
        encoding="utf-8",
    )

    monkeypatch.setattr("app.cli._is_process_running", lambda pid: pid == 9527)
    result = runner.invoke(app, ["status", "--pid-file", str(pid_file)])

    assert result.exit_code == 0
    assert "running" in result.stdout
    assert "127.0.0.1:18080" in result.stdout


def test_stop_command_cleans_state(monkeypatch, tmp_path) -> None:
    pid_file = tmp_path / "run" / "state.json"
    pid_file.parent.mkdir(parents=True, exist_ok=True)
    pid_file.write_text(json.dumps({"pid": 9527}, ensure_ascii=False), encoding="utf-8")

    monkeypatch.setattr("app.cli._is_process_running", lambda pid: pid == 9527)
    monkeypatch.setattr("app.cli._stop_pid", lambda pid, timeout: pid == 9527)

    result = runner.invoke(app, ["stop", "--pid-file", str(pid_file)])

    assert result.exit_code == 0
    assert "已停止" in result.stdout
    assert not pid_file.exists()


def test_status_command_cleans_stale_state(monkeypatch, tmp_path) -> None:
    pid_file = tmp_path / "run" / "state.json"
    pid_file.parent.mkdir(parents=True, exist_ok=True)
    pid_file.write_text(json.dumps({"pid": 9527}, ensure_ascii=False), encoding="utf-8")

    monkeypatch.setattr("app.cli._is_process_running", lambda _pid: False)
    result = runner.invoke(app, ["status", "--pid-file", str(pid_file)])

    assert result.exit_code == 0
    assert "stopped" in result.stdout
    assert not pid_file.exists()
