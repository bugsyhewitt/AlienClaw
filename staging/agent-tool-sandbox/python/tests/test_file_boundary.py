"""Boundary-jail tests, ported from the reference file-boundary suite.

Tests assert_inside_boundary() and assert_no_symlink(). The reference suite's
OpenClaw-home denial is ported onto the explicit ``deny_roots`` parameter; its
unrelated tool tests (compute / extract_json / search_text) are not ported.

All tests use tmp_path fixtures and never write outside the temp directory.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from agent_tool_sandbox import assert_inside_boundary, assert_no_symlink

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

    def test_accepts_boundary_itself(self, workspace: Path) -> None:
        assert assert_inside_boundary(str(workspace), workspace) == workspace.resolve()

    def test_dotdot_final_component_is_rejected_as_dotfile(self, workspace: Path) -> None:
        # basename("a/..") == ".." starts with "." — rejected before resolution.
        with pytest.raises(ValueError, match="Dotfile rejected"):
            assert_inside_boundary("a/..", workspace)

    def test_rejects_sibling_prefix(self, workspace: Path) -> None:
        with pytest.raises(ValueError, match="Path traversal rejected"):
            assert_inside_boundary("../workspace-evil/x", workspace)


# ---------------------------------------------------------------------------
# Dotfile denial
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

    @pytest.mark.xfail(
        strict=True,
        reason="KNOWN GAP (kept identical to in-tree): the dotfile check looks at "
        "os.path.basename(), which is '' for a trailing slash, so '.env/' resolves "
        "to <boundary>/.env and is accepted.",
    )
    def test_rejects_dotfile_with_trailing_slash(self, workspace: Path) -> None:
        (workspace / ".env").write_text("SECRET=1")
        with pytest.raises(ValueError, match="Dotfile rejected"):
            assert_inside_boundary(".env/", workspace)

    def test_dot_directories_are_not_rejected(self, workspace: Path) -> None:
        # Documented behavior: only the final component is checked.
        result = assert_inside_boundary(".git/config", workspace)
        assert result == workspace.resolve() / ".git" / "config"


# ---------------------------------------------------------------------------
# Symlink escape
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

    def test_accepts_symlink_that_stays_inside(self, workspace: Path) -> None:
        real = workspace / "real"
        real.mkdir()
        (workspace / "alias").symlink_to(real)
        assert assert_inside_boundary("alias/f.txt", workspace) == real.resolve() / "f.txt"


# ---------------------------------------------------------------------------
# Denied roots (reference: OpenClaw-home denial, now caller-supplied)
# ---------------------------------------------------------------------------

class TestDenyRoots:
    def test_rejects_symlink_to_denied_root_outside_boundary(
        self, workspace: Path, tmp_path: Path
    ) -> None:
        """Symlink inside workspace pointing to a denied root outside it is rejected."""
        denied = tmp_path / "home" / ".agentstate"
        (denied / "agents").mkdir(parents=True)
        (workspace / "oc_link").symlink_to(denied)
        with pytest.raises(ValueError, match="Path traversal rejected|Denied root"):
            assert_inside_boundary(
                "oc_link/agents/a/SOUL.md", workspace, deny_roots=[denied]
            )

    def test_rejects_denied_root_inside_boundary(self, tmp_path: Path) -> None:
        home = tmp_path / "home"
        denied = home / ".agentstate"
        denied.mkdir(parents=True)
        with pytest.raises(ValueError, match="Denied root"):
            assert_inside_boundary(".agentstate/agents/a/SOUL.md", home, deny_roots=[denied])
        with pytest.raises(ValueError, match="Denied root"):
            assert_inside_boundary(str(denied / "x" / "y"), home, deny_roots=[str(denied)])

    def test_denied_root_itself_is_rejected(self, tmp_path: Path) -> None:
        home = tmp_path / "home"
        denied = home / "state"
        denied.mkdir(parents=True)
        with pytest.raises(ValueError, match="Denied root"):
            assert_inside_boundary("state", home, deny_roots=(denied,))

    def test_symlink_into_denied_root_inside_boundary(self, tmp_path: Path) -> None:
        home = tmp_path / "home"
        denied = home / "state"
        denied.mkdir(parents=True)
        (home / "innocent").symlink_to(denied)
        with pytest.raises(ValueError, match="Denied root"):
            assert_inside_boundary("innocent/x", home, deny_roots=[denied])

    def test_single_path_deny_root_is_not_iterated_charwise(self, tmp_path: Path) -> None:
        home = tmp_path / "home"
        denied = home / "state"
        denied.mkdir(parents=True)
        with pytest.raises(ValueError, match="Denied root"):
            assert_inside_boundary("state/x", home, deny_roots=denied)
        assert assert_inside_boundary("other/x", home, deny_roots=str(denied))

    def test_sibling_of_denied_root_is_allowed(self, tmp_path: Path) -> None:
        home = tmp_path / "home"
        denied = home / "state"
        denied.mkdir(parents=True)
        result = assert_inside_boundary("state-public/x", home, deny_roots=[denied])
        assert result == home.resolve() / "state-public" / "x"

    def test_no_deny_roots_by_default(self, tmp_path: Path) -> None:
        home = tmp_path / "home"
        (home / ".openclaw").mkdir(parents=True)
        # Not a dotfile by basename, inside boundary, no deny roots → accepted.
        assert assert_inside_boundary(".openclaw/agents/x", home)


# ---------------------------------------------------------------------------
# assert_no_symlink (write-path guard)
# ---------------------------------------------------------------------------

class TestAssertNoSymlink:
    def test_accepts_regular_file(self, workspace: Path) -> None:
        regular = workspace / "data.txt"
        regular.write_text("hello")
        assert_no_symlink(regular)  # should not raise

    def test_accepts_missing_file(self, workspace: Path) -> None:
        assert_no_symlink(workspace / "not-yet" / "data.txt")

    def test_rejects_symlink_target(self, workspace: Path, tmp_path: Path) -> None:
        target = tmp_path / "real.txt"
        target.write_text("real")
        link = workspace / "link.txt"
        link.symlink_to(target)
        with pytest.raises(ValueError, match="Symlink rejected"):
            assert_no_symlink(link)

    def test_rejects_dangling_symlink(self, workspace: Path, tmp_path: Path) -> None:
        link = workspace / "dangling.txt"
        link.symlink_to(tmp_path / "does-not-exist")
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
