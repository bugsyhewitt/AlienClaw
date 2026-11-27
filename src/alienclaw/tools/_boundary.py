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


def _final_component(path_str: str) -> str:
    """Last component of path_str that names something ('' and '.' parts skipped).

    os.path.basename() alone is '' for '.env/' and '.' for '.env/./', which let a
    trailing slash carry a dotfile past the dotfile rule (fixed 2026-11-26).
    """
    path_str = os.fspath(path_str)
    if os.altsep:
        path_str = path_str.replace(os.altsep, os.sep)
    parts = [p for p in path_str.split(os.sep) if p not in ("", ".")]
    return parts[-1] if parts else ""


def _dotfile_rejected(path_str: str) -> ValueError:
    return ValueError(
        f'Dotfile rejected: "{path_str}" — filenames starting with "." are not allowed'
    )


def assert_inside_boundary(path_str: str, boundary: Path) -> Path:
    """Return resolved path if inside boundary; raise ValueError otherwise.

    Hardened (PKT-P1 T8):
    - Uses os.path.realpath() to resolve all symlinks before comparison.
    - Does not reject symlinks itself: file_write and file_read call assert_no_symlink
      separately, on the unresolved path, before this check.
    - Rejects dotfiles: the final component that names something starts with '.',
      however it is spelled ('.env', '.env/', './.env/.'), or the resolved path's
      final component does (a symlink whose target is a dotfile). Dot-directories
      in the middle of a path are not rejected.
    - Rejects paths inside ~/.openclaw/** (OpenClaw agent workspaces).

    Mirrors the TS logic: resolve path_str against boundary (so relative paths
    are anchored to the workspace, not to CWD), then verify the resolved path
    starts with the boundary prefix.  Absolute paths that escape the boundary
    (e.g. /etc/passwd) and sibling-prefix attacks (workspace-evil/) are both
    caught by the `+ os.sep` check.
    """
    # Reject dotfiles by final component before resolution. basename() keeps '.',
    # 'a/.' and 'a/..' rejected; _final_component() closes '.env/', '.env/./', etc.
    filename = os.path.basename(path_str)
    if filename.startswith(".") or _final_component(path_str).startswith("."):
        raise _dotfile_rejected(path_str)

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

    # Same rule after resolution: a symlink (file or directory) whose target is a dotfile
    if resolved != boundary_real and resolved.name.startswith("."):
        raise _dotfile_rejected(path_str)

    # Reject anything inside ~/.openclaw (OpenClaw agent workspaces — 2026 campaign vector)
    openclaw_real = os.path.realpath(str(_openclaw_home()))
    if resolved_str.startswith(openclaw_real + sep) or resolved_str == openclaw_real:
        raise ValueError(
            f'OpenClaw workspace denied: "{path_str}" targets an OpenClaw agent directory'
        )

    return resolved


def assert_no_symlink(resolved_path: Path, *, operation: str = "write") -> None:
    """Raise ValueError if the path is a symlink.

    Pass the UNRESOLVED path. Used on write paths (file_write) and read paths
    (file_read, since 2026-11-26) to prevent symlink-escape attacks; ``operation``
    only names the operation in the error message. Any component of the path that
    is a symlink is also checked.
    """
    # Check the target itself
    if resolved_path.is_symlink():
        raise ValueError(
            f'Symlink rejected on {operation}: "{resolved_path}" is a symbolic link'
        )
    # Check all ancestors up to the filesystem root
    current = resolved_path.parent
    while current != current.parent:
        if current.is_symlink():
            raise ValueError(
                f'Symlink in path rejected on {operation}: "{current}" is a symbolic link'
            )
        current = current.parent
