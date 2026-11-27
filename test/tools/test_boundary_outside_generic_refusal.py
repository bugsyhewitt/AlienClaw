"""Regression (2026-11-26 review, finding 2): paths outside the root get ONE generic refusal.

The symlink guard lstat()ed every ancestor of an arbitrary absolute path before the
boundary check, so the error told an out-of-boundary caller whether a component was a
symlink ("Symlink in path rejected"), uninspectable ("Path not inspectable ...
(Permission denied)") or neither ("Path traversal rejected"). It now probes only entries
looked up in a directory that resolves at or below the root; everything outside gets
'Path traversal rejected: "<path>" resolves outside workspace boundary'.

The only filesystem calls left outside the root are the non-strict os.path.realpath()
of the containment check (it resolves a symlinked prefix and never raises), which the
spy tests below allow explicitly. All fixtures live in tmp_path.
"""
from __future__ import annotations

import os
import posixpath
import sys
from pathlib import Path

import pytest

from alienclaw.tools.file_read import run as file_read_run
from alienclaw.tools.file_write import run as file_write_run

GENERIC = 'Path traversal rejected: "{}" resolves outside workspace boundary'


@pytest.fixture
def ws(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "ws"
    root.mkdir()
    (root / "inside.txt").write_text("inside\n")
    (tmp_path / "outside").mkdir()
    (tmp_path / "outside" / "secret.txt").write_text("OUTSIDE_FIXTURE\n")
    (tmp_path / "locked").mkdir()
    (tmp_path / "locked" / "secret.txt").write_text("OUTSIDE_FIXTURE\n")
    (tmp_path / "olink").symlink_to(tmp_path / "outside")
    monkeypatch.setenv("ALIENCLAW_FILE_WORKSPACE_ROOT", str(root))
    monkeypatch.setenv("ALIENCLAW_FILE_WRITE_WORKSPACE", str(root))
    (tmp_path / "locked").chmod(0o000)
    try:
        yield root
    finally:
        (tmp_path / "locked").chmod(0o700)


def _outside_paths(tmp_path: Path) -> dict[str, str]:
    return {
        "existing": str(tmp_path / "outside" / "secret.txt"),
        "unreadable-parent": str(tmp_path / "locked" / "secret.txt"),
        "nonexistent": str(tmp_path / "nope" / "missing.txt"),
        "symlinked-dir": str(tmp_path / "olink" / "secret.txt"),
        "symlink-itself": str(tmp_path / "olink"),
    }


KINDS = ["existing", "unreadable-parent", "nonexistent", "symlinked-dir", "symlink-itself"]


@pytest.mark.parametrize("kind", KINDS)
def test_outside_read_gets_generic_refusal(ws: Path, tmp_path: Path, kind: str) -> None:
    path = _outside_paths(tmp_path)[kind]
    r = file_read_run({"path": path})
    assert r.ok is False and r.correctness == 0.0
    assert r.error == GENERIC.format(path)
    assert "OUTSIDE_FIXTURE" not in repr(r.output)


@pytest.mark.parametrize("kind", KINDS)
def test_outside_write_gets_generic_refusal(ws: Path, tmp_path: Path, kind: str) -> None:
    path = _outside_paths(tmp_path)[kind]
    r = file_write_run({"path": path, "content": "OVERWRITTEN"})
    assert r.ok is False and r.correctness == 0.0
    assert r.error == GENERIC.format(path)
    assert (tmp_path / "outside" / "secret.txt").read_text() == "OUTSIDE_FIXTURE\n"
    assert not (tmp_path / "nope").exists()


def test_all_outside_errors_are_the_same_text(ws: Path, tmp_path: Path) -> None:
    texts = set()
    for path in _outside_paths(tmp_path).values():
        for r in (file_read_run({"path": path}), file_write_run({"path": path, "content": "x"})):
            texts.add((r.error or "").replace(path, "<path>"))
    assert texts == {GENERIC.format("<path>")}


# ── no probing outside the root ───────────────────────────────────────────────

# Code objects, not file names: posixpath is a frozen module on 3.14 ("<frozen posixpath>").
_REALPATH_CODE = {
    f.__code__
    for f in (posixpath.realpath, getattr(posixpath, "_joinrealpath", None))  # 3.12 helper
    if f is not None
}


def _from_realpath() -> bool:
    frame = sys._getframe(1)
    while frame is not None:
        if frame.f_code in _REALPATH_CODE:
            return True
        frame = frame.f_back
    return False


def _at_or_below(path: str, root: str) -> bool:
    return path == root or path.startswith(root + os.sep)


@pytest.fixture
def probes(monkeypatch: pytest.MonkeyPatch):
    """Record every os.lstat / Path.is_symlink not issued by os.path.realpath()."""
    seen: list[str] = []
    real_lstat, real_is_symlink = os.lstat, Path.is_symlink

    def lstat(path, *args, **kwargs):
        if not _from_realpath():
            seen.append(os.fspath(path))
        return real_lstat(path, *args, **kwargs)

    def is_symlink(self: Path) -> bool:
        seen.append(str(self))
        return real_is_symlink(self)

    def start() -> list[str]:
        monkeypatch.setattr(os, "lstat", lstat)
        monkeypatch.setattr(Path, "is_symlink", is_symlink)
        return seen

    return start


@pytest.mark.skipif(os.name != "posix", reason="spies on posixpath.realpath")
@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("tool", ["read", "write"])
def test_no_lstat_outside_root_for_out_of_boundary_path(
    ws: Path, tmp_path: Path, probes, kind: str, tool: str
) -> None:
    path = _outside_paths(tmp_path)[kind]
    seen = probes()
    if tool == "read":
        r = file_read_run({"path": path})
    else:
        r = file_write_run({"path": path, "content": "x"})
    assert r.ok is False
    assert seen == [], f"probed outside the root: {seen}"


@pytest.mark.skipif(os.name != "posix", reason="spies on posixpath.realpath")
def test_symlinked_prefix_is_not_probed(tmp_path: Path, monkeypatch, probes) -> None:
    (tmp_path / "real" / "ws").mkdir(parents=True)
    (tmp_path / "real" / "ws" / "notes.txt").write_text("n\n")
    (tmp_path / "link").symlink_to(tmp_path / "real")
    root = os.path.realpath(tmp_path / "link" / "ws")
    monkeypatch.setenv("ALIENCLAW_FILE_WORKSPACE_ROOT", root)
    seen = probes()
    r = file_read_run({"path": str(tmp_path / "link" / "ws" / "notes.txt")})
    assert r.ok is True, r.error
    assert seen, "the in-root entry itself must still be checked"
    for p in seen:
        assert _at_or_below(os.path.realpath(os.path.dirname(p)), root), f"probed {p}"
