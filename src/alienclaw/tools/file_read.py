import math
import os
import stat
from pathlib import Path
from typing import Any

from ._boundary import assert_inside_boundary, assert_no_symlink, workspace_root
from .limits import MAX_TOOL_IO_BYTES as _MAX_BYTES
from .types import RunResult

# The checks in run() inspect paths, so the file can be swapped before the open:
# - O_NOFOLLOW: a final-component symlink swapped in fails (ELOOP) instead of being
#   followed;
# - O_NONBLOCK: a FIFO swapped in opens at once instead of blocking for a writer that
#   never comes; the fstat() below then refuses it (no effect on regular files);
# - where dir_fd works, every directory below the root is opened with
#   O_NOFOLLOW | O_DIRECTORY relative to the previous one (O_PATH on Linux, so it needs
#   only search permission, like a path lookup), so an ancestor swapped for a symlink
#   fails (ENOTDIR/ELOOP) too. Without dir_fd (e.g. Windows) the path itself is opened
#   and an ancestor swapped after the checks remains a known limitation.
_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_FILE_FLAGS = os.O_RDONLY | _NOFOLLOW | getattr(os, "O_NONBLOCK", 0)
_DIR_FLAGS = getattr(os, "O_PATH", os.O_RDONLY) | _NOFOLLOW | getattr(os, "O_DIRECTORY", 0)
_DIR_FD_WALK = (
    hasattr(os, "O_NOFOLLOW") and hasattr(os, "O_DIRECTORY") and os.open in os.supports_dir_fd
)


def _open_below_root(path: Path, root: Path) -> int:
    """Open resolved ``path`` (inside realpath'd ``root``) without following any symlink."""
    parts = path.relative_to(root).parts if _DIR_FD_WALK else ()
    if not parts:
        return os.open(path, _FILE_FLAGS)
    dir_fd = os.open(root, _DIR_FLAGS)
    try:
        for name in parts[:-1]:
            next_fd = os.open(name, _DIR_FLAGS, dir_fd=dir_fd)
            os.close(dir_fd)
            dir_fd = next_fd
        return os.open(parts[-1], _FILE_FLAGS, dir_fd=dir_fd)
    finally:
        os.close(dir_fd)


def run(inputs: dict[str, Any], params: dict[str, Any] = {}) -> RunResult:
    path_str = inputs.get("path", "")
    if not path_str:
        return RunResult(ok=False, error="Missing 'path' field", correctness=0.0)
    try:
        read_root = workspace_root()
        # Symlink guard inspects the UNRESOLVED path, but only the entries inside the
        # root (same as file_write): a symlinked prefix above the root is fine, and a
        # path outside the root is not probed, so it gets the boundary's one refusal.
        assert_no_symlink(read_root / path_str, operation="read", root=read_root)
        path = assert_inside_boundary(path_str, read_root)
    except ValueError as exc:
        return RunResult(ok=False, error=str(exc), correctness=0.0)
    if not path.exists():
        return RunResult(ok=False, error=f"File not found: {path_str}", correctness=0.0)
    if not path.is_file():
        return RunResult(ok=False, error=f"Not a file: {path_str}", correctness=0.0)
    try:
        fd = _open_below_root(path, Path(os.path.realpath(read_root)))
    except OSError as exc:
        return RunResult(ok=False, error=f"Read error: {exc}", correctness=0.0)
    error = None
    try:
        # What was opened is what counts: type and size come from the fd, not the path
        st = os.fstat(fd)
        size = st.st_size
        if not stat.S_ISREG(st.st_mode):
            error = f"Not a file: {path_str}"
        elif size > _MAX_BYTES:
            error = f"File exceeds 10 MiB ({size} bytes)"
        else:
            # Same decoding as Path.read_text(): text mode, universal newlines
            with open(fd, encoding="utf-8", errors="replace", closefd=False) as fh:
                raw = fh.read()
    except OSError as exc:
        error = f"Read error: {exc}"
    finally:
        os.close(fd)
    if error is not None:
        return RunResult(ok=False, error=error, correctness=0.0)

    all_lines = raw.splitlines(keepends=True)
    total_lines = len(all_lines)
    max_lines = max(1, int(params.get("max_lines", 100)))
    # skip_lines: 0-indexed per MSB spec (skip_lines=N skips exactly N lines, max 9)
    skip = max(0, min(9, int(params.get("skip_lines", 0))))
    # chunk_count: read file in N sequential chunks (tool_calls=N)
    chunk_count = max(1, min(5, int(params.get("chunk_count", 1))))

    available = all_lines[skip:]
    lines_per_chunk = max(1, math.ceil(len(available) / chunk_count))
    result_lines: list[str] = []
    for chunk_idx in range(chunk_count):
        start = chunk_idx * lines_per_chunk
        end = start + lines_per_chunk
        result_lines.extend(available[start:end])

    # Apply max_lines limit after chunking
    result_lines = result_lines[:max_lines]
    content = "".join(result_lines)

    lines_returned = len(result_lines)
    # Graded correctness: fraction of total file lines returned
    correctness = min(1.0, lines_returned / total_lines) if total_lines > 0 else 1.0

    return RunResult(
        ok=True,
        output={
            "path": str(path),
            "content": content,
            "encoding": "utf-8",
            "sizeBytes": size,
        },
        tool_calls=chunk_count,
        correctness=correctness,
    )
