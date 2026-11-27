"""A symlink ABOVE the boundary root is not refused (regression, fixed 2026-11-26).

Without ``root=``, ``assert_no_symlink`` walks every ancestor up to ``/``, so a path spelled
through a symlinked prefix was refused although realpath + ``assert_inside_boundary`` put it
inside the root: macOS ``/tmp`` -> ``/private/tmp``, a symlinked home directory, an
unresolved deploy path. With ``root=<boundary>`` only the entries looked up in a directory
that resolves at or below the root are checked, so the prefix is accepted and symlinks
inside the boundary are still refused.

Adapted from the reference suite's test/tools/test_boundary_symlinked_prefix.py. This
package has no file tools, so ``_read`` / ``_write`` below are the documented call order
(README "Examples"); the reference test's ALIENCLAW_HOME case is environment wiring and is
not ported.

Layout: ``tmp/real/ws`` is the boundary, ``tmp/link -> tmp/real``,
``tmp/wslink -> tmp/real/ws``. All fixtures live in tmp_path.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from agent_tool_sandbox import assert_inside_boundary, assert_no_symlink

TEXT = "inside the workspace\n"
_READ_FLAGS = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)


def _read(path_str: str, root: Path) -> tuple[Path, str]:
    assert_no_symlink(root / path_str, operation="read", root=root)
    target = assert_inside_boundary(path_str, root)
    fd = os.open(target, _READ_FLAGS)
    with open(fd, encoding="utf-8") as fh:
        return target, fh.read()


def _write(path_str: str, text: str, root: Path) -> Path:
    assert_no_symlink(root / path_str, root=root)
    target = assert_inside_boundary(path_str, root)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    return target


@pytest.fixture
def layout(tmp_path: Path) -> dict[str, Path]:
    ws = tmp_path / "real" / "ws"
    ws.mkdir(parents=True)
    (ws / "notes.txt").write_text(TEXT)
    (tmp_path / "link").symlink_to(tmp_path / "real")
    (tmp_path / "wslink").symlink_to(ws)
    root = Path(os.path.realpath(tmp_path / "link" / "ws"))
    assert root == ws.resolve()
    return {"tmp": tmp_path, "ws": ws, "root": root}


def _via_prefix(layout: dict[str, Path], name: str, form: str) -> str:
    tmp = layout["tmp"]
    return {
        "abs-link": str(tmp / "link" / "ws" / name),  # symlinked ancestor of the root
        "abs-wslink": str(tmp / "wslink" / name),  # the root's own entry is a symlink
        "rel-link": f"../../link/ws/{name}",  # relative, leaves and re-enters via the link
    }[form]


FORMS = ["abs-link", "abs-wslink", "rel-link"]


# ── symlinked prefix is accepted ──────────────────────────────────────────────

@pytest.mark.parametrize("form", FORMS)
def test_read_through_symlinked_prefix_succeeds(layout: dict[str, Path], form: str) -> None:
    target, text = _read(_via_prefix(layout, "notes.txt", form), layout["root"])
    assert text == TEXT
    assert target == layout["root"] / "notes.txt"


@pytest.mark.parametrize("form", FORMS)
def test_write_through_symlinked_prefix_succeeds(layout: dict[str, Path], form: str) -> None:
    target = _write(_via_prefix(layout, "out.txt", form), "hi\n", layout["root"])
    assert target == layout["root"] / "out.txt"
    assert (layout["ws"] / "out.txt").read_text() == "hi\n"
    assert (layout["tmp"] / "link").is_symlink()  # the prefix link itself is untouched


@pytest.mark.parametrize("root_form", ["link", "wslink"])
def test_unresolved_root_with_prefix_path(layout: dict[str, Path], root_form: str) -> None:
    """The root itself spelled through a symlink (an unresolved deploy path)."""
    tmp = layout["tmp"]
    unresolved = tmp / "link" / "ws" if root_form == "link" else tmp / "wslink"
    _, text = _read(str(unresolved / "notes.txt"), unresolved)
    _, text_rel = _read("notes.txt", unresolved)
    _write(str(unresolved / "w.txt"), "w\n", unresolved)
    assert text == text_rel == TEXT
    assert (layout["ws"] / "w.txt").read_text() == "w\n"


@pytest.mark.parametrize("form", FORMS)
def test_without_root_the_full_walk_still_refuses_the_prefix(
    layout: dict[str, Path], form: str
) -> None:
    """root=None keeps the original walk to '/', so the prefix link is refused there."""
    path_str = _via_prefix(layout, "notes.txt", form)
    with pytest.raises(ValueError, match=r"^Symlink in path rejected on read: "):
        assert_no_symlink(layout["root"] / path_str, operation="read")


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
    tmp, root = in_ws_links["tmp"], in_ws_links["root"]
    path_str = str(tmp / "link" / "ws" / rel) if prefixed else rel
    with pytest.raises(ValueError, match=f"^{message} on read: "):
        _read(path_str, root)
    with pytest.raises(ValueError, match=f"^{message} on write: "):
        _write(path_str, "OVERWRITTEN", root)
    assert (in_ws_links["ws"] / "notes.txt").read_text() == TEXT
    assert (in_ws_links["ws"] / "sub" / "f.txt").read_text() == TEXT


def test_refusal_names_the_entry_as_spelled(in_ws_links: dict[str, Path]) -> None:
    """The message names the in-root entry under the caller's (unresolved) spelling."""
    tmp, root = in_ws_links["tmp"], in_ws_links["root"]
    spelled = tmp / "link" / "ws" / "sub_alias"
    with pytest.raises(ValueError) as info:
        assert_no_symlink(spelled / "f.txt", operation="read", root=root)
    assert str(info.value) == f'Symlink in path rejected on read: "{spelled}" is a symbolic link'
    with pytest.raises(ValueError) as info:
        assert_no_symlink(root / "alias.txt", root=root)
    assert str(info.value) == (
        f'Symlink rejected on write: "{root / "alias.txt"}" is a symbolic link'
    )


def test_relative_path_is_anchored_at_cwd(
    in_ws_links: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    """A relative path is taken against the CWD, as without root= (Path semantics)."""
    monkeypatch.chdir(in_ws_links["tmp"])
    assert_no_symlink(Path("link/ws/notes.txt"), operation="read", root=in_ws_links["root"])
    with pytest.raises(ValueError, match=r"^Symlink rejected on read: "):
        assert_no_symlink(Path("link/ws/alias.txt"), operation="read", root=in_ws_links["root"])
