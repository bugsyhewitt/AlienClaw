"""An uninspectable path component fails closed (regression, fixed 2026-11-26).

``assert_no_symlink`` calls ``Path.is_symlink()`` on the target and on every
ancestor. On Python 3.12 ``is_symlink()`` swallows only ENOENT, ENOTDIR, EBADF and
ELOOP from ``lstat``; a PermissionError (EACCES under a directory the caller
cannot search, such as ``/root``) propagated, so a caller that catches only
ValueError crashed on ``/root/.ssh/id_rsa``. Any OSError from inspecting a
component is now ValueError("Path not inspectable on <operation>: ...").

Python 3.13+ returns False instead of raising, so the 3.12 behavior is simulated
by patching ``Path.is_symlink``. Adapted from the reference suite's
test/tools/test_boundary_uninspectable_path.py (guard level only).
"""
from __future__ import annotations

import errno
from pathlib import Path

import pytest

from agent_tool_sandbox import assert_no_symlink

_REAL_IS_SYMLINK = Path.is_symlink


def _unsearchable(monkeypatch: pytest.MonkeyPatch, directory: Path) -> None:
    """is_symlink() raises for every path below `directory`, as on Python 3.12."""

    def is_symlink(self: Path) -> bool:
        if directory in self.parents:
            raise PermissionError(errno.EACCES, "Permission denied", str(self))
        return _REAL_IS_SYMLINK(self)

    monkeypatch.setattr(Path, "is_symlink", is_symlink)


@pytest.mark.parametrize("operation", ["read", "write"])
def test_unsearchable_absolute_path_is_a_value_error(
    monkeypatch: pytest.MonkeyPatch, operation: str
) -> None:
    _unsearchable(monkeypatch, Path("/root"))
    with pytest.raises(ValueError) as info:
        assert_no_symlink(Path("/root/.ssh/id_rsa"), operation=operation)
    assert str(info.value) == (
        f'Path not inspectable on {operation}: "/root/.ssh/id_rsa" (Permission denied)'
    )
    assert isinstance(info.value.__cause__, PermissionError)


def test_default_operation_is_write(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "locked").mkdir()
    _unsearchable(monkeypatch, tmp_path / "locked")
    with pytest.raises(ValueError, match=r'^Path not inspectable on write: ".*locked/f\.txt"'):
        assert_no_symlink(tmp_path / "locked" / "f.txt")


@pytest.mark.parametrize(
    "exc",
    [
        PermissionError(errno.EPERM, "Operation not permitted"),
        OSError(errno.EIO, "Input/output error"),
        OSError("no errno at all"),
    ],
    ids=["EPERM", "EIO", "bare"],
)
def test_any_oserror_on_an_ancestor_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, exc: OSError
) -> None:
    ancestor = tmp_path / "a"

    def is_symlink(self: Path) -> bool:
        if self == ancestor:
            raise exc
        return _REAL_IS_SYMLINK(self)

    monkeypatch.setattr(Path, "is_symlink", is_symlink)
    with pytest.raises(ValueError, match=r"^Path not inspectable on read: "):
        assert_no_symlink(ancestor / "b" / "c.txt", operation="read")


def test_symlink_ancestor_still_reported_as_symlink(tmp_path: Path) -> None:
    (tmp_path / "real").mkdir()
    (tmp_path / "alias").symlink_to(tmp_path / "real")
    with pytest.raises(ValueError, match=r"^Symlink in path rejected on read: "):
        assert_no_symlink(tmp_path / "alias" / "f.txt", operation="read")
