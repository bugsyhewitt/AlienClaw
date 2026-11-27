"""Write-path jail tests, ported from the reference file_write suite (guard level only).

The reference file_write tool gates every write with, in this order:

    assert_no_symlink(write_root / path_str)   # UNRESOLVED path
    path = assert_inside_boundary(path_str, write_root)

These tests drive that gate directly; the tool's own behaviour (atomic write,
output contract, repeat counts) is out of scope for this package. The
"mkdir must not escape" assertions hold because the gate raises before any
directory could be created.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from agent_tool_sandbox import assert_inside_boundary, assert_no_symlink


def write_gate(path_str: str, write_root: Path) -> Path:
    assert_no_symlink(write_root / path_str)
    return assert_inside_boundary(path_str, write_root)


class TestWorkspaceBoundary:
    """The write gate must reject paths outside the write root."""

    def test_rejects_absolute_path_outside_workspace(self, tmp_path: Path) -> None:
        # /nonexistent/attack.txt is never under tmp_path
        with pytest.raises(ValueError, match="(?i)traversal"):
            write_gate("/nonexistent/pkt576-attack.txt", tmp_path)

    def test_rejects_traversal_with_dotdot(self, tmp_path: Path) -> None:
        # tmp_path/../escape.txt resolves to tmp_path.parent/escape.txt — outside
        with pytest.raises(ValueError, match="(?i)traversal"):
            write_gate(str(tmp_path / ".." / "pkt576-escape.txt"), tmp_path)

    def test_allows_path_inside_workspace(self, tmp_path: Path) -> None:
        p = tmp_path / "safe.txt"
        assert write_gate(str(p), tmp_path) == p.resolve()

    def test_allows_nested_paths_inside_workspace(self, tmp_path: Path) -> None:
        p = tmp_path / "a" / "b" / "out.txt"
        assert write_gate(str(p), tmp_path) == p.resolve()

    def test_outside_path_is_rejected_before_any_mkdir(self, tmp_path: Path) -> None:
        outside_dir = tmp_path.parent / f"{tmp_path.name}-attacker-dir"
        with pytest.raises(ValueError, match="(?i)traversal"):
            write_gate(str(outside_dir / "file.txt"), tmp_path)
        assert not outside_dir.exists()

    def test_rejects_prefix_sibling_path(self, tmp_path: Path) -> None:
        # Sibling directory sharing the workspace prefix must be rejected.
        # e.g. workspace=/tmp/ws → /tmp/ws-evil/x must NOT pass the startsWith check.
        sibling_dir = tmp_path.parent / (tmp_path.name + "-evil")
        with pytest.raises(ValueError, match="(?i)traversal"):
            write_gate(str(sibling_dir / "escape.txt"), tmp_path)
        assert not sibling_dir.exists(), "sibling dir must not be created"


class TestSymlinkGateOnWrite:
    """The symlink half of the write gate (inspects the unresolved path)."""

    def test_rejects_symlinked_target_even_inside_boundary(self, tmp_path: Path) -> None:
        real = tmp_path / "real.txt"
        real.write_text("x")
        (tmp_path / "alias.txt").symlink_to(real)
        with pytest.raises(ValueError, match="Symlink rejected on write"):
            write_gate("alias.txt", tmp_path)

    def test_rejects_symlinked_parent_dir(self, tmp_path: Path) -> None:
        (tmp_path / "real_dir").mkdir()
        (tmp_path / "dir_alias").symlink_to(tmp_path / "real_dir")
        with pytest.raises(ValueError, match="Symlink in path rejected on write"):
            write_gate("dir_alias/out.txt", tmp_path)

    def test_rejects_symlink_escape_before_boundary_check(self, tmp_path: Path) -> None:
        root = tmp_path / "root"
        root.mkdir()
        (root / "out").symlink_to(tmp_path)
        with pytest.raises(ValueError, match="Symlink"):
            write_gate("out/escape.txt", root)
