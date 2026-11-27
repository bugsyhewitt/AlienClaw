"""Regression (2026-11-26): file_read runs the same symlink guard as file_write.

file_write calls ``assert_no_symlink`` on the UNRESOLVED path before the boundary
check; file_read did not, so a symlink inside the workspace was followed (for
example to a dotfile, which the boundary's dotfile rule never saw). file_read now
calls the guard in the same order, and opens with ``O_NOFOLLOW`` where the
platform has it, so a final-component symlink swapped in after the checks is not
followed either.

All fixtures live in tmp_path; the conftest pins both boundaries to it.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

import alienclaw.tools.file_read as file_read
from alienclaw.tools.file_read import run as file_read_run


def _read(path_str: str):
    return file_read_run({"path": path_str})


def test_file_read_rejects_symlinked_file_inside_boundary(tmp_path: Path) -> None:
    (tmp_path / "real.txt").write_text("real\n")
    (tmp_path / "alias.txt").symlink_to(tmp_path / "real.txt")
    r = _read("alias.txt")
    assert r.ok is False
    assert "Symlink rejected on read" in (r.error or "")


def test_file_read_rejects_symlinked_ancestor_dir(tmp_path: Path) -> None:
    (tmp_path / "real_dir").mkdir()
    (tmp_path / "real_dir" / "f.txt").write_text("x\n")
    (tmp_path / "dir_alias").symlink_to(tmp_path / "real_dir")
    r = _read("dir_alias/f.txt")
    assert r.ok is False
    assert "Symlink in path rejected on read" in (r.error or "")


def test_file_read_rejects_symlink_to_dotfile(tmp_path: Path) -> None:
    (tmp_path / ".env").write_text("FIXTURE_ONLY=1\n")
    (tmp_path / "dotlink").symlink_to(tmp_path / ".env")
    r = _read("dotlink")
    assert r.ok is False
    assert "FIXTURE_ONLY" not in repr(r.output)


def test_file_read_rejects_dangling_symlink(tmp_path: Path) -> None:
    (tmp_path / "dangling").symlink_to(tmp_path / "nope.txt")
    r = _read("dangling")
    assert r.ok is False
    assert "Symlink rejected on read" in (r.error or "")


def test_symlink_guard_runs_before_boundary_check_like_file_write(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ws = tmp_path / "ws"
    ws.mkdir()
    (tmp_path / "outside.txt").write_text("outside\n")
    (ws / "escape").symlink_to(tmp_path / "outside.txt")
    monkeypatch.setenv("ALIENCLAW_FILE_WORKSPACE_ROOT", str(ws))
    r = _read("escape")
    assert r.ok is False
    assert "Symlink rejected on read" in (r.error or "")


def test_file_read_regular_file_still_reads(tmp_path: Path) -> None:
    (tmp_path / "plain.txt").write_text("a\r\nb\n")
    r = _read("plain.txt")
    assert r.ok is True
    assert r.output["content"] == "a\nb\n"  # same universal-newline decoding as read_text()


@pytest.mark.skipif(not hasattr(os, "O_NOFOLLOW"), reason="platform has no O_NOFOLLOW")
def test_file_read_does_not_follow_symlink_swapped_in_after_checks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ws = tmp_path / "ws"
    ws.mkdir()
    monkeypatch.setenv("ALIENCLAW_FILE_WORKSPACE_ROOT", str(ws))
    outside = tmp_path / "outside-secret.txt"
    outside.write_text("OUTSIDE_FIXTURE\n")
    (ws / "f.txt").write_text("inside\n")
    real_check = file_read.assert_inside_boundary

    def check_then_swap(path_str, boundary):
        resolved = real_check(path_str, boundary)
        resolved.unlink()
        resolved.symlink_to(outside)  # the race: swapped after every check passed
        return resolved

    monkeypatch.setattr(file_read, "assert_inside_boundary", check_then_swap)
    r = _read("f.txt")
    assert r.ok is False, f"swapped-in symlink was followed: {r.output!r}"
    assert "OUTSIDE_FIXTURE" not in repr(r.output)
    assert "Read error" in (r.error or "")
