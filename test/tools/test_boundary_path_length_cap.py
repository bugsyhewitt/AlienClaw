"""Regression (2026-11-26 security review, F1): over-long tool paths are refused up front.

Commit 8d66853c's symlink walk called os.path.realpath() once per path component, so
its cost grew with the square of the path length: file_read with
``"../"*9 + "nonexistent-zz/" + "a/"*4000 + "x.txt"`` (8 KB) took ~30 s of CPU on 3.12
before returning the generic refusal, and the bridge accepts 1 MiB requests. A path
longer than 4096 bytes (PATH_MAX) or with more than 256 components is now refused
before any filesystem call, by both entry points (assert_inside_boundary and
assert_no_symlink), and the walk itself is linear.
"""
from __future__ import annotations

import time
from pathlib import Path

import pytest

from alienclaw.tools import _boundary
from alienclaw.tools.file_read import run as file_read_run
from alienclaw.tools.file_write import run as file_write_run

REVIEWER_PATH = "../" * 9 + "nonexistent-zz/" + "a/" * 4000 + "x.txt"
BUDGET_S = 1.0


@pytest.fixture
def ws(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "ws"
    root.mkdir()
    monkeypatch.setenv("ALIENCLAW_FILE_WORKSPACE_ROOT", str(root))
    monkeypatch.setenv("ALIENCLAW_FILE_WRITE_WORKSPACE", str(root))
    return root


def _timed(fn, *args):
    start = time.perf_counter()
    result = fn(*args)
    return result, time.perf_counter() - start


@pytest.mark.parametrize(
    ("tool", "inputs"),
    [
        (file_read_run, {"path": REVIEWER_PATH}),
        (file_write_run, {"path": REVIEWER_PATH, "content": "x"}),
    ],
    ids=["file_read", "file_write"],
)
def test_reviewer_8kb_path_is_refused_fast(ws: Path, tool, inputs) -> None:
    r, elapsed = _timed(tool, inputs)
    assert r.ok is False
    assert "Path rejected" in r.error and "4096-byte limit" in r.error
    assert elapsed < BUDGET_S, f"took {elapsed:.2f} s"


@pytest.mark.parametrize("path", ["a/" * 300 + "x.txt", "../" * 300 + "x.txt"])
@pytest.mark.parametrize("tool", [file_read_run, file_write_run], ids=["file_read", "file_write"])
def test_too_many_components_is_refused_fast(ws: Path, tool, path: str) -> None:
    inputs = {"path": path, "content": "x"}
    r, elapsed = _timed(tool, inputs)
    assert r.ok is False
    assert "Path rejected" in r.error and "256-component limit" in r.error
    assert elapsed < BUDGET_S, f"took {elapsed:.2f} s"


def test_255_component_path_inside_the_root_still_works(ws: Path) -> None:
    rel = "/".join(["d"] * 254 + ["x.txt"])
    assert len(rel.split("/")) == 255
    w, w_elapsed = _timed(file_write_run, {"path": rel, "content": "deep"})
    assert w.ok is True, w.error
    r, r_elapsed = _timed(file_read_run, {"path": rel})
    assert r.ok is True, r.error
    assert r.output["content"] == "deep\n"
    assert w_elapsed < BUDGET_S and r_elapsed < BUDGET_S, (w_elapsed, r_elapsed)


def test_both_entry_points_refuse_before_touching_the_filesystem(
    ws: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_fs(*args, **kwargs):
        raise AssertionError("filesystem touched for an over-long path")

    monkeypatch.setattr(_boundary.os.path, "realpath", no_fs)
    monkeypatch.setattr(_boundary.Path, "is_symlink", no_fs)
    for path in (REVIEWER_PATH, "a/" * 300 + "x.txt"):
        with pytest.raises(ValueError, match="Path rejected"):
            _boundary.assert_inside_boundary(path, ws)
        with pytest.raises(ValueError, match="Path rejected"):
            _boundary.assert_no_symlink(ws / path, operation="read", root=ws)
        with pytest.raises(ValueError, match="Path rejected"):
            _boundary.assert_no_symlink(ws / path)


def test_limits_are_inclusive(ws: Path) -> None:
    at_bytes = "a" * 4096
    at_parts = "/".join(["p"] * 256)
    for path in (at_bytes, at_parts):
        # At the limit the caps pass; the path itself is then judged as usual.
        try:
            _boundary.assert_inside_boundary(path, ws)
        except ValueError as exc:
            assert "Path rejected" not in str(exc)
    with pytest.raises(ValueError, match="4097 bytes"):
        _boundary.assert_inside_boundary("a" * 4097, ws)
    with pytest.raises(ValueError, match="257 components"):
        _boundary.assert_inside_boundary(at_parts + "/p", ws)
    # Multi-byte characters count in UTF-8 bytes (what the kernel sees).
    with pytest.raises(ValueError, match="4098 bytes"):
        _boundary.assert_inside_boundary("é" * 2049, ws)
