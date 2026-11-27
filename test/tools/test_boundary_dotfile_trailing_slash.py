"""Regression (2026-11-26): the dotfile rule must not be bypassable with a trailing slash.

The rule looked at ``os.path.basename(path_str)``, which is ``''`` for ``.env/``, so
``.env/`` resolved to ``<root>/.env`` and was accepted: file_read returned the file
and file_write overwrote it. The final component that actually names something is
now checked (empty and ``.`` components skipped), and the same rule is applied to
the resolved path, so a symlink whose target is a dotfile is rejected as well.

Dot-directories stay allowed (``.git/config``): the rule has only ever covered the
final component (the docstring, the error text "filenames starting with '.'", and
the TS twin ``assertInsideBoundary`` in msb/tool-adapters.ts, whose Node
``path.basename`` already strips trailing slashes).

All fixtures live in tmp_path; the conftest pins both boundaries to it.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from alienclaw.tools._boundary import assert_inside_boundary
from alienclaw.tools.file_read import run as file_read_run
from alienclaw.tools.file_write import run as file_write_run

FIXTURE = "FIXTURE_ONLY=not-a-real-secret\n"

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
    (tmp_path / ".env").write_text(FIXTURE)
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / ".secret").write_text(FIXTURE)
    return tmp_path


@pytest.mark.parametrize("path_str", DOTFILE_SPELLINGS)
def test_boundary_rejects_dotfile_spelled_with_trailing_slash(ws: Path, path_str: str) -> None:
    with pytest.raises(ValueError, match="Dotfile rejected"):
        assert_inside_boundary(path_str, ws)


def test_boundary_rejects_absolute_dotfile_with_trailing_slash(ws: Path) -> None:
    with pytest.raises(ValueError, match="Dotfile rejected"):
        assert_inside_boundary(f"{ws}/.env/", ws)


@pytest.mark.parametrize("path_str", DOTFILE_SPELLINGS)
def test_file_read_does_not_return_dotfile(ws: Path, path_str: str) -> None:
    r = file_read_run({"path": path_str})
    assert r.ok is False, f"{path_str!r} was read: {r.output!r}"
    assert "Dotfile rejected" in (r.error or "")
    assert FIXTURE not in repr(r.output)


@pytest.mark.parametrize("path_str", DOTFILE_SPELLINGS)
def test_file_write_does_not_overwrite_dotfile(ws: Path, path_str: str) -> None:
    r = file_write_run({"path": path_str, "content": "OVERWRITTEN"})
    assert r.ok is False, f"{path_str!r} was written"
    assert "Dotfile rejected" in (r.error or "")
    assert (ws / ".env").read_text() == FIXTURE
    assert (ws / "sub" / ".secret").read_text() == FIXTURE


def test_boundary_rejects_symlink_whose_target_is_a_dotfile(ws: Path) -> None:
    (ws / "innocent.txt").symlink_to(ws / ".env")
    with pytest.raises(ValueError, match="Dotfile rejected"):
        assert_inside_boundary("innocent.txt", ws)


def test_boundary_rejects_symlink_whose_target_is_a_dot_directory(ws: Path) -> None:
    (ws / ".hidden").mkdir()
    (ws / "plain_dir").symlink_to(ws / ".hidden")
    with pytest.raises(ValueError, match="Dotfile rejected"):
        assert_inside_boundary("plain_dir/", ws)


# ── intent kept: only the final component is a dotfile rule ────────────────────

@pytest.mark.parametrize("path_str", [
    "data/out.txt", "sub/", "sub//", "a/./b.txt", "./plain.txt", ".git/config", "sub/.d/x.txt",
])
def test_non_dotfile_final_component_still_accepted(ws: Path, path_str: str) -> None:
    resolved = assert_inside_boundary(path_str, ws)
    assert str(resolved).startswith(str(ws.resolve()))


@pytest.mark.parametrize("path_str", [".", "a/.", "a/..", ".."])
def test_dot_and_dotdot_final_components_still_rejected(ws: Path, path_str: str) -> None:
    with pytest.raises(ValueError, match="Dotfile rejected"):
        assert_inside_boundary(path_str, ws)


def test_boundary_itself_still_accepted(ws: Path) -> None:
    assert assert_inside_boundary(str(ws), ws) == ws.resolve()
    assert assert_inside_boundary(f"{ws}/", ws) == ws.resolve()
