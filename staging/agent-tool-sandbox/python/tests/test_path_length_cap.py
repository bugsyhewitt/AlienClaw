"""Regression (2026-11-26 security review, F1): over-long paths are refused up front.

Guard-level adaptation of the reference suite's test/tools/test_boundary_path_length_cap.py
(the documented call order stands in for the reference file tools). The root= symlink walk
called realpath() once per component, so its cost grew with the square of the path length:
``"../"*9 + "nonexistent-zz/" + "a/"*4000 + "x.txt"`` (8 KB) took ~30 s of CPU. A path over
4096 bytes (PATH_MAX) or with more than 256 components is now refused before any
filesystem call, by both entry points, and the walk itself is linear.
"""
from __future__ import annotations

import time
from pathlib import Path

import pytest

import agent_tool_sandbox.boundary as boundary
from agent_tool_sandbox import assert_inside_boundary, assert_no_symlink

REVIEWER_PATH = "../" * 9 + "nonexistent-zz/" + "a/" * 4000 + "x.txt"
BUDGET_S = 1.0


def _gate(path_str: str, root: Path, operation: str) -> Path:
    assert_no_symlink(root / path_str, operation=operation, root=root)
    return assert_inside_boundary(path_str, root)


@pytest.mark.parametrize("operation", ["read", "write"])
@pytest.mark.parametrize(
    ("path", "limit"),
    [
        (REVIEWER_PATH, "4096-byte limit"),
        ("a/" * 300 + "x.txt", "256-component limit"),
        ("../" * 300 + "x.txt", "256-component limit"),
    ],
)
def test_over_long_paths_are_refused_fast(
    tmp_path: Path, operation: str, path: str, limit: str
) -> None:
    start = time.perf_counter()
    with pytest.raises(ValueError, match="Path rejected") as info:
        _gate(path, tmp_path, operation)
    elapsed = time.perf_counter() - start
    assert limit in str(info.value)
    assert elapsed < BUDGET_S, f"took {elapsed:.2f} s"


def test_255_component_path_inside_the_root_still_works(tmp_path: Path) -> None:
    rel = "/".join(["d"] * 254 + ["x.txt"])
    start = time.perf_counter()
    target = _gate(rel, tmp_path, "write")
    target.parent.mkdir(parents=True)
    target.write_text("deep\n")
    assert _gate(rel, tmp_path, "read").read_text() == "deep\n"
    assert time.perf_counter() - start < BUDGET_S


def test_in_root_symlink_deep_in_the_path_is_still_refused(tmp_path: Path) -> None:
    deep = tmp_path.joinpath(*["d"] * 100)
    deep.mkdir(parents=True)
    (deep / "link").symlink_to(tmp_path)
    rel = "/".join(["d"] * 100 + ["link", "x.txt"])
    with pytest.raises(ValueError, match="Symlink in path rejected on read"):
        _gate(rel, tmp_path, "read")


def test_both_entry_points_refuse_before_touching_the_filesystem(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_fs(*args: object, **kwargs: object) -> None:
        raise AssertionError("filesystem touched for an over-long path")

    monkeypatch.setattr(boundary.os.path, "realpath", no_fs)
    monkeypatch.setattr(boundary.Path, "is_symlink", no_fs)
    for path in (REVIEWER_PATH, "a/" * 300 + "x.txt"):
        with pytest.raises(ValueError, match="Path rejected"):
            assert_inside_boundary(path, tmp_path)
        with pytest.raises(ValueError, match="Path rejected"):
            assert_no_symlink(tmp_path / path, operation="read", root=tmp_path)
        with pytest.raises(ValueError, match="Path rejected"):
            assert_no_symlink(tmp_path / path)


def test_limits_are_inclusive_and_count_utf8_bytes(tmp_path: Path) -> None:
    at_parts = "/".join(["p"] * 256)
    for path in ("a" * 4096, at_parts):
        try:
            assert_inside_boundary(path, tmp_path)
        except ValueError as exc:
            assert "Path rejected" not in str(exc)
    with pytest.raises(ValueError, match="4097 bytes"):
        assert_inside_boundary("a" * 4097, tmp_path)
    with pytest.raises(ValueError, match="257 components"):
        assert_inside_boundary(at_parts + "/p", tmp_path)
    with pytest.raises(ValueError, match="4098 bytes"):
        assert_inside_boundary("é" * 2049, tmp_path)
