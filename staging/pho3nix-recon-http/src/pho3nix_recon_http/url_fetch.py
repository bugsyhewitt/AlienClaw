import urllib.error
import urllib.request
from typing import Any

from agent_tool_sandbox.pinning import build_pinned_opener, resolve_and_validate
from agent_tool_sandbox.ssrf_guard import SsrfBlockedError

from ._inputs import InvalidInputError, headers_input, int_param
from .types import RunResult

_TIMEOUT_S = 30
_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
# field_count: 1=url only, 2=+statusCode, 3=+content, 4=+contentLength, 5=+contentType
_FIELDS = ["url", "statusCode", "content", "contentLength", "contentType"]


def run(inputs: dict[str, Any], params: dict[str, Any] = {}) -> RunResult:
    url = inputs.get("url", "")
    if not url:
        return RunResult(ok=False, error="Missing 'url' field", correctness=0.0)
    # SSRF core guard, resolving the name ONCE, and an opener pinned to the addresses
    # that passed: see http_get.py. Fetch the canonical URL the guard vetted; output
    # `url` stays the caller's input and `fetched_url` reports what was requested.
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
        content_preview = max(1, min(10, int_param(params, "content_preview", 2)))
        # request_count: make N sequential requests per attempt; every urlopen
        # counts toward tool_calls, so retries cost fitness.
        request_count = max(1, min(5, int_param(params, "request_count", 1)))
        headers = headers_input(inputs.get("headers", {}))
        method = str(inputs.get("method", "GET")).upper()
        body_data = inputs.get("body")
        try:
            encoded_body = str(body_data).encode() if body_data is not None else None
        except UnicodeEncodeError as exc:  # a lone surrogate, e.g. from JSON "\ud800"
            raise InvalidInputError(
                f"Invalid 'body': not encodable as UTF-8 ({exc.reason})"
            ) from None
    except InvalidInputError as exc:
        return RunResult(ok=False, error=str(exc), correctness=0.0)

    # Transient retry loop — same fatal-vs-transient split as http_get.py.
    last_error: str | None = None
    total_tool_calls = 0
    for _attempt in range(max_attempts):
        status = 0
        content = ""
        content_type = ""
        transient_failure = False
        for _ in range(request_count):
            req = urllib.request.Request(
                fetched_url, data=encoded_body, headers=headers, method=method
            )
            try:
                with opener.open(req, timeout=_TIMEOUT_S) as resp:
                    status = resp.status
                    raw = resp.read(_MAX_RESPONSE_BYTES)
                    content_bytes = len(raw)
                    content_type = resp.headers.get("Content-Type", "")
                    try:
                        content = raw.decode("utf-8")
                    except UnicodeDecodeError:
                        content = raw.decode("latin-1")
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
                last_error = f"Fetch failed: {exc}"
                transient_failure = True
                break
            total_tool_calls += 1
        if not transient_failure:
            # content_preview 1-10: exactly N lines of content in "preview" (or all if shorter)
            preview_lines = content.splitlines()[:content_preview]
            output: dict[str, Any] = {}
            if field_count >= 1:
                output["url"] = url
            output["fetched_url"] = fetched_url  # the canonical URL requested; always present
            if field_count >= 2:
                output["statusCode"] = status
            if field_count >= 3:
                output["content"] = content
            if field_count >= 4:
                output["contentLength"] = content_bytes
            if field_count >= 5:
                output["contentType"] = content_type
            # always included; varies by content_preview param
            output["preview"] = "\n".join(preview_lines)
            return RunResult(ok=True, output=output, tool_calls=total_tool_calls, correctness=1.0)

    return RunResult(
        ok=False,
        error=f"Failed after {max_attempts} attempts: {last_error}",
        output={},
        tool_calls=total_tool_calls,
        correctness=0.0,
    )
