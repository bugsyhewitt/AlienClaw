import os
from pathlib import Path
from typing import Any
from .types import RunResult

_MAX_BYTES = 1 * 1024 * 1024  # 1 MiB


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
        return RunResult(ok=False, error=f"File exceeds 1 MiB ({size} bytes)", correctness=0.0)
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return RunResult(ok=False, error=f"Read error: {exc}", correctness=0.0)
    max_lines = max(1, int(params.get("max_lines", 100)))
    lines = content.splitlines(keepends=True)
    if len(lines) > max_lines:
        content = "".join(lines[:max_lines])
    return RunResult(
        ok=True,
        output={"path": str(path), "content": content, "size_bytes": size, "max_lines": max_lines},
        correctness=1.0,
    )
