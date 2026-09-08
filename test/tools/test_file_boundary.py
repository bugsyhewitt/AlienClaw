"""test_file_boundary.py — Python boundary enforcement tests (T8, PKT-P1).

Re-establishes coverage for _boundary.py after the previous test source was
removed. Tests the hardened assert_inside_boundary() and assert_no_symlink().

All tests use tmpdir fixtures and never write outside the temp directory.
"""

import os
import stat
import tempfile
from pathlib import Path

import pytest

from alienclaw.tools._boundary import (
    assert_inside_boundary,
    assert_no_symlink,
    file_write_root,
    workspace_root,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    """A temporary workspace directory that acts as the boundary for tests."""
    ws = tmp_path / "workspace"
    ws.mkdir()
    return ws


# ---------------------------------------------------------------------------
# Basic path traversal
# ---------------------------------------------------------------------------

class TestAssertInsideBoundary:
    def test_accepts_simple_relative_path(self, workspace: Path) -> None:
        result = assert_inside_boundary("data/result.json", workspace)
        assert str(result).startswith(str(workspace))
        assert "result.json" in str(result)

    def test_rejects_dotdot_traversal(self, workspace: Path) -> None:
        with pytest.raises(ValueError, match="Path traversal rejected"):
            assert_inside_boundary("../etc/passwd", workspace)

    def test_rejects_deeply_nested_dotdot(self, workspace: Path) -> None:
        with pytest.raises(ValueError, match="Path traversal rejected"):
            assert_inside_boundary("../../../../../../etc/shadow", workspace)

    def test_rejects_absolute_path_outside_boundary(self, workspace: Path) -> None:
        with pytest.raises(ValueError, match="Path traversal rejected"):
            assert_inside_boundary("/etc/passwd", workspace)

    def test_rejects_absolute_path_to_tmp(self, workspace: Path, tmp_path: Path) -> None:
        # Even /tmp/<other> is outside the workspace
        outside = tmp_path / "outside.txt"
        outside.write_text("outside")
        with pytest.raises(ValueError, match="Path traversal rejected"):
            assert_inside_boundary(str(outside), workspace)


# ---------------------------------------------------------------------------
# Dotfile denial (PKT-P1 T8)
# ---------------------------------------------------------------------------

class TestDotfileDenial:
    def test_rejects_dotenv(self, workspace: Path) -> None:
        with pytest.raises(ValueError, match="Dotfile rejected"):
            assert_inside_boundary(".env", workspace)

    def test_rejects_dotgitconfig(self, workspace: Path) -> None:
        with pytest.raises(ValueError, match="Dotfile rejected"):
            assert_inside_boundary(".gitconfig", workspace)

    def test_rejects_dotfile_in_subdir(self, workspace: Path) -> None:
        with pytest.raises(ValueError, match="Dotfile rejected"):
            assert_inside_boundary("subdir/.secret", workspace)

    def test_accepts_non_dotfile(self, workspace: Path) -> None:
        result = assert_inside_boundary("output.txt", workspace)
        assert "output.txt" in str(result)


# ---------------------------------------------------------------------------
# Symlink escape (PKT-P1 T8)
# ---------------------------------------------------------------------------

class TestSymlinkEscape:
    def test_rejects_symlink_pointing_outside(
        self, workspace: Path, tmp_path: Path
    ) -> None:
        outside_file = tmp_path / "secret.txt"
        outside_file.write_text("outside secret")
        link_path = workspace / "escape"
        link_path.symlink_to(outside_file)

        with pytest.raises(ValueError, match="Path traversal rejected"):
            assert_inside_boundary("escape", workspace)

    def test_rejects_symlink_to_parent_dir(self, workspace: Path, tmp_path: Path) -> None:
        link_path = workspace / "up"
        link_path.symlink_to(tmp_path)
        with pytest.raises(ValueError, match="Path traversal rejected"):
            assert_inside_boundary("up/workspace/../secret.txt", workspace)


# ---------------------------------------------------------------------------
# OpenClaw workspace denial (PKT-P1 T8)
# ---------------------------------------------------------------------------

class TestOpenclawDenial:
    def test_rejects_symlink_to_openclaw_home(
        self, workspace: Path, tmp_path: Path
    ) -> None:
        """Symlink inside workspace pointing to ~/.openclaw is rejected."""
        openclaw = Path.home() / ".openclaw"
        link_path = workspace / "oc_link"
        link_path.symlink_to(openclaw)
        # The realpath of oc_link/* resolves to ~/.openclaw/* — denied
        with pytest.raises(ValueError, match="Path traversal rejected|OpenClaw workspace denied"):
            assert_inside_boundary("oc_link/agents/bossbot/SOUL.md", workspace)


# ---------------------------------------------------------------------------
# assert_no_symlink (write-path guard)
# ---------------------------------------------------------------------------

class TestAssertNoSymlink:
    def test_accepts_regular_file(self, workspace: Path) -> None:
        regular = workspace / "data.txt"
        regular.write_text("hello")
        assert_no_symlink(regular)  # should not raise

    def test_rejects_symlink_target(self, workspace: Path, tmp_path: Path) -> None:
        target = tmp_path / "real.txt"
        target.write_text("real")
        link = workspace / "link.txt"
        link.symlink_to(target)
        with pytest.raises(ValueError, match="Symlink rejected"):
            assert_no_symlink(link)

    def test_rejects_symlink_in_ancestor_dir(
        self, workspace: Path, tmp_path: Path
    ) -> None:
        # Parent directory is a symlink
        real_subdir = tmp_path / "real_subdir"
        real_subdir.mkdir()
        link_subdir = workspace / "link_subdir"
        link_subdir.symlink_to(real_subdir)
        file_in_link = link_subdir / "data.txt"
        # file_in_link's parent is a symlink → should be rejected
        with pytest.raises(ValueError, match="Symlink"):
            assert_no_symlink(file_in_link)


# ---------------------------------------------------------------------------
# compute — exponent guard
# ---------------------------------------------------------------------------

class TestComputeExponentGuard:
    def test_blocks_9_to_the_9_to_the_9(self) -> None:
        from alienclaw.tools.compute import run

        result = run({"input": "9**9**9"})
        assert result.ok is False
        assert "exponent" in result.error.lower() or "disallowed" in result.error.lower()

    def test_blocks_10_to_the_101(self) -> None:
        from alienclaw.tools.compute import run

        result = run({"input": "10**101"})
        assert result.ok is False
        assert "exponent" in result.error.lower()

    def test_allows_2_to_the_10(self) -> None:
        from alienclaw.tools.compute import run

        result = run({"input": "2**10"})
        assert result.ok is True
        assert result.output is not None
        assert result.output["result"] == 1024

    def test_blocks_non_literal_exponent(self) -> None:
        from alienclaw.tools.compute import run

        # Variable as exponent is blocked because _check_pow requires a literal
        result = run({"input": "2**abs(3)"})
        assert result.ok is False


# ---------------------------------------------------------------------------
# extract_json — depth guard
# ---------------------------------------------------------------------------

class TestExtractJsonDepthGuard:
    def _nest(self, depth: int) -> str:
        import json
        obj: dict = {}
        cur = obj
        for _ in range(depth):
            cur["x"] = {}
            cur = cur["x"]
        return json.dumps(obj)

    def test_accepts_depth_32(self) -> None:
        from alienclaw.tools.extract_json import run

        nested = self._nest(32)
        result = run({"json": nested})
        assert result.ok is True

    def test_rejects_depth_33(self) -> None:
        from alienclaw.tools.extract_json import run

        nested = self._nest(33)
        result = run({"json": nested})
        assert result.ok is False
        assert "nesting depth" in result.error.lower() or "depth" in result.error.lower()


# ---------------------------------------------------------------------------
# search_text — ReDoS guard
# ---------------------------------------------------------------------------

class TestSearchTextReDoSGuard:
    def test_rejects_pattern_over_200_chars(self) -> None:
        from alienclaw.tools.search_text import run

        long_pattern = "a" * 201
        result = run({
            "text": "hello world",
            "pattern": long_pattern,
            "flavor": "regex",
        })
        assert result.ok is False
        assert "too long" in result.error.lower() or "exceeds" in result.error.lower()

    def test_accepts_pattern_at_200_chars(self) -> None:
        from alienclaw.tools.search_text import run

        pattern_200 = "a" * 200
        # This should not be rejected by the length cap (exactly at limit)
        result = run({
            "text": "hello " + "a" * 200 + " world",
            "pattern": pattern_200,
            "flavor": "literal",
        })
        # May succeed or fail for other reasons, but NOT the length cap
        if not result.ok:
            assert "too long" not in result.error.lower()
