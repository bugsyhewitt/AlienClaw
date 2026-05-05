from pathlib import Path
from typing import Any
from .types import RunResult


def run(inputs: dict[str, Any]) -> RunResult:
    path_str = inputs.get("path", "")
    content = inputs.get("content", "")
    if not path_str:
        return RunResult(ok=False, error="Missing 'path' field", correctness=0.0)
    if content is None:
        return RunResult(ok=False, error="Missing 'content' field", correctness=0.0)
    path = Path(path_str)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(str(content), encoding="utf-8")
    except OSError as exc:
        return RunResult(ok=False, error=f"Write error: {exc}", correctness=0.0)
    return RunResult(
        ok=True,
        output={"path": str(path), "bytes_written": len(str(content).encode("utf-8"))},
        correctness=1.0,
    )
