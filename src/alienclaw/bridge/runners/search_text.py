import re
from typing import Any
from .types import RunResult


def run(inputs: dict[str, Any]) -> RunResult:
    text = inputs.get("text", inputs.get("content", ""))
    pattern = inputs.get("pattern", inputs.get("query", ""))
    if not text:
        return RunResult(ok=False, error="Missing 'text' or 'content' field", correctness=0.0)
    if not pattern:
        return RunResult(ok=False, error="Missing 'pattern' or 'query' field", correctness=0.0)
    use_regex = bool(inputs.get("regex", False))
    case_sensitive = bool(inputs.get("case_sensitive", False))
    flags = 0 if case_sensitive else re.IGNORECASE
    try:
        if use_regex:
            compiled = re.compile(pattern, flags)
        else:
            compiled = re.compile(re.escape(pattern), flags)
        matches = [
            {"line": i + 1, "text": line, "match": m.group()}
            for i, line in enumerate(text.splitlines())
            for m in [compiled.search(line)]
            if m
        ]
    except re.error as exc:
        return RunResult(ok=False, error=f"Regex error: {exc}", correctness=0.0)
    return RunResult(
        ok=True,
        output={"pattern": pattern, "match_count": len(matches), "matches": matches},
        correctness=1.0,
    )
