import json
import re
from typing import Any
from .types import RunResult


def _get_path(obj: Any, path: str) -> Any:
    parts = re.split(r"\.|(?=\[)", path)
    cur = obj
    for part in parts:
        if not part:
            continue
        m = re.fullmatch(r"\[(\d+)\]", part)
        if m:
            idx = int(m.group(1))
            if not isinstance(cur, list) or idx >= len(cur):
                raise KeyError(f"Index {idx} out of range")
            cur = cur[idx]
        else:
            if not isinstance(cur, dict) or part not in cur:
                raise KeyError(f"Key '{part}' not found")
            cur = cur[part]
    return cur


def run(inputs: dict[str, Any], params: dict[str, Any] = {}) -> RunResult:
    raw = inputs.get("json", inputs.get("input", ""))
    path = inputs.get("path", "")
    if not raw:
        return RunResult(ok=False, error="Missing 'json' or 'input' field", correctness=0.0)
    if len(str(raw).encode()) > 10 * 1024 * 1024:
        return RunResult(ok=False, error="Input exceeds 10 MB limit", correctness=0.0)
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        return RunResult(ok=False, error=f"JSON parse error: {exc}", correctness=0.0)
    if not path:
        return RunResult(ok=True, output={"value": parsed, "type": type(parsed).__name__}, correctness=1.0)
    include_type = bool(params.get("include_type", True))
    try:
        value = _get_path(parsed, path)
    except KeyError as exc:
        return RunResult(ok=False, error=f"Path not found: {exc}", correctness=0.0)
    output: dict[str, Any] = {"path": path, "value": value}
    if include_type:
        output["type"] = type(value).__name__
    return RunResult(ok=True, output=output, correctness=1.0)
