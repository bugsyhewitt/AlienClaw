import math
import os
from typing import Any

from ._boundary import assert_inside_boundary, assert_no_symlink, workspace_root
from .limits import MAX_TOOL_IO_BYTES as _MAX_BYTES
from .types import RunResult

# O_NOFOLLOW (where the platform has it): a final-component symlink swapped in after
# the checks below makes the open fail (ELOOP) instead of being followed.
_OPEN_FLAGS = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)


def run(inputs: dict[str, Any], params: dict[str, Any] = {}) -> RunResult:
    path_str = inputs.get("path", "")
    if not path_str:
        return RunResult(ok=False, error="Missing 'path' field", correctness=0.0)
    try:
        read_root = workspace_root()
        # Symlink guard must inspect the UNRESOLVED path (same order as file_write)
        assert_no_symlink(read_root / path_str, operation="read")
        path = assert_inside_boundary(path_str, read_root)
    except ValueError as exc:
        return RunResult(ok=False, error=str(exc), correctness=0.0)
    if not path.exists():
        return RunResult(ok=False, error=f"File not found: {path_str}", correctness=0.0)
    if not path.is_file():
        return RunResult(ok=False, error=f"Not a file: {path_str}", correctness=0.0)
    size = os.path.getsize(path)
    if size > _MAX_BYTES:
        return RunResult(ok=False, error=f"File exceeds 10 MiB ({size} bytes)", correctness=0.0)
    try:
        fd = os.open(path, _OPEN_FLAGS)
        # Same decoding as Path.read_text(): text mode, universal newlines
        with open(fd, encoding="utf-8", errors="replace") as fh:
            raw = fh.read()
    except OSError as exc:
        return RunResult(ok=False, error=f"Read error: {exc}", correctness=0.0)

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
