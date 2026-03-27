from pathlib import Path

from app.core import data_root


def test_data_root_prefers_env(monkeypatch, tmp_path: Path) -> None:
    custom = tmp_path / "custom-data-root"
    monkeypatch.setenv("DATA_ROOT", str(custom))
    assert data_root.get_data_root() == custom.resolve()


def test_data_root_falls_back_to_legacy(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.delenv("DATA_ROOT", raising=False)
    legacy = tmp_path / "legacy-data"
    default = tmp_path / "default-data"
    legacy.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(data_root, "LEGACY_DATA_ROOT", legacy)
    monkeypatch.setattr(data_root, "DEFAULT_DATA_ROOT", default)
    assert data_root.get_data_root() == legacy


def test_ensure_data_layout_creates_children(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("DATA_ROOT", str(tmp_path / "dr"))
    data_root.ensure_data_layout()
    root = data_root.get_data_root()
    assert (root / "workspace").exists()
    assert (root / "uploads").exists()
    assert (root / "data").exists()
