"""Workspace-boundary enforcement for file tools (PKT-576).

Mirrors the TypeScript `assertInsideBoundary` in msb/tool-adapters.ts (L38-46)
for the Python-bridge execution path.  The TS guard already protected the OpenClaw
tool-adapter path; the bridge path (`python3 -m alienclaw.bridge` via
real-summon-adapter.ts:54) called TOOL_REGISTRY[tool_name] directly with no
equivalent enforcement.

Environment variables (bridge inherits all via `...process.env` in real-summon-adapter.ts:55):
  ALIENCLAW_HOME             — canonical home used by TS constants.ts:75 (preferred source)
  ALIENCLAW_FILE_WORKSPACE_ROOT — explicit override for read boundary (test hook / custom deploy)
  ALIENCLAW_FILE_WRITE_WORKSPACE — explicit override for write boundary (test hook / custom deploy)
"""
import os
from pathlib import Path

# Protect the OpenClaw agent workspace from any Martian write
_OPENCLAW_SUBPATH = os.path.join(".openclaw")


def _openclaw_home() -> Path:
    """Return the ~/.openclaw directory that Martians must never write to."""
    return Path.home() / ".openclaw"


def workspace_root() -> Path:
    """Boundary for file_read: mirrors PATHS.workspace from constants.ts:80.

    Resolution order:
      1. ALIENCLAW_FILE_WORKSPACE_ROOT (explicit override / test hook)
      2. ALIENCLAW_HOME/workspace       (canonical; forwarded by real-summon-adapter.ts:55)
      3. ~/.alienclaw/workspace         (hardcoded fallback)
    """
    env = os.environ.get("ALIENCLAW_FILE_WORKSPACE_ROOT", "")
    if env:
        return Path(env).resolve()
    home = os.environ.get("ALIENCLAW_HOME", "")
    if home:
        return (Path(home) / "workspace").resolve()
    return (Path.home() / ".alienclaw" / "workspace").resolve()


def file_write_root() -> Path:
    """Boundary for file_write: mirrors PATHS.output from constants.ts:84.

    Scoped to the output subdir so Martians cannot write to goals.json or other
    governance files that live directly under workspace/.

    Resolution order:
      1. ALIENCLAW_FILE_WRITE_WORKSPACE  (explicit override / test hook)
      2. ALIENCLAW_HOME/workspace/output (canonical; forwarded by real-summon-adapter.ts:55)
      3. ~/.alienclaw/workspace/output   (hardcoded fallback)
    """
    env = os.environ.get("ALIENCLAW_FILE_WRITE_WORKSPACE", "")
    if env:
        return Path(env).resolve()
    home = os.environ.get("ALIENCLAW_HOME", "")
    if home:
        return (Path(home) / "workspace" / "output").resolve()
    return (Path.home() / ".alienclaw" / "workspace" / "output").resolve()


def assert_inside_boundary(path_str: str, boundary: Path) -> Path:
    """Return resolved path if inside boundary; raise ValueError otherwise.

    Hardened (PKT-P1 T8):
    - Uses os.path.realpath() to resolve all symlinks before comparison.
    - Rejects symlinks on write (callers that enforce write-safety call assert_no_symlink separately).
    - Rejects dotfiles (filenames starting with '.').
    - Rejects paths inside ~/.openclaw/** (OpenClaw agent workspaces).

    Mirrors the TS logic: resolve path_str against boundary (so relative paths
    are anchored to the workspace, not to CWD), then verify the resolved path
    starts with the boundary prefix.  Absolute paths that escape the boundary
    (e.g. /etc/passwd) and sibling-prefix attacks (workspace-evil/) are both
    caught by the `+ os.sep` check.
    """
    # Reject dotfiles by filename stem before resolution
    filename = os.path.basename(path_str)
    if filename.startswith("."):
        raise ValueError(
            f'Dotfile rejected: "{path_str}" — filenames starting with "." are not allowed'
        )

    # Use os.path.realpath for full symlink resolution
    raw = (boundary / path_str)
    # realpath resolves even if path does not yet exist (resolves existing ancestors)
    resolved_str = os.path.realpath(str(raw))
    resolved = Path(resolved_str)

    boundary_real = Path(os.path.realpath(str(boundary)))
    sep = os.sep
    inside = resolved_str.startswith(str(boundary_real) + sep) or resolved == boundary_real
    if not inside:
        raise ValueError(
            f'Path traversal rejected: "{path_str}" resolves outside workspace boundary'
        )

    # Reject anything inside ~/.openclaw (OpenClaw agent workspaces — 2026 campaign vector)
    openclaw_real = os.path.realpath(str(_openclaw_home()))
    if resolved_str.startswith(openclaw_real + sep) or resolved_str == openclaw_real:
        raise ValueError(
            f'OpenClaw workspace denied: "{path_str}" targets an OpenClaw agent directory'
        )

    return resolved


def assert_no_symlink(resolved_path: Path) -> None:
    """Raise ValueError if the resolved path is a symlink.

    Used on write paths to prevent symlink-escape attacks after boundary check.
    Any component of the path that is a symlink is also checked.
    """
    # Check the target itself
    if resolved_path.is_symlink():
        raise ValueError(
            f'Symlink rejected on write: "{resolved_path}" is a symbolic link'
        )
    # Check all ancestors up to the filesystem root
    current = resolved_path.parent
    while current != current.parent:
        if current.is_symlink():
            raise ValueError(
                f'Symlink in path rejected on write: "{current}" is a symbolic link'
            )
        current = current.parent
