import re
from typing import Any
from .types import RunResult

# search_text MSB output contract (seed/msb/search_text.msb) caps text body at 10 MB.
from .limits import MAX_TOOL_IO_BYTES as _MAX_TEXT_BYTES


def run(inputs: dict[str, Any], params: dict[str, Any] = {}) -> RunResult:
    text = inputs.get("text", inputs.get("content", ""))
    pattern = inputs.get("pattern", inputs.get("query", ""))
    if not text:
        return RunResult(ok=False, error="Missing 'text' or 'content' field", correctness=0.0)
    if not pattern:
        return RunResult(ok=False, error="Missing 'pattern' or 'query' field", correctness=0.0)
    # MSB: FAILURE MODES — text body exceeds 10 MB must return FAILURE, not silently truncate.
    if isinstance(text, str) and len(text.encode("utf-8")) > _MAX_TEXT_BYTES:
        return RunResult(
            ok=False,
            error=f"Text body exceeds 10 MB limit ({len(text.encode('utf-8'))} bytes)",
            correctness=0.0,
        )
    flavor = inputs.get("flavor", "literal")
    # Backward-compat alias: existing callers pass `regex: True` to opt into regex mode.
    if bool(inputs.get("regex", False)):
        flavor = "regex"
    if flavor not in ("literal", "glob", "regex"):
        flavor = "literal"
    case_sensitive = bool(inputs.get("case_sensitive", False))
    max_results = max(1, int(params.get("max_results", 100)))
    # context_lines 1-10: directly used as surrounding lines count (capped at available lines)
    context_lines = max(0, min(10, int(params.get("context_lines", 1)) - 1))  # 1→0, 2→1, ... 10→9
    flags = 0 if case_sensitive else re.IGNORECASE
    try:
        if flavor == "literal":
            compiled = re.compile(re.escape(pattern), flags)
        elif flavor == "glob":
            # Convert glob to regex: *→.* ?→. .*? → literal.
            glob_re = "^" + re.escape(pattern).replace(r"\*", ".*").replace(r"\?", ".") + "$"
            compiled = re.compile(glob_re, flags)
        else:  # regex
            compiled = re.compile(pattern, flags)
        lines = text.splitlines()
        all_matches = []
        for i, line in enumerate(lines):
            m = compiled.search(line)
            if m:
                # MSB: matchText = matched substring only (m.group()).
                # MSB: lineNumber = 1-indexed line number within text.
                # MSB: startOffset/endOffset = m.start()/m.end() — LINE-relative
                # (per MSB convention: search_text matches are scoped per-line).
                match_entry: dict[str, Any] = {
                    "matchText": m.group(),
                    "lineNumber": i + 1,
                    "startOffset": m.start(),
                    "endOffset": m.end(),
                }
                if context_lines > 0:
                    before = lines[max(0, i - context_lines):i]
                    after = lines[i + 1:i + 1 + context_lines]
                    match_entry["contextBefore"] = before
                    match_entry["contextAfter"] = after
                all_matches.append(match_entry)
    except re.error as exc:
        return RunResult(ok=False, error=f"Regex error: {exc}", correctness=0.0)
    matches = all_matches[:max_results]
    truncated = len(all_matches) > len(matches)
    tool_calls = min(max_results, len(all_matches))
    return RunResult(
        ok=True,
        output={
            "pattern": pattern,
            "flavor": flavor,
            "caseSensitive": case_sensitive,
            "totalMatches": len(matches),
            "truncated": truncated,
            "matches": matches,
        },
        tool_calls=max(1, tool_calls),
        correctness=1.0,
    )