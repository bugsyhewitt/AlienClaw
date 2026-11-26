"""Filesystem-boundary jail for agent file tools.

The caller owns the boundary: every function takes the boundary root (and any
extra denied roots) explicitly. Nothing here reads environment variables or
assumes a home-directory layout.

Recommended call order for a write path (mirrors the reference file-write tool):

    assert_no_symlink(boundary / path_str)          # inspect the UNRESOLVED path
    target = assert_inside_boundary(path_str, boundary)

For a read path, ``assert_inside_boundary`` alone.
"""
from __future__ import annotations

import os
from collections.abc import Iterable
from pathlib import Path


def assert_inside_boundary(
    path_str: str,
    boundary: Path,
    *,
    deny_roots: Iterable[str | os.PathLike[str]] = (),
) -> Path:
    """Return resolved path if inside boundary; raise ValueError otherwise.

    - Uses os.path.realpath() to resolve all symlinks before comparison.
    - Does not reject symlinks itself (write paths call assert_no_symlink separately).
    - Rejects dotfiles (final path component starting with '.').
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

    # Reject anything inside a caller-supplied denied root
    for root in deny_roots:
        root_real = os.path.realpath(os.fspath(root))
        if resolved_str.startswith(root_real + sep) or resolved_str == root_real:
            raise ValueError(
                f'Denied root: "{path_str}" targets a denied directory'
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
