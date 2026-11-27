"""Filesystem-boundary jail for agent file tools.

The caller owns the boundary: every function takes the boundary root (and any
extra denied roots) explicitly. Nothing here reads environment variables or
assumes a home-directory layout.

Recommended call order (mirrors the reference file-write and file-read tools):

    assert_no_symlink(boundary / path_str, root=boundary)   # the UNRESOLVED path
    target = assert_inside_boundary(path_str, boundary)

Use the same order for a read path (``assert_no_symlink(..., operation="read")``
only changes the message wording), and open the target with
``O_NOFOLLOW | O_NONBLOCK`` where the platform has it, then check with ``fstat``
that what was opened is a regular file (and take its size from the descriptor).
With ``root=`` the symlink gate checks only the entries inside the boundary, so a
symlinked prefix above it is accepted and an out-of-boundary path is not probed:
its only refusal is ``assert_inside_boundary``'s generic one.
"""
from __future__ import annotations

import os
from collections.abc import Iterable, Iterator
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
    deny_roots: str | os.PathLike[str] | Iterable[str | os.PathLike[str]] = (),
) -> Path:
    """Return resolved path if inside boundary; raise ValueError otherwise.

    - Uses os.path.realpath() to resolve all symlinks before comparison.
    - Does not reject symlinks itself: read and write paths call
      assert_no_symlink(..., root=boundary) separately, on the unresolved path, before
      this check; with root= it probes nothing outside the boundary, so the
      "Path traversal rejected" refusal below is the only answer an out-of-boundary
      path gets.
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


def _is_symlink(path: Path, operation: str) -> bool:
    """path.is_symlink(), failing closed when the component cannot be inspected.

    Python 3.12's is_symlink() swallows only ENOENT/ENOTDIR/EBADF/ELOOP from lstat
    and re-raises the rest (EACCES under a directory the caller cannot search,
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


def _entries_at_or_below(path: Path, root_real: str) -> Iterator[Path]:
    """Yield, top-down, each component of the unresolved absolute ``path`` that names an
    entry inside the root: one looked up in a directory that resolves at or below
    ``root_real``.

    Never yielded: the prefix (components looked up in an ancestor of the root, or
    anywhere else outside it, e.g. macOS /tmp -> /private/tmp, or the root's own
    entry when the root is itself a symlink), and '..' (resolved by the kernel, never
    a symlink). Only realpath() runs on the containing directories; it is non-strict,
    so nothing here raises for a component outside the root.
    """
    parent = Path(path.anchor)
    for part in path.parts[1:]:
        entry = parent / part
        if part != os.pardir and _at_or_below(os.path.realpath(parent), root_real):
            yield entry
        parent = entry


def assert_no_symlink(
    resolved_path: Path, *, operation: str = "write", root: Path | None = None
) -> None:
    """Raise ValueError if the path is a symlink or cannot be inspected.

    Pass the UNRESOLVED path. Used on write and read paths to prevent
    symlink-escape attacks; ``operation`` only names the operation in the error
    message. Any component of the path that is a symlink is also checked, and an
    OSError while inspecting a component (target or ancestor) is a ValueError too.

    ``root`` (the boundary) limits the check to the entries inside it (see
    _entries_at_or_below): a symlinked prefix above the root is accepted, an
    in-root symlink is still rejected, and nothing outside the root is lstat()ed, so
    an out-of-boundary path passes through to assert_inside_boundary's one generic
    refusal. ``root=None`` keeps the full walk up to the filesystem root.
    """
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
