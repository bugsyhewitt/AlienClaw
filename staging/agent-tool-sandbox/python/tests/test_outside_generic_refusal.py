"""Paths outside the boundary get ONE generic refusal (regression, fixed 2026-11-26).

Without ``root=``, ``assert_no_symlink`` lstat()s every ancestor of an arbitrary absolute
path before the boundary check, so the error told an out-of-boundary caller whether a
component was a symlink ("Symlink in path rejected"), uninspectable ("Path not
inspectable ... (Permission denied)") or neither ("Path traversal rejected"). With
``root=<boundary>`` it probes only entries looked up in a directory that resolves at or
below the root; everything outside gets
'Path traversal rejected: "<path>" resolves outside workspace boundary'
from ``assert_inside_boundary``.

The only filesystem calls left outside the root are the non-strict os.path.realpath() of
the containment check (it resolves a symlinked prefix and never raises), which the spy
tests below allow explicitly. Adapted from the reference suite's
test/tools/test_boundary_outside_generic_refusal.py (guard level: ``_gate`` is the
documented call order). All fixtures live in tmp_path.
"""
from __future__ import annotations

import os
import posixpath
import sys
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest

from agent_tool_sandbox import assert_inside_boundary, assert_no_symlink

GENERIC = 'Path traversal rejected: "{}" resolves outside workspace boundary'


def _gate(path_str: str, root: Path, operation: str) -> Path:
    assert_no_symlink(root / path_str, operation=operation, root=root)
    return assert_inside_boundary(path_str, root)


def _error(path_str: str, root: Path, operation: str) -> str:
    with pytest.raises(ValueError) as info:
        _gate(path_str, root, operation)
    return str(info.value)


@pytest.fixture
def ws(tmp_path: Path) -> Iterator[Path]:
    root = tmp_path / "ws"
    root.mkdir()
    (root / "inside.txt").write_text("inside\n")
    (tmp_path / "outside").mkdir()
    (tmp_path / "outside" / "secret.txt").write_text("OUTSIDE_FIXTURE\n")
    (tmp_path / "locked").mkdir()
    (tmp_path / "locked" / "secret.txt").write_text("OUTSIDE_FIXTURE\n")
    (tmp_path / "olink").symlink_to(tmp_path / "outside")
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
@pytest.mark.parametrize("operation", ["read", "write"])
def test_outside_path_gets_generic_refusal(
    ws: Path, tmp_path: Path, kind: str, operation: str
) -> None:
    path = _outside_paths(tmp_path)[kind]
    assert _error(path, ws, operation) == GENERIC.format(path)


def test_all_outside_errors_are_the_same_text(ws: Path, tmp_path: Path) -> None:
    texts = set()
    for path in _outside_paths(tmp_path).values():
        for operation in ("read", "write"):
            texts.add(_error(path, ws, operation).replace(path, "<path>"))
    assert texts == {GENERIC.format("<path>")}


def test_without_root_the_walk_still_discloses(ws: Path, tmp_path: Path) -> None:
    """root=None keeps the original walk: the symlink outside is named (back-compat pin)."""
    path = _outside_paths(tmp_path)["symlinked-dir"]
    with pytest.raises(ValueError, match=r"^Symlink in path rejected on read: "):
        assert_no_symlink(ws / path, operation="read")


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
        frame = frame.f_back  # type: ignore[assignment]
    return False


def _at_or_below(path: str, root: str) -> bool:
    return path == root or path.startswith(root + os.sep)


@pytest.fixture
def probes(monkeypatch: pytest.MonkeyPatch) -> Callable[[], list[str]]:
    """Record every os.lstat / Path.is_symlink not issued by os.path.realpath()."""
    seen: list[str] = []
    real_lstat, real_is_symlink = os.lstat, Path.is_symlink

    def lstat(path: Any, *args: Any, **kwargs: Any) -> os.stat_result:
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
@pytest.mark.parametrize("operation", ["read", "write"])
def test_no_lstat_outside_root_for_out_of_boundary_path(
    ws: Path, tmp_path: Path, probes: Callable[[], list[str]], kind: str, operation: str
) -> None:
    path = _outside_paths(tmp_path)[kind]
    seen = probes()
    with pytest.raises(ValueError):
        _gate(path, ws, operation)
    assert seen == [], f"probed outside the root: {seen}"


@pytest.mark.skipif(os.name != "posix", reason="spies on posixpath.realpath")
def test_symlinked_prefix_is_not_probed(
    tmp_path: Path, probes: Callable[[], list[str]]
) -> None:
    (tmp_path / "real" / "ws").mkdir(parents=True)
    (tmp_path / "real" / "ws" / "notes.txt").write_text("n\n")
    (tmp_path / "link").symlink_to(tmp_path / "real")
    root = os.path.realpath(tmp_path / "link" / "ws")
    seen = probes()
    target = _gate(str(tmp_path / "link" / "ws" / "notes.txt"), Path(root), "read")
    assert str(target) == os.path.join(root, "notes.txt")
    assert seen, "the in-root entry itself must still be checked"
    for p in seen:
        assert _at_or_below(os.path.realpath(os.path.dirname(p)), root), f"probed {p}"
