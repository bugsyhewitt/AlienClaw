"""Regression (2026-11-26 review, finding 1): a symlink ABOVE the workspace root is not refused.

file_read (since tonight) and file_write (before that) called ``assert_no_symlink`` on the
unresolved path, and it walked every ancestor up to ``/``. So a path spelled through a
symlinked prefix was refused although realpath + ``assert_inside_boundary`` put it inside
the root: macOS ``/tmp`` -> ``/private/tmp``, a symlinked home directory, an unresolved
ALIENCLAW_HOME. The no-symlink rule now covers only the entries looked up in a directory
that resolves at or below the root, so the prefix is never checked and in-workspace
symlinks are still refused.

Layout: ``tmp/real/ws`` is the workspace, ``tmp/link -> tmp/real``, ``tmp/wslink -> tmp/real/ws``.
All fixtures live in tmp_path.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from alienclaw.tools.file_read import run as file_read_run
from alienclaw.tools.file_write import run as file_write_run

TEXT = "inside the workspace\n"


@pytest.fixture
def layout(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    ws = tmp_path / "real" / "ws"
    ws.mkdir(parents=True)
    (ws / "notes.txt").write_text(TEXT)
    (tmp_path / "link").symlink_to(tmp_path / "real")
    (tmp_path / "wslink").symlink_to(ws)
    root = Path(os.path.realpath(tmp_path / "link" / "ws"))
    assert root == ws.resolve()
    monkeypatch.setenv("ALIENCLAW_FILE_WORKSPACE_ROOT", str(root))
    monkeypatch.setenv("ALIENCLAW_FILE_WRITE_WORKSPACE", str(root))
    return {"tmp": tmp_path, "ws": ws, "root": root}


def _via_prefix(layout: dict[str, Path], name: str, form: str) -> str:
    tmp = layout["tmp"]
    return {
        "abs-link": str(tmp / "link" / "ws" / name),  # symlinked ancestor of the root
        "abs-wslink": str(tmp / "wslink" / name),  # the root's own entry is a symlink
        "rel-link": f"../../link/ws/{name}",  # relative, leaves and re-enters via the link
    }[form]


FORMS = ["abs-link", "abs-wslink", "rel-link"]


# ── finding 1: symlinked prefix is accepted ───────────────────────────────────

@pytest.mark.parametrize("form", FORMS)
def test_read_through_symlinked_prefix_succeeds(layout: dict[str, Path], form: str) -> None:
    r = file_read_run({"path": _via_prefix(layout, "notes.txt", form)})
    assert r.ok is True, r.error
    assert r.output["content"] == TEXT
    assert r.output["path"] == str(layout["root"] / "notes.txt")


@pytest.mark.parametrize("form", FORMS)
def test_write_through_symlinked_prefix_succeeds(layout: dict[str, Path], form: str) -> None:
    r = file_write_run({"path": _via_prefix(layout, "out.txt", form), "content": "hi"})
    assert r.ok is True, r.error
    assert (layout["ws"] / "out.txt").read_text() == "hi\n"
    assert (layout["tmp"] / "link").is_symlink()  # the prefix link itself is untouched


@pytest.mark.parametrize("env_form", ["link", "wslink"])
def test_unresolved_root_env_with_prefix_path(
    layout: dict[str, Path], monkeypatch: pytest.MonkeyPatch, env_form: str
) -> None:
    """The root env var itself spelled through a symlink (an unresolved deploy path)."""
    tmp = layout["tmp"]
    unresolved = tmp / "link" / "ws" if env_form == "link" else tmp / "wslink"
    monkeypatch.setenv("ALIENCLAW_FILE_WORKSPACE_ROOT", str(unresolved))
    monkeypatch.setenv("ALIENCLAW_FILE_WRITE_WORKSPACE", str(unresolved))
    read = file_read_run({"path": str(unresolved / "notes.txt")})
    write = file_write_run({"path": str(unresolved / "w.txt"), "content": "w"})
    assert read.ok is True, read.error
    assert write.ok is True, write.error
    assert (layout["ws"] / "w.txt").read_text() == "w\n"


def test_unresolved_alienclaw_home(
    layout: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    """ALIENCLAW_HOME behind a symlink (e.g. a symlinked home directory)."""
    tmp = layout["tmp"]
    (tmp / "real" / "workspace" / "output").mkdir(parents=True)
    (tmp / "real" / "workspace" / "goals.txt").write_text(TEXT)
    monkeypatch.delenv("ALIENCLAW_FILE_WORKSPACE_ROOT")
    monkeypatch.delenv("ALIENCLAW_FILE_WRITE_WORKSPACE")
    monkeypatch.setenv("ALIENCLAW_HOME", str(tmp / "link"))
    read = file_read_run({"path": str(tmp / "link" / "workspace" / "goals.txt")})
    write = file_write_run(
        {"path": str(tmp / "link" / "workspace" / "output" / "o.txt"), "content": "o"}
    )
    assert read.ok is True, read.error
    assert write.ok is True, write.error
    assert (tmp / "real" / "workspace" / "output" / "o.txt").read_text() == "o\n"


# ── policy kept: symlinks at or below the root are still refused ──────────────

@pytest.fixture
def in_ws_links(layout: dict[str, Path]) -> dict[str, Path]:
    ws = layout["ws"]
    (ws / "sub").mkdir()
    (ws / "sub" / "f.txt").write_text(TEXT)
    (ws / "alias.txt").symlink_to(ws / "notes.txt")  # file symlink
    (ws / "sub_alias").symlink_to(ws / "sub")  # directory symlink
    (ws / "self").symlink_to(ws)  # resolves to the root itself
    (ws / "up").symlink_to(ws.parent)  # resolves to an ancestor of the root
    return layout


CASES = [
    ("alias.txt", "Symlink rejected"),
    ("sub_alias/f.txt", "Symlink in path rejected"),
    ("self/notes.txt", "Symlink in path rejected"),
    ("up/ws/notes.txt", "Symlink in path rejected"),
]


@pytest.mark.parametrize("prefixed", [False, True], ids=["relative", "via-link-prefix"])
@pytest.mark.parametrize(("rel", "message"), CASES)
def test_in_workspace_symlink_still_refused(
    in_ws_links: dict[str, Path], rel: str, message: str, prefixed: bool
) -> None:
    tmp = in_ws_links["tmp"]
    path = str(tmp / "link" / "ws" / rel) if prefixed else rel
    read = file_read_run({"path": path})
    write = file_write_run({"path": path, "content": "OVERWRITTEN"})
    assert read.ok is False and read.error.startswith(f"{message} on read: "), read.error
    assert write.ok is False and write.error.startswith(f"{message} on write: "), write.error
    assert TEXT not in repr(read.output)
    assert (in_ws_links["ws"] / "notes.txt").read_text() == TEXT
    assert (in_ws_links["ws"] / "sub" / "f.txt").read_text() == TEXT
