"""Shared filesystem-jail vectors: every vector's recorded Python verdict.

The corpus (``../../vectors/fs-vectors.json``) is shared with the TypeScript package
(``ts/test/shared-fs-vectors.test.ts`` runs the same vectors against ``src/fs-jail.ts``).
It RECORDS observed behaviour per language; ``expected.python`` must equal ``expected.ts``
unless the vector carries a ``divergence`` note, so parity is enforced by data.

Harness (identical in the TS test; change both together). Each vector gets a fresh
``tempfile.mkdtemp`` directory (realpath'd, the ``{base}``), the named layout is built in
it, and one operation runs:

  op "boundary": ``assert_inside_boundary(input, root, deny_roots=...)``.
  op "read":  ``assert_no_symlink(root / input, operation="read")``, then
    ``assert_inside_boundary``, then ``os.open(target, O_RDONLY | O_NOFOLLOW)`` and read.
  op "write": ``assert_no_symlink(root / input)``, then ``assert_inside_boundary``, then
    ``target.parent.mkdir(parents=True, exist_ok=True)`` and ``write_text``.

"deny" = ValueError, mapped to a reason code by its message; "allow" = the operation
completed, reported as the base-relative resolved path. Any other exception fails. After
every write vector nothing outside the root has changed; after a deny, nothing has.
"""
from __future__ import annotations

import json
import os
import platform
import re
import shutil
import tempfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from agent_tool_sandbox import assert_inside_boundary, assert_no_symlink

CORPUS = Path(__file__).resolve().parents[2] / "vectors" / "fs-vectors.json"
DOC: dict[str, Any] = json.loads(CORPUS.read_text(encoding="utf-8"))
VECTORS: list[dict[str, Any]] = DOC["vectors"]

OPS = {"boundary", "read", "write"}
REASONS = {
    "DOTFILE", "TRAVERSAL", "DENIED_ROOT", "SYMLINK", "SYMLINK_IN_PATH",
    "UNINSPECTABLE", "INVALID_PATH", "NOT_A_FILE", "TOO_LARGE",
}
# Longest prefix first: "Symlink in path rejected on" must not match "Symlink rejected on".
_MESSAGE_REASONS = [
    ("Dotfile rejected: ", "DOTFILE"),
    ("Path traversal rejected: ", "TRAVERSAL"),
    ("Denied root: ", "DENIED_ROOT"),
    ("Symlink in path rejected on ", "SYMLINK_IN_PATH"),
    ("Symlink rejected on ", "SYMLINK"),
    ("Path not inspectable on ", "UNINSPECTABLE"),
]
ID_RE = re.compile(r"^[a-z0-9][a-z0-9.-]*[a-z0-9]$")


def _reason(exc: ValueError) -> str:
    message = str(exc)
    for prefix, reason in _MESSAGE_REASONS:
        if message.startswith(prefix):
            return reason
    # os.lstat inside realpath: "embedded null byte" (<= 3.13), "lstat: embedded null
    # character in path" (3.14).
    if "embedded null" in message:
        return "INVALID_PATH"
    raise AssertionError(f"unmapped ValueError message: {message!r}")


def _expand(text: str, base: Path, root: Path) -> str:
    return text.replace("{root}", str(root)).replace("{base}", str(base))


def _build(layout: list[dict[str, Any]], base: Path, root: Path) -> None:
    for entry in layout:
        p = base / entry["path"]
        p.parent.mkdir(parents=True, exist_ok=True)
        if entry["type"] == "dir":
            p.mkdir(exist_ok=True)
        elif entry["type"] == "file":
            p.write_text(entry["content"], encoding="utf-8")
        elif entry["type"] == "symlink":
            os.symlink(_expand(entry["target"], base, root), p)
        else:
            raise AssertionError(f"unknown layout type {entry['type']!r}")


def _snapshot(base: Path) -> dict[str, str]:
    """Every entry under base, without following symlinks."""
    out: dict[str, str] = {}

    def walk(d: Path) -> None:
        for entry in sorted(os.scandir(d), key=lambda e: e.name):
            rel = os.path.relpath(entry.path, base)
            if entry.is_symlink():
                out[rel] = "link:" + os.readlink(entry.path)
            elif entry.is_dir():
                out[rel] = "dir"
                walk(Path(entry.path))
            else:
                out[rel] = "file:" + Path(entry.path).read_bytes().hex()

    walk(base)
    return out


