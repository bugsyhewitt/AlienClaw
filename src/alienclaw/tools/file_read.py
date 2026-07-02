import math
import os
from pathlib import Path
from typing import Any
from .types import RunResult

_MAX_BYTES = 10 * 1024 * 1024  # 10 MiB (matches MSB LIMITATIONS "File size limit: 10MB per read")


def run(inputs: dict[str, Any], params: dict[str, Any] = {}) -> RunResult:
    path_str = inputs.get("path", "")
    if not path_str:
        return RunResult(ok=False, error="Missing 'path' field", correctness=0.0)
    path = Path(path_str)
    if not path.exists():
        return RunResult(ok=False, error=f"File not found: {path_str}", correctness=0.0)
    if not path.is_file():
        return RunResult(ok=False, error=f"Not a file: {path_str}", correctness=0.0)
    size = os.path.getsize(path)
    if size > _MAX_BYTES:
        return RunResult(ok=False, error=f"File exceeds 10 MiB ({size} bytes)", correctness=0.0)
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return RunResult(ok=False, error=f"Read error: {exc}", correctness=0.0)

    all_lines = raw.splitlines(keepends=True)
    total_lines = len(all_lines)
    max_lines = max(1, int(params.get("max_lines", 100)))
    # skip_lines: skip first N-1 lines (1→skip 0, 2→skip 1, ... 10→skip 9)
    skip = max(0, int(params.get("skip_lines", 1)) - 1)
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
