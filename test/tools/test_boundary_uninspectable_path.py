"""Regression (2026-11-26 review): an uninspectable path component fails closed.

``assert_no_symlink`` calls ``Path.is_symlink()`` on the target and on every
ancestor. On Python 3.12 (CI's version) ``is_symlink()`` swallows only ENOENT,
ENOTDIR, EBADF and ELOOP from ``lstat``; a PermissionError (EACCES on a
directory the bridge user cannot search, such as ``/root``) propagates. file_read
and file_write catch only ValueError, so ``{"path": "/root/.ssh/id_rsa"}`` raised
out of the tool instead of returning ``RunResult(ok=False)``.

Python 3.13+ returns False instead of raising, so the 3.12 behavior is simulated
by patching ``Path.is_symlink``: ``_unsearchable(d)`` makes it raise EACCES for
every path below directory ``d``, which is what lstat does when ``d`` lacks search
permission (and does not depend on the real permissions of the machine running
the test). The guard now turns any OSError from inspecting a component into
ValueError("Path not inspectable on <operation>: ...").
"""
from __future__ import annotations

import errno
from pathlib import Path

import pytest

from alienclaw.tools._boundary import assert_no_symlink
from alienclaw.tools.file_read import run as file_read_run
from alienclaw.tools.file_write import run as file_write_run

_REAL_IS_SYMLINK = Path.is_symlink


def _unsearchable(monkeypatch: pytest.MonkeyPatch, directory: Path) -> None:
    """is_symlink() raises for every path below `directory`, as on Python 3.12."""

    def is_symlink(self: Path) -> bool:
        if directory in self.parents:
            raise PermissionError(errno.EACCES, "Permission denied", str(self))
        return _REAL_IS_SYMLINK(self)

    monkeypatch.setattr(Path, "is_symlink", is_symlink)


# ── tool level: the reviewer's vector ─────────────────────────────────────────

def test_file_read_of_unsearchable_absolute_path_returns_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _unsearchable(monkeypatch, Path("/root"))
    r = file_read_run({"path": "/root/.ssh/id_rsa"})
    assert r.ok is False
    assert r.correctness == 0.0
    assert r.error == 'Path not inspectable on read: "/root/.ssh/id_rsa" (Permission denied)'


def test_file_write_of_unsearchable_absolute_path_returns_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _unsearchable(monkeypatch, Path("/root"))
    r = file_write_run({"path": "/root/.ssh/authorized_keys", "content": "x"})
    assert r.ok is False
    assert r.correctness == 0.0
    assert r.error == (
        'Path not inspectable on write: "/root/.ssh/authorized_keys" (Permission denied)'
    )


def test_unsearchable_dir_inside_workspace_fails_closed_for_both_tools(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "locked").mkdir()
    _unsearchable(monkeypatch, tmp_path / "locked")
    read = file_read_run({"path": "locked/f.txt"})
    write = file_write_run({"path": "locked/f.txt", "content": "x"})
    assert read.ok is False and "Path not inspectable on read" in (read.error or "")
    assert write.ok is False and "Path not inspectable on write" in (write.error or "")
    assert not (tmp_path / "locked" / "f.txt").exists()


# ── guard level ───────────────────────────────────────────────────────────────

def test_uninspectable_target_itself_is_a_value_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "f.txt"
    _unsearchable(monkeypatch, tmp_path)
    with pytest.raises(ValueError, match=r'^Path not inspectable on read: ".*f\.txt"') as info:
        assert_no_symlink(target, operation="read")
    assert isinstance(info.value.__cause__, PermissionError)


@pytest.mark.parametrize(
    "exc",
    [
        PermissionError(errno.EPERM, "Operation not permitted"),
        OSError(errno.EIO, "Input/output error"),
        OSError("no errno at all"),
    ],
    ids=["EPERM", "EIO", "bare"],
)
def test_any_oserror_while_inspecting_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, exc: OSError
) -> None:
    ancestor = tmp_path / "a"

    def is_symlink(self: Path) -> bool:
        if self == ancestor:
            raise exc
        return _REAL_IS_SYMLINK(self)

    monkeypatch.setattr(Path, "is_symlink", is_symlink)
    with pytest.raises(ValueError, match=r"^Path not inspectable on write: "):
        assert_no_symlink(ancestor / "b" / "c.txt")


def test_symlink_ancestor_still_reported_as_symlink(tmp_path: Path) -> None:
    """Unchanged behavior: an inspectable symlink keeps its specific message."""
    (tmp_path / "real").mkdir()
    (tmp_path / "alias").symlink_to(tmp_path / "real")
    with pytest.raises(ValueError, match=r"^Symlink in path rejected on read: "):
        assert_no_symlink(tmp_path / "alias" / "f.txt", operation="read")
