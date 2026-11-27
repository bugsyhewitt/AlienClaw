import urllib.error
import urllib.request
from typing import Any

from agent_tool_sandbox.pinning import build_pinned_opener, resolve_and_validate
from agent_tool_sandbox.ssrf_guard import SsrfBlockedError

from ._inputs import InvalidInputError, headers_input, int_param
from .types import RunResult

_TIMEOUT_S = 30
_MAX_RESPONSE_BYTES = 1 * 1024 * 1024


def run(inputs: dict[str, Any], params: dict[str, Any] = {}) -> RunResult:
    url = inputs.get("url", "")
    if not url:
        return RunResult(ok=False, error="Missing 'url' field", correctness=0.0)
    # SSRF core guard (scheme allowlist + IP block on every resolved address; no host
    # allowlist), resolving the name ONCE. The opener is pinned to the addresses that
    # passed: no second resolution at connect time (DNS rebinding), no env proxy, no
    # redirects, and a Host header must name the URL's own authority.
    # Fetch the canonical URL the guard vetted; output `url` stays the caller's input
    # and `fetched_url` reports what was requested.
    try:
        target = resolve_and_validate(url)
        opener = build_pinned_opener(target)
    except SsrfBlockedError as exc:
        return RunResult(ok=False, error=str(exc), correctness=0.0)
    fetched_url = target.canonical_url
    try:
        # max_attempts (slot 0): transient-retry budget per the MSB PARAMETER_SCHEMA.
        max_attempts = max(1, min(5, int_param(params, "max_attempts", 1)))
        field_count = max(1, min(5, int_param(params, "field_count", 3)))
        body_preview = max(1, min(10, int_param(params, "body_preview", 5)))
        # request_count: make N sequential GET requests per attempt; every urlopen
        # counts toward tool_calls, so retries cost fitness.
        request_count = max(1, min(5, int_param(params, "request_count", 1)))
        headers = headers_input(inputs.get("headers", {}))
    except InvalidInputError as exc:
        return RunResult(ok=False, error=str(exc), correctness=0.0)

    # Transient retry loop: HTTPError (4xx/5xx) is deterministic per URL and
    # fails fast; anything else (DNS, timeout, refused) retries up to
    # max_attempts. HTTPError subclasses URLError, so it is caught first.
    last_error: str | None = None
    total_tool_calls = 0
    for _attempt in range(max_attempts):
        status = 0
        body = ""
        content_type = ""
        truncated = False
        transient_failure = False
        for _ in range(request_count):
            req = urllib.request.Request(fetched_url, headers=headers, method="GET")
            try:
                with opener.open(req, timeout=_TIMEOUT_S) as resp:
                    status = resp.status
                    # If Content-Length is advertised and exceeds the cap, mark truncated
                    # before reading (we still read only up to the cap to bound memory).
                    try:
                        declared_length = int(resp.headers.get("Content-Length", "0"))
                    except ValueError:
                        declared_length = 0
                    if declared_length > _MAX_RESPONSE_BYTES:
                        truncated = True
                    raw = resp.read(_MAX_RESPONSE_BYTES)
                    body_bytes = len(raw)
                    body = raw.decode("utf-8", errors="replace")
                    content_type = resp.headers.get("Content-Type", "")
            except SsrfBlockedError as exc:
                total_tool_calls += 1
                return RunResult(
                    ok=False, error=str(exc), tool_calls=total_tool_calls, correctness=0.0
                )
            except urllib.error.HTTPError as exc:
                total_tool_calls += 1
                return RunResult(
                    ok=False,
                    error=f"HTTP {exc.code}: {exc.reason}",
                    output={"statusCode": exc.code},
                    tool_calls=total_tool_calls,
                    correctness=0.0,
                )
            except Exception as exc:
                total_tool_calls += 1
                last_error = f"Request failed: {exc}"
                transient_failure = True
                break
            total_tool_calls += 1
        if not transient_failure:
            # field_count: 1=url only, 2=+statusCode, 3=+content, 4=+bytesReturned, 5=+contentType
            # Keys align with the MSB OUTPUT CONTRACT: url, statusCode, content,
            # bytesReturned, contentType, truncated. body_preview is an extension kept
            # for backwards compat with callers using the legacy param name.
            output: dict[str, Any] = {}
            if field_count >= 1:
                output["url"] = url
            output["fetched_url"] = fetched_url  # the canonical URL requested; always present
            if field_count >= 2:
                output["statusCode"] = status
            if field_count >= 3:
                output["content"] = body
            if field_count >= 4:
                output["bytesReturned"] = body_bytes
            if field_count >= 5:
                output["contentType"] = content_type
            output["truncated"] = truncated
            # body_preview: first N lines of body as a "preview" field (distinct for each 1-10)
            body_lines = body.splitlines()
            output["body_preview"] = "\n".join(body_lines[:body_preview])
            return RunResult(ok=True, output=output, tool_calls=total_tool_calls, correctness=1.0)

    return RunResult(
        ok=False,
        error=f"Failed after {max_attempts} attempts: {last_error}",
        output={},
        tool_calls=total_tool_calls,
        correctness=0.0,
    )
