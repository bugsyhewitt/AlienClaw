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

    Mirrors the TS logic: resolve path_str against boundary (so relative paths
    are anchored to the workspace, not to CWD), then verify the resolved path
    starts with the boundary prefix.  Absolute paths that escape the boundary
    (e.g. /etc/passwd) and sibling-prefix attacks (workspace-evil/) are both
    caught by the `+ os.sep` check.
    """
    resolved = (boundary / path_str).resolve()
    sep = os.sep
    inside = str(resolved).startswith(str(boundary) + sep) or resolved == boundary
    if not inside:
        raise ValueError(
            f'Path traversal rejected: "{path_str}" resolves outside workspace boundary'
        )
    return resolved
