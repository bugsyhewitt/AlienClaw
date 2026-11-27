"""Filesystem-boundary jail for agent file tools.

The caller owns the boundary: every function takes the boundary root (and any
extra denied roots) explicitly. Nothing here reads environment variables or
assumes a home-directory layout.

Recommended call order (mirrors the reference file-write and file-read tools):

    assert_no_symlink(boundary / path_str)          # inspect the UNRESOLVED path
    target = assert_inside_boundary(path_str, boundary)

Use the same order for a read path (``assert_no_symlink(..., operation="read")``
only changes the message wording), and open the target with ``O_NOFOLLOW`` where
the platform has it.
"""
from __future__ import annotations

import os
from collections.abc import Iterable
from pathlib import Path


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


def assert_inside_boundary(
    path_str: str,
    boundary: Path,
    *,
    deny_roots: Iterable[str | os.PathLike[str]] = (),
) -> Path:
    """Return resolved path if inside boundary; raise ValueError otherwise.

    - Uses os.path.realpath() to resolve all symlinks before comparison.
    - Does not reject symlinks itself (write paths call assert_no_symlink separately).
    - Rejects dotfiles: the final component that names something starts with '.',
      however it is spelled ('.env', '.env/', './.env/.'), or the resolved path's
      final component does (a symlink whose target is a dotfile). Dot-directories
      in the middle of a path are not rejected.
    - Rejects paths inside any of ``deny_roots`` (resolved with realpath), even
      when those roots sit inside the boundary.

    Resolves path_str against boundary (so relative paths are anchored to the
    boundary, not to CWD), then verifies the resolved path starts with the
    boundary prefix.  Absolute paths that escape the boundary (e.g. /etc/passwd)
    and sibling-prefix attacks (workspace-evil/) are both caught by the
    `+ os.sep` check.
    """
    if isinstance(deny_roots, (str, os.PathLike)):
        deny_roots = (deny_roots,)

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

    # Reject anything inside a caller-supplied denied root
    for root in deny_roots:
        root_real = os.path.realpath(os.fspath(root))
        if resolved_str.startswith(root_real + sep) or resolved_str == root_real:
            raise ValueError(
                f'Denied root: "{path_str}" targets a denied directory'
            )

    return resolved


def assert_no_symlink(resolved_path: Path, *, operation: str = "write") -> None:
    """Raise ValueError if the path is a symlink.

    Pass the UNRESOLVED path. Used on write and read paths to prevent
    symlink-escape attacks; ``operation`` only names the operation in the error
    message. Any component of the path that is a symlink is also checked.
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