def _outside(snapshot: dict[str, str], root_rel: str) -> dict[str, str]:
    return {k: v for k, v in snapshot.items() if k != root_rel and not k.startswith(root_rel + "/")}


@pytest.fixture
def base() -> Iterator[Path]:
    d = Path(os.path.realpath(tempfile.mkdtemp(prefix="fs-vectors-")))
    try:
        yield d
    finally:
        shutil.rmtree(d, ignore_errors=True)


def _write_data(vector_id: str) -> str:
    return f"written by fs vector {vector_id}\n"


def _run(vec: dict[str, Any], base: Path) -> dict[str, str]:
    root = base / vec["root"]
    deny = [base / d for d in vec.get("deny_roots", [])]
    path_str = _expand(vec["input"], base, root)
    op = vec["op"]
    try:
        if op == "boundary":
            target = assert_inside_boundary(path_str, root, deny_roots=deny)
        elif op == "read":
            assert_no_symlink(root / path_str, operation="read")
            target = assert_inside_boundary(path_str, root, deny_roots=deny)
            fd = os.open(target, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with open(fd, "rb") as fh:
                data = fh.read()
            assert data == target.read_bytes()
        elif op == "write":
            assert_no_symlink(root / path_str)
            target = assert_inside_boundary(path_str, root, deny_roots=deny)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(_write_data(vec["id"]), encoding="utf-8")
        else:
            raise AssertionError(f"unknown op {op!r}")
    except ValueError as exc:
        return {"verdict": "deny", "reason": _reason(exc)}
    return {"verdict": "allow", "resolved": os.path.relpath(target, base)}


# ── corpus shape ──────────────────────────────────────────────────────────────

def test_corpus_is_loaded() -> None:
    assert DOC["schema_version"] == 1
    assert len(VECTORS) >= 100


def test_vector_ids_are_unique_and_well_formed() -> None:
    ids = [v["id"] for v in VECTORS]
    assert len(ids) == len(set(ids))
    assert all(ID_RE.match(i) for i in ids)


def test_vectors_are_well_formed() -> None:
    for vec in VECTORS:
        assert vec["layout"] in DOC["layouts"], vec["id"]
        assert vec["op"] in OPS, vec["id"]
        assert isinstance(vec["input"], str), vec["id"]
        assert vec["rationale"], vec["id"]
        for side in ("python", "ts"):
            exp = vec["expected"][side]
            if exp["verdict"] == "deny":
                assert set(exp) == {"verdict", "reason"} and exp["reason"] in REASONS, vec["id"]
            else:
                assert exp["verdict"] == "allow" and set(exp) == {"verdict", "resolved"}, vec["id"]


def test_parity_is_declared() -> None:
    """python == ts unless a divergence is written down, and a divergence must be real."""
    for vec in VECTORS:
        same = vec["expected"]["python"] == vec["expected"]["ts"]
        if "divergence" in vec:
            assert vec["divergence"].strip() and not same, vec["id"]
        else:
            assert same, vec["id"]


def test_no_layout_entry_is_a_dotenv_file() -> None:
    for layout in DOC["layouts"].values():
        for entry in layout:
            assert not any(part.startswith(".env") for part in entry["path"].split("/"))


# ── the vectors ───────────────────────────────────────────────────────────────

@pytest.mark.skipif(platform.system() == "Windows", reason="POSIX semantics only")
@pytest.mark.parametrize("vec", VECTORS, ids=[v["id"] for v in VECTORS])
def test_shared_fs_vector(vec: dict[str, Any], base: Path) -> None:
    root = base / vec["root"]
    _build(DOC["layouts"][vec["layout"]], base, root)
    before = _snapshot(base)

    observed = _run(vec, base)
    assert observed == vec["expected"]["python"]

    after = _snapshot(base)
    if vec["op"] == "write":
        assert _outside(after, vec["root"]) == _outside(before, vec["root"])
        if observed["verdict"] == "allow":
            written = (base / observed["resolved"]).read_text(encoding="utf-8")
            assert written == _write_data(vec["id"])
    if observed["verdict"] == "deny":
        assert after == before
