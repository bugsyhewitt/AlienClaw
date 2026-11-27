"""Dotfile rule and read-path symlink gate (regressions, fixed 2026-11-26).

1. The dotfile rule looked at ``os.path.basename(path_str)``, which is ``''`` for
   ``.env/``, so ``.env/`` resolved to ``<root>/.env`` and was accepted for reads
   and writes. The final component that names something is now checked (empty and
   ``.`` components skipped), and so is the final component of the resolved path
   (a symlink whose target is a dotfile). Dot-directories stay allowed.
2. The reference read tool skipped ``assert_no_symlink``; it now gates reads the
   same way writes are gated. ``operation=`` only changes the message wording.

Adapted from the reference suite's test/tools/test_boundary_dotfile_trailing_slash.py
and test/tools/test_file_read_symlink_guard.py (guard level only).
"""
from __future__ import annotations

from pathlib import Path

import pytest

from agent_tool_sandbox import assert_inside_boundary, assert_no_symlink

DOTFILE_SPELLINGS = [
    ".env/",
    ".env//",
    ".env/./",
    "./.env/",
    "a/../.env/",
    "sub/.secret/",
    "sub/.secret//",
    "./sub/./.secret/./",
]


@pytest.fixture
def ws(tmp_path: Path) -> Path:
    root = tmp_path / "ws"
    (root / "sub").mkdir(parents=True)
    (root / ".env").write_text("FIXTURE_ONLY=1\n")
    (root / "sub" / ".secret").write_text("FIXTURE_ONLY=1\n")
    return root


def read_gate(path_str: str, root: Path) -> Path:
    assert_no_symlink(root / path_str, operation="read")
    return assert_inside_boundary(path_str, root)


@pytest.mark.parametrize("path_str", DOTFILE_SPELLINGS)
def test_rejects_dotfile_spelled_with_trailing_slash(ws: Path, path_str: str) -> None:
    with pytest.raises(ValueError, match="Dotfile rejected"):
        assert_inside_boundary(path_str, ws)


def test_rejects_absolute_dotfile_with_trailing_slash(ws: Path) -> None:
    with pytest.raises(ValueError, match="Dotfile rejected"):
        assert_inside_boundary(f"{ws}/.env/", ws)


def test_rejects_symlink_whose_target_is_a_dotfile(ws: Path) -> None:
    (ws / "innocent.txt").symlink_to(ws / ".env")
    with pytest.raises(ValueError, match="Dotfile rejected"):
        assert_inside_boundary("innocent.txt", ws)


def test_rejects_symlink_whose_target_is_a_dot_directory(ws: Path) -> None:
    (ws / ".hidden").mkdir()
    (ws / "plain_dir").symlink_to(ws / ".hidden")
    with pytest.raises(ValueError, match="Dotfile rejected"):
        assert_inside_boundary("plain_dir/", ws)


@pytest.mark.parametrize("path_str", [
    "data/out.txt", "sub/", "sub//", "a/./b.txt", "./plain.txt", ".git/config", "sub/.d/x.txt",
])
def test_non_dotfile_final_component_still_accepted(ws: Path, path_str: str) -> None:
    assert str(assert_inside_boundary(path_str, ws)).startswith(str(ws.resolve()))


@pytest.mark.parametrize("path_str", [".", "a/.", "a/..", ".."])
def test_dot_and_dotdot_final_components_still_rejected(ws: Path, path_str: str) -> None:
    with pytest.raises(ValueError, match="Dotfile rejected"):
        assert_inside_boundary(path_str, ws)


def test_boundary_itself_still_accepted(ws: Path) -> None:
    assert assert_inside_boundary(str(ws), ws) == ws.resolve()
    assert assert_inside_boundary(f"{ws}/", ws) == ws.resolve()


# ── read gate ─────────────────────────────────────────────────────────────────

def test_read_gate_rejects_symlinked_file(ws: Path) -> None:
    (ws / "real.txt").write_text("x")
    (ws / "alias.txt").symlink_to(ws / "real.txt")
    with pytest.raises(ValueError, match="Symlink rejected on read"):
        read_gate("alias.txt", ws)


def test_read_gate_rejects_symlinked_ancestor(ws: Path) -> None:
    (ws / "dir_alias").symlink_to(ws / "sub")
    with pytest.raises(ValueError, match="Symlink in path rejected on read"):
        read_gate("dir_alias/f.txt", ws)


def test_read_gate_accepts_regular_file(ws: Path) -> None:
    (ws / "plain.txt").write_text("x")
    assert read_gate("plain.txt", ws) == ws.resolve() / "plain.txt"


def test_default_operation_keeps_write_wording(ws: Path) -> None:
    (ws / "alias.txt").symlink_to(ws / "sub")
    with pytest.raises(ValueError, match='^Symlink rejected on write: "'):
        assert_no_symlink(ws / "alias.txt")
