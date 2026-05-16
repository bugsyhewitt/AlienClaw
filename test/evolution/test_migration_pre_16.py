"""Tests for the pre-Packet-16 population directory migration."""
from __future__ import annotations

from pathlib import Path

from alienclaw.evolution.migrations.migrate_pre_packet_16 import migrate, TOOL_NAMES


def test_migration_renames_tool_dirs(tmp_path: Path) -> None:
    for tool in ["compute", "web_search", "file_read"]:
        (tmp_path / tool).mkdir()
    renamed = migrate(tmp_path)
    assert renamed == {
        "compute": "compute_alone",
        "file_read": "file_read_alone",
        "web_search": "web_search_alone",
    }
    assert (tmp_path / "compute_alone").exists()
    assert not (tmp_path / "compute").exists()
    assert (tmp_path / "web_search_alone").exists()
    assert not (tmp_path / "web_search").exists()


def test_migration_skips_already_migrated(tmp_path: Path) -> None:
    (tmp_path / "compute_alone").mkdir()
    renamed = migrate(tmp_path)
    assert "compute" not in renamed


def test_migration_idempotent(tmp_path: Path) -> None:
    (tmp_path / "compute").mkdir()
    rename1 = migrate(tmp_path)
    rename2 = migrate(tmp_path)
    assert "compute" in rename1
    assert "compute" not in rename2  # second run: already migrated


def test_migration_empty_dir(tmp_path: Path) -> None:
    assert migrate(tmp_path) == {}


def test_migration_nonexistent_root() -> None:
    assert migrate(Path("/nonexistent/path/that/should/not/exist/xyz")) == {}


def test_migration_only_renames_known_tools(tmp_path: Path) -> None:
    (tmp_path / "compute").mkdir()
    (tmp_path / "unknown_tool").mkdir()
    renamed = migrate(tmp_path)
    assert "unknown_tool" not in renamed
    assert (tmp_path / "unknown_tool").exists()  # untouched
    assert "compute" in renamed


def test_tool_names_set_size() -> None:
    assert len(TOOL_NAMES) == 8
