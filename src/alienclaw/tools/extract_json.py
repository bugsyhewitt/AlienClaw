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
    # result_format: 1=value, 2=+type, 3=+found (mod3_plus1 -> 1-3)
    result_format = max(1, min(3, int(params.get("result_format", 2))))
    # extraction_passes: re-parse and re-extract N times (verification); tool_calls = N
    extraction_passes = max(1, min(5, int(params.get("extraction_passes", 1))))
    # inputKeys: top-level JSON object keys (sorted); empty list for non-objects
    input_keys: list[str] = sorted(parsed.keys()) if isinstance(parsed, dict) else []
    # MSB OUTPUT CONTRACT (seed/msb/extract_json.msb):
    #   { extracted: { <path>: { value, type, found } }, inputKeys: [string] }
    extracted: dict[str, Any] = {}
    if path:
        try:
            value = _get_path(parsed, path)
            for _ in range(extraction_passes - 1):
                _get_path(json.loads(raw), path)
            entry: dict[str, Any] = {}
            if result_format >= 1: entry["value"] = value
            if result_format >= 2: entry["type"] = type(value).__name__
            if result_format >= 3: entry["found"] = True
            extracted[path] = entry
        except KeyError as exc:
            return RunResult(ok=False, error=f"Path not found: {exc}", correctness=0.0, tool_calls=extraction_passes)
    return RunResult(
        ok=True,
        output={"extracted": extracted, "inputKeys": input_keys},
        tool_calls=extraction_passes,
        correctness=1.0,
    )
