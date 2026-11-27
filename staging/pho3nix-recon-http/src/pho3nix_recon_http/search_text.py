import json
import os
import re
import signal
import subprocess
import sys
import threading
from typing import Any

from . import _scan
from ._inputs import InvalidInputError, int_param, str_input

# search_text MSB output contract caps text body at 10 MB.
from .limits import MAX_TOOL_IO_BYTES as _MAX_TEXT_BYTES
from .types import RunResult

# ReDoS guard: cap regex pattern length and enforce a per-execution timeout.
_MAX_PATTERN_LEN = 200   # characters; patterns longer than this are rejected
_REGEX_TIMEOUT_S = 5     # seconds per compile+search execution
_HAS_SIGALRM = hasattr(signal, "SIGALRM")
_TIMEOUT_MESSAGE = "search_text: regex execution exceeded 5-second budget"

# How the time budget is enforced (staged divergence; the reference uses SIGALRM only):
#
# - Main thread with SIGALRM: SIGALRM, as in the reference. The regex engine polls for
#   signals while it matches, so the alarm interrupts a runaway match.
# - Anywhere else (a Flask request thread, a Qt worker, Windows): signal.signal()
#   raises ValueError there, and nothing in-process can stop a runaway match: the
#   regex engine holds the GIL for the whole match (a watchdog thread never runs),
#   and only the main thread handles signals. So the scan runs in a child interpreter
#   (``python -I -S _scan.py``) that is killed at the deadline. Startup costs ~20 ms.
# - Exception, to skip that cost: a literal search runs in-process when
#   len(text) * len(pattern) is at most this many character comparisons (its worst
#   case; about 30 ms). Glob and regex can backtrack, so they always use the child.
_INLINE_LITERAL_BUDGET = 10_000_000


class _NoScanProcessError(RuntimeError):
    """The budget cannot be enforced here: no child interpreter is available."""


def _child_command() -> list[str]:
    script = _scan.__file__
    # A frozen app's sys.executable is the app itself, not a Python interpreter.
    if getattr(sys, "frozen", False) or not sys.executable or not os.path.isfile(script):
        raise _NoScanProcessError(
            "search_text: no Python interpreter to run a glob/regex search off the main "
            "thread with a time budget; call it from the main thread"
        )
    return [sys.executable, "-I", "-S", script]


def _scan_in_child(pattern: str, flavor: str, flags: int, text: str) -> list[tuple]:
    job = json.dumps({"pattern": pattern, "flavor": flavor, "flags": flags})
    payload = job.encode("ascii") + b"\n" + text.encode("utf-8", "surrogatepass")
    try:
        proc = subprocess.run(
            _child_command(), input=payload, capture_output=True,
            timeout=_REGEX_TIMEOUT_S, check=False,
        )
    except subprocess.TimeoutExpired:  # subprocess.run has killed the child
        raise TimeoutError(_TIMEOUT_MESSAGE) from None
    except OSError as exc:
        raise _NoScanProcessError(f"search_text: cannot start the scan process ({exc})") from None
    try:
        if proc.returncode != 0:
            raise ValueError(f"exit status {proc.returncode}")
        out = json.loads(proc.stdout)
    except ValueError as exc:
        tail = proc.stderr.decode("utf-8", "replace").strip()[-200:]
        raise _NoScanProcessError(f"search_text: scan process failed ({exc}) {tail}".rstrip())
    if "regex_error" in out:
        raise re.error(out["regex_error"])
    return [tuple(hit) for hit in out["hits"]]


def _scan_without_alarm(pattern: str, flavor: str, flags: int, text: str):
    lines = text.splitlines()
    if flavor == "literal" and len(text) * len(pattern) <= _INLINE_LITERAL_BUDGET:
        return lines, _scan.scan(_scan.compile_pattern(pattern, flavor, flags), lines)
    return lines, _scan_in_child(pattern, flavor, flags, text)


