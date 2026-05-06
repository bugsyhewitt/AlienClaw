from pathlib import Path
from typing import Any
from .types import RunResult


def run(inputs: dict[str, Any], params: dict[str, Any] = {}) -> RunResult:
    path_str = inputs.get("path", "")
    content = inputs.get("content", "")
    if not path_str:
        return RunResult(ok=False, error="Missing 'path' field", correctness=0.0)
    if content is None:
        return RunResult(ok=False, error="Missing 'content' field", correctness=0.0)
    # repeat_count: write content N times (mod5_plus1 → 1-5). Makes bytes_written vary.
    repeat_count = max(1, min(5, int(params.get("repeat_count", 1))))
    path = Path(path_str)
    repeated = (str(content) + "\n") * repeat_count
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(repeated, encoding="utf-8")
    except OSError as exc:
        return RunResult(ok=False, error=f"Write error: {exc}", correctness=0.0)
    return RunResult(
        ok=True,
        output={"path": str(path), "bytes_written": len(repeated.encode("utf-8")), "repeat_count": repeat_count},
        correctness=1.0,
    )
