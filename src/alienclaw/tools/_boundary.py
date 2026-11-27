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


# Tool paths longer than this (Linux PATH_MAX) or with more components than this are
# refused before any filesystem call (2026-11-26 security review, F1): the kernel refuses
# such paths anyway, and the symlink walk and realpath() cost grows with the component
# count, so a few KB of "a/a/a/..." took tens of seconds of CPU.
MAX_PATH_BYTES = 4096
MAX_PATH_COMPONENTS = 256


def _component_count(path_str: str) -> int:
    """Number of components that name something ('' and '.' parts skipped; '..' counts)."""
    if os.altsep:
        path_str = path_str.replace(os.altsep, os.sep)
    return sum(1 for p in path_str.split(os.sep) if p not in ("", "."))


def _assert_path_bounded(path_str: str, *, base_components: int = 0) -> None:
    """Raise ValueError if path_str is over MAX_PATH_BYTES (UTF-8) or has more than
    MAX_PATH_COMPONENTS components beyond ``base_components`` (those of the root it is
    spelled under). Touches no filesystem; the message does not echo the path."""
    path_str = os.fspath(path_str)
    size = len(path_str.encode("utf-8", "surrogatepass"))
    if size > MAX_PATH_BYTES:
        raise ValueError(
            f"Path rejected: {size} bytes is longer than the {MAX_PATH_BYTES}-byte limit"
        )
    count = _component_count(path_str) - base_components
    if count > MAX_PATH_COMPONENTS:
        raise ValueError(
            f"Path rejected: {count} components is more than the "
            f"{MAX_PATH_COMPONENTS}-component limit"
        )


def _dotfile_rejected(path_str: str) -> ValueError:
    return ValueError(
        f'Dotfile rejected: "{path_str}" — filenames starting with "." are not allowed'
    )


def assert_inside_boundary(path_str: str, boundary: Path) -> Path:
    """Return resolved path if inside boundary; raise ValueError otherwise.

    Hardened (PKT-P1 T8):
    - Uses os.path.realpath() to resolve all symlinks before comparison.
    - Does not reject symlinks itself: file_write and file_read call
      assert_no_symlink(..., root=boundary) separately, on the unresolved path, before
      this check; with root= it probes nothing outside the boundary, so the
      "Path traversal rejected" refusal below is the only answer an out-of-boundary
      path gets.
    - Rejects dotfiles: the final component that names something starts with '.',
      however it is spelled ('.env', '.env/', './.env/.'), or the resolved path's
      final component does (a symlink whose target is a dotfile). Dot-directories
      in the middle of a path are not rejected.
    - Rejects paths inside ~/.openclaw/** (OpenClaw agent workspaces).
    - Rejects, before any filesystem call, a path over MAX_PATH_BYTES or with more than
      MAX_PATH_COMPONENTS components (F1, 2026-11-26).

    Mirrors the TS logic: resolve path_str against boundary (so relative paths
    are anchored to the workspace, not to CWD), then verify the resolved path
    starts with the boundary prefix.  Absolute paths that escape the boundary
    (e.g. /etc/passwd) and sibling-prefix attacks (workspace-evil/) are both
    caught by the `+ os.sep` check.
    """
    _assert_path_bounded(path_str)
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


def _is_symlink(path: Path, operation: str) -> bool:
    """path.is_symlink(), failing closed when the component cannot be inspected.

    Python 3.12's is_symlink() swallows only ENOENT/ENOTDIR/EBADF/ELOOP from lstat
    and re-raises the rest (EACCES under a directory the bridge user cannot search,
    e.g. "/root/.ssh/id_rsa"); 3.13+ returns False instead. Callers catch only
    ValueError, so any OSError becomes one: a component that cannot be inspected
    cannot be shown not to be a symlink.
    """
    try:
        return path.is_symlink()
    except OSError as exc:
        reason = exc.strerror or str(exc) or type(exc).__name__
        raise ValueError(f'Path not inspectable on {operation}: "{path}" ({reason})') from exc


def _at_or_below(path_str: str, root_str: str) -> bool:
    """True if path_str is root_str or lies below it (both already realpath'd)."""
    return path_str == root_str or path_str.startswith(root_str.rstrip(os.sep) + os.sep)


def _entries_at_or_below(path: Path, root_real: str):
    """Yield, top-down, each component of the unresolved absolute ``path`` that names an
    entry inside the root: one looked up in a directory that resolves at or below
    ``root_real``.

    Never yielded: the prefix (components looked up in an ancestor of the root, or
    anywhere else outside it, e.g. macOS /tmp -> /private/tmp, or the root's own
    entry when the root is itself a symlink), and '..' (resolved by the kernel, never
    a symlink). Only realpath() runs on the containing directories; it is non-strict,
    so nothing here raises for a component outside the root.

    The containing directory's real path is carried from step to step (linear, F1):
    '..' takes its dirname, as realpath() and the kernel do; an in-root entry is
    resumed only after the caller found it is not a symlink, so its real path is
    parent_real/part; only an out-of-root step calls realpath().
    """
    parent = Path(path.anchor)
    parent_real = os.path.realpath(parent)
    for part in path.parts[1:]:
        entry = parent / part
        if part == os.pardir:
            parent_real = os.path.dirname(parent_real)
        elif _at_or_below(parent_real, root_real):
            yield entry
            parent_real = os.path.join(parent_real, part)
        else:
            parent_real = os.path.realpath(entry)
        parent = entry


def assert_no_symlink(
    resolved_path: Path, *, operation: str = "write", root: Path | None = None
) -> None:
    """Raise ValueError if the path is a symlink or cannot be inspected.

    Pass the UNRESOLVED path. Used on write paths (file_write) and read paths
    (file_read, since 2026-11-26) to prevent symlink-escape attacks; ``operation``
    only names the operation in the error message. Any component of the path that
    is a symlink is also checked, and an OSError while inspecting a component
    (target or ancestor) is a ValueError too.

    ``root`` (the workspace boundary) limits the check to the entries inside it
    (see _entries_at_or_below): a symlinked prefix above the root is accepted, an
    in-root symlink is still rejected, and nothing outside the root is lstat()ed, so
    an out-of-boundary path passes through to assert_inside_boundary's one generic
    refusal. ``root=None`` keeps the full walk up to the filesystem root.

    Before any filesystem call, a path over MAX_PATH_BYTES, or with more than
    MAX_PATH_COMPONENTS components beyond those of ``root``, is refused (F1).
    """
    base = _component_count(os.path.abspath(root)) if root is not None else 0
    _assert_path_bounded(os.fspath(resolved_path), base_components=base)
    if root is not None:
        path = Path(resolved_path)
        if not path.is_absolute():
            path = Path.cwd() / path
        for entry in _entries_at_or_below(path, os.path.realpath(root)):
            if _is_symlink(entry, operation):
                if entry == path:
                    raise ValueError(
                        f'Symlink rejected on {operation}: "{entry}" is a symbolic link'
                    )
                raise ValueError(
                    f'Symlink in path rejected on {operation}: "{entry}" is a symbolic link'
                )
        return
    # Check the target itself
    if _is_symlink(resolved_path, operation):
        raise ValueError(
            f'Symlink rejected on {operation}: "{resolved_path}" is a symbolic link'
        )
    # Check all ancestors up to the filesystem root
    current = resolved_path.parent
    while current != current.parent:
        if _is_symlink(current, operation):
            raise ValueError(
                f'Symlink in path rejected on {operation}: "{current}" is a symbolic link'
            )
        current = current.parent
