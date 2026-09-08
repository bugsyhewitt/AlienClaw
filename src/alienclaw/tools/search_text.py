import re
import signal
from typing import Any
from .types import RunResult

# search_text MSB output contract (seed/msb/search_text.msb) caps text body at 10 MB.
from .limits import MAX_TOOL_IO_BYTES as _MAX_TEXT_BYTES

# ReDoS guard: cap regex pattern length and enforce a per-execution timeout.
_MAX_PATTERN_LEN = 200   # characters; patterns longer than this are rejected
_REGEX_TIMEOUT_S = 5     # seconds per compile+search execution (SIGALRM; Unix only)
_HAS_SIGALRM = hasattr(signal, "SIGALRM")


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
    # ReDoS guard: reject patterns that exceed the length cap
    if len(pattern) > _MAX_PATTERN_LEN:
        return RunResult(
            ok=False,
            error=f"Pattern too long: {len(pattern)} chars exceeds limit of {_MAX_PATTERN_LEN}",
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
    # Production path: decode_params always sets context_lines from genome or field.default=1.
    # Literal fallback=1 mirrors field.default; only fires on direct no-params calls.
    context_lines = max(1, min(10, int(params.get("context_lines", 1))))
    flags = 0 if case_sensitive else re.IGNORECASE

    # ReDoS guard: wrap compile + search in a SIGALRM timeout (Unix only)
    def _alarm_handler(signum: int, frame: object) -> None:  # type: ignore[type-arg]
        raise TimeoutError("search_text: regex execution exceeded 5-second budget")

    if _HAS_SIGALRM:
        signal.signal(signal.SIGALRM, _alarm_handler)
        signal.alarm(_REGEX_TIMEOUT_S)

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
    except TimeoutError as exc:
        return RunResult(ok=False, error=str(exc), correctness=0.0)
    finally:
        if _HAS_SIGALRM:
            signal.alarm(0)  # cancel the alarm regardless of outcome
    matches = all_matches[:max_results]
    truncated = len(all_matches) > len(matches)
    return RunResult(
        ok=True,
        output={
            "pattern": pattern,
            "flavor": flavor,
            "caseSensitive": case_sensitive,
            "totalMatches": len(all_matches),
            "truncated": truncated,
            "matches": matches,
        },
        tool_calls=1,
        correctness=1.0,
    )