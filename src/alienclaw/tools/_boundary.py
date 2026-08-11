"""Workspace-boundary enforcement for file tools (PKT-576).

Mirrors the TypeScript `assertInsideBoundary` in msb/tool-adapters.ts (L38-46)
for the Python-bridge execution path.  The TS guard already protects the OpenClaw
tool-adapter path; this module closes the equivalent gap on the bridge path.

Environment variable:
  ALIENCLAW_FILE_WORKSPACE_ROOT — absolute path to the workspace root.
  Fallback: ~/.alienclaw/workspace (mirrors PATHS.workspace in constants.ts).
"""
import os
from pathlib import Path


def workspace_root() -> Path:
    env = os.environ.get("ALIENCLAW_FILE_WORKSPACE_ROOT", "")
    if env:
        return Path(env).resolve()
    return (Path.home() / ".alienclaw" / "workspace").resolve()


def assert_inside_boundary(path_str: str, boundary: Path) -> Path:
    """Return resolved path if inside boundary; raise ValueError otherwise.

    Mirrors the TS logic: resolve path_str against boundary (so relative paths
    are anchored to the workspace, not to CWD), then verify the resolved path
    starts with the boundary prefix.  Absolute paths that escape the boundary
    (e.g. /etc/passwd) are caught by the startsWith check.
    """
    resolved = (boundary / path_str).resolve()
    sep = os.sep
    inside = str(resolved).startswith(str(boundary) + sep) or resolved == boundary
    if not inside:
        raise ValueError(
            f'Path traversal rejected: "{path_str}" resolves outside workspace boundary'
        )
    return resolved
