import re
from typing import Any
from .types import RunResult


def run(inputs: dict[str, Any], params: dict[str, Any] = {}) -> RunResult:
    text = inputs.get("text", inputs.get("content", ""))
    pattern = inputs.get("pattern", inputs.get("query", ""))
    if not text:
        return RunResult(ok=False, error="Missing 'text' or 'content' field", correctness=0.0)
    if not pattern:
        return RunResult(ok=False, error="Missing 'pattern' or 'query' field", correctness=0.0)
    use_regex = bool(inputs.get("regex", False))
    case_sensitive = bool(inputs.get("case_sensitive", False))
    max_results = max(1, int(params.get("max_results", 100)))
    # context_lines 1-10: directly used as surrounding lines count (capped at available lines)
    context_lines = max(0, min(10, int(params.get("context_lines", 1)) - 1))  # 1→0, 2→1, ... 10→9
    flags = 0 if case_sensitive else re.IGNORECASE
    try:
        compiled = re.compile(pattern if use_regex else re.escape(pattern), flags)
        lines = text.splitlines()
        all_matches = []
        for i, line in enumerate(lines):
            m = compiled.search(line)
            if m:
                match_entry: dict[str, Any] = {"line": i + 1, "text": line, "match": m.group()}
                if context_lines > 0:
                    before = lines[max(0, i - context_lines):i]
                    after = lines[i + 1:i + 1 + context_lines]
                    match_entry["context_before"] = before
                    match_entry["context_after"] = after
                all_matches.append(match_entry)
    except re.error as exc:
        return RunResult(ok=False, error=f"Regex error: {exc}", correctness=0.0)
    matches = all_matches[:max_results]
    tool_calls = min(max_results, len(all_matches))
    return RunResult(
        ok=True,
        output={"pattern": pattern, "match_count": len(matches), "matches": matches},
        tool_calls=max(1, tool_calls),
        correctness=1.0,
    )