def _scan_with_alarm(pattern: str, flavor: str, flags: int, text: str):
    def _alarm_handler(signum: int, frame: object) -> None:  # type: ignore[type-arg]
        raise TimeoutError(_TIMEOUT_MESSAGE)

    # PKT-1274 (corrective re-author of REJECTED PKT-1271): save the
    # previously-installed SIGALRM handler so we can restore it on exit.
    # signal.signal() mutates process-global state; clobbering the prior
    # handler (e.g. one installed by the parent test runner, debugger, or a
    # prior tool call) is a silent side-effect.  When `getsignal` returns
    # None (C / non-Python-installed handler), we fall back to SIG_DFL —
    # signal.signal(SIGALRM, None) raises TypeError and would otherwise
    # escape the `finally` block, replacing the tool's RunResult with an
    # unhandled exception (this is the exact hole the rejected patch hit).
    prev_handler: object = signal.getsignal(signal.SIGALRM)
    if prev_handler is None:
        prev_handler = signal.SIG_DFL
    try:
        signal.signal(signal.SIGALRM, _alarm_handler)
    except ValueError:  # main thread of a sub-interpreter: no signal handlers here
        return _scan_without_alarm(pattern, flavor, flags, text)
    signal.alarm(_REGEX_TIMEOUT_S)
    try:
        compiled = _scan.compile_pattern(pattern, flavor, flags)
        lines = text.splitlines()
        return lines, _scan.scan(compiled, lines)
    finally:
        signal.alarm(0)  # cancel the alarm regardless of outcome
        # PKT-1274: restore the previously-installed SIGALRM handler.
        try:
            signal.signal(signal.SIGALRM, prev_handler)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            # Defensive: if the saved handler is somehow invalid, fall
            # back to SIG_DFL so we never leave a stale closure
            # installed.
            signal.signal(signal.SIGALRM, signal.SIG_DFL)


def run(inputs: dict[str, Any], params: dict[str, Any] = {}) -> RunResult:
    text = inputs.get("text", inputs.get("content", ""))
    pattern = inputs.get("pattern", inputs.get("query", ""))
    if not text:
        return RunResult(ok=False, error="Missing 'text' or 'content' field", correctness=0.0)
    if not pattern:
        return RunResult(ok=False, error="Missing 'pattern' or 'query' field", correctness=0.0)
    try:
        text = str_input(text, "text")
        pattern = str_input(pattern, "pattern")
    except InvalidInputError as exc:
        return RunResult(ok=False, error=str(exc), correctness=0.0)
    # MSB: FAILURE MODES — text body exceeds 10 MB must return FAILURE, not silently truncate.
    # surrogatepass: a lone surrogate (JSON "\ud800") is counted, not raised on.
    text_bytes = len(text.encode("utf-8", "surrogatepass"))
    if text_bytes > _MAX_TEXT_BYTES:
        return RunResult(
            ok=False,
            error=f"Text body exceeds 10 MB limit ({text_bytes} bytes)",
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
    try:
        max_results = max(1, int_param(params, "max_results", 100))
        # Production path: decode_params always sets context_lines from genome or
        # field.default=1. Literal fallback=1 mirrors field.default; only fires on direct
        # no-params calls.
        context_lines = max(1, min(10, int_param(params, "context_lines", 1)))
    except InvalidInputError as exc:
        return RunResult(ok=False, error=str(exc), correctness=0.0)
    flags = 0 if case_sensitive else re.IGNORECASE

    try:
        if _HAS_SIGALRM and threading.current_thread() is threading.main_thread():
            lines, hits = _scan_with_alarm(pattern, flavor, flags, text)
        else:
            lines, hits = _scan_without_alarm(pattern, flavor, flags, text)
    except re.error as exc:
        return RunResult(ok=False, error=f"Regex error: {exc}", correctness=0.0)
    except (TimeoutError, _NoScanProcessError) as exc:
        return RunResult(ok=False, error=str(exc), correctness=0.0)

    all_matches = []
    for i, start, end in hits:
        # MSB: matchText = matched substring only (m.group()).
        # MSB: lineNumber = 1-indexed line number within text.
        # MSB: startOffset/endOffset = m.start()/m.end() — LINE-relative
        # (per MSB convention: search_text matches are scoped per-line).
        match_entry: dict[str, Any] = {
            "matchText": lines[i][start:end],
            "lineNumber": i + 1,
            "startOffset": start,
            "endOffset": end,
        }
        if context_lines > 0:
            match_entry["contextBefore"] = lines[max(0, i - context_lines):i]
            match_entry["contextAfter"] = lines[i + 1:i + 1 + context_lines]
        all_matches.append(match_entry)
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
