import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import typer
from rich.console import Console

from app.core.data_root import get_data_root

app = typer.Typer(
    name="dataclaw",
    context_settings={"help_option_names": ["-h", "--help"]},
    help="DataClaw WebUI 服务控制命令",
    no_args_is_help=True,
)
console = Console()


def _default_pid_file() -> Path:
    return get_data_root() / "run" / "dataclaw-webui.json"


def _default_log_file() -> Path:
    return get_data_root() / "run" / "dataclaw-webui.log"


def _resolve_path(value: str | None, fallback: Path) -> Path:
    if value:
        return Path(value).expanduser().resolve()
    return fallback


def _ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def _read_state(pid_file: Path) -> dict[str, Any] | None:
    if not pid_file.exists():
        return None
    try:
        return json.loads(pid_file.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_state(pid_file: Path, state: dict[str, Any]) -> None:
    _ensure_parent(pid_file)
    pid_file.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _remove_state(pid_file: Path) -> None:
    try:
        pid_file.unlink()
    except FileNotFoundError:
        return


def _is_process_running(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _wait_for_server_ready(host: str, port: int, timeout: float) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.2)
    return False


def _build_uvicorn_command(host: str, port: int, reload: bool, log_level: str, app_target: str) -> list[str]:
    command = [
        sys.executable,
        "-m",
        "uvicorn",
        app_target,
        "--host",
        host,
        "--port",
        str(port),
        "--log-level",
        log_level,
    ]
    if reload:
        command.append("--reload")
    return command


def _stop_pid(pid: int, timeout: float) -> bool:
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        return True
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not _is_process_running(pid):
            return True
        time.sleep(0.2)
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        return True
    return not _is_process_running(pid)


@app.command()
def start(
    host: str = typer.Option("127.0.0.1", "--host", help="服务监听地址"),
    port: int = typer.Option(8000, "--port", "-p", help="服务端口"),
    reload: bool = typer.Option(False, "--reload", "-r", help="开启自动重载（开发模式）"),
    log_level: str = typer.Option("info", "--log-level", help="日志级别"),
    app_target: str = typer.Option("main:app", "--app", help="ASGI 应用导入路径"),
    ready_timeout: float = typer.Option(12.0, "--ready-timeout", help="就绪等待时长（秒）"),
    pid_file: str | None = typer.Option(None, "--pid-file", help="PID 状态文件路径"),
    log_file: str | None = typer.Option(None, "--log-file", help="服务日志文件路径"),
) -> None:
    pid_path = _resolve_path(pid_file, _default_pid_file())
    log_path = _resolve_path(log_file, _default_log_file())

    state = _read_state(pid_path)
    if state:
        pid = int(state.get("pid", 0))
        if _is_process_running(pid):
            existing_host = state.get("host", host)
            existing_port = state.get("port", port)
            console.print(f"[yellow]⚠[/yellow] dataclaw 已在运行: pid={pid}, url=http://{existing_host}:{existing_port}")
            raise typer.Exit(1)
        _remove_state(pid_path)
        console.print("[yellow]⚠[/yellow] 检测到过期状态文件，已自动清理")

    _ensure_parent(log_path)
    command = _build_uvicorn_command(host, port, reload, log_level, app_target)
    log_handle = log_path.open("a", encoding="utf-8")
    process = subprocess.Popen(
        command,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    log_handle.close()

    service_state = {
        "pid": process.pid,
        "host": host,
        "port": port,
        "app": app_target,
        "log_file": str(log_path),
        "started_at": int(time.time()),
    }
    _write_state(pid_path, service_state)

    ready = _wait_for_server_ready(host, port, ready_timeout)
    if ready:
        console.print(f"[green]✓[/green] dataclaw 已启动: pid={process.pid}")
        console.print(f"[green]✓[/green] WebUI 地址: http://{host}:{port}")
        console.print(f"[green]✓[/green] 日志文件: {log_path}")
        return

    code = process.poll()
    if code is not None:
        _remove_state(pid_path)
        console.print(f"[red]✗[/red] dataclaw 启动失败，进程已退出 (code={code})")
        console.print(f"[yellow]日志文件[/yellow]: {log_path}")
        raise typer.Exit(1)

    console.print(f"[yellow]⚠[/yellow] 服务已拉起但未在 {ready_timeout:.1f}s 内确认就绪")
    console.print(f"[yellow]请检查日志[/yellow]: {log_path}")


@app.command()
def status(
    pid_file: str | None = typer.Option(None, "--pid-file", help="PID 状态文件路径"),
) -> None:
    pid_path = _resolve_path(pid_file, _default_pid_file())
    state = _read_state(pid_path)
    if not state:
        console.print("[yellow]●[/yellow] dataclaw 状态: stopped")
        return

    pid = int(state.get("pid", 0))
    if _is_process_running(pid):
        host = state.get("host", "127.0.0.1")
        port = state.get("port", 8000)
        console.print("[green]●[/green] dataclaw 状态: running")
        console.print(f"[green]pid[/green]: {pid}")
        console.print(f"[green]url[/green]: http://{host}:{port}")
        return

    _remove_state(pid_path)
    console.print("[yellow]●[/yellow] dataclaw 状态: stopped (已清理过期状态文件)")


@app.command()
def stop(
    timeout: float = typer.Option(8.0, "--timeout", help="停止等待时长（秒）"),
    pid_file: str | None = typer.Option(None, "--pid-file", help="PID 状态文件路径"),
) -> None:
    pid_path = _resolve_path(pid_file, _default_pid_file())
    state = _read_state(pid_path)
    if not state:
        console.print("[yellow]⚠[/yellow] dataclaw 未运行")
        return

    pid = int(state.get("pid", 0))
    if not _is_process_running(pid):
        _remove_state(pid_path)
        console.print("[yellow]⚠[/yellow] dataclaw 进程不存在，已清理状态文件")
        return

    stopped = _stop_pid(pid, timeout)
    if stopped:
        _remove_state(pid_path)
        console.print(f"[green]✓[/green] dataclaw 已停止: pid={pid}")
        return

    console.print(f"[red]✗[/red] dataclaw 停止失败: pid={pid}")
    raise typer.Exit(1)
