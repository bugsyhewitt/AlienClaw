import urllib.request
import urllib.error
from typing import Any
from .types import RunResult

_TIMEOUT_S = 30
_MAX_RESPONSE_BYTES = 1 * 1024 * 1024


def run(inputs: dict[str, Any], params: dict[str, Any] = {}) -> RunResult:
    url = inputs.get("url", "")
    if not url:
        return RunResult(ok=False, error="Missing 'url' field", correctness=0.0)
    field_count = max(1, min(5, int(params.get("field_count", 3))))
    body_preview = max(1, min(10, int(params.get("body_preview", 5))))
    # request_count: make N sequential GET requests (reliability/freshness pattern); tool_calls=N
    request_count = max(1, min(5, int(params.get("request_count", 1))))
    headers = inputs.get("headers", {}) or {}
    status = 0
    body = ""
    content_type = ""
    truncated = False
    for i in range(request_count):
        req = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
                status = resp.status
                # If Content-Length is advertised and exceeds the cap, mark truncated
                # before reading (we still read only up to the cap to bound memory).
                try:
                    declared_length = int(resp.headers.get("Content-Length", "0"))
                except ValueError:
                    declared_length = 0
                if declared_length > _MAX_RESPONSE_BYTES:
                    truncated = True
                body = resp.read(_MAX_RESPONSE_BYTES).decode("utf-8", errors="replace")
                content_type = resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as exc:
            return RunResult(
                ok=False,
                error=f"HTTP {exc.code}: {exc.reason}",
                output={"statusCode": exc.code},
                tool_calls=i + 1,
                correctness=0.0,
            )
        except Exception as exc:
            return RunResult(ok=False, error=f"Request failed: {exc}", tool_calls=i + 1, correctness=0.0)
    # field_count: 1=url only, 2=+statusCode, 3=+content, 4=+bytesReturned, 5=+contentType
    # Keys align with MSB spec (seed/msb/http_get.msb OUTPUT CONTRACT): url, statusCode,
    # content, bytesReturned, contentType, truncated. body_preview is an extension kept
    # for backwards compat with callers using the legacy param name.
    output: dict[str, Any] = {}
    if field_count >= 1: output["url"] = url
    if field_count >= 2: output["statusCode"] = status
    if field_count >= 3: output["content"] = body
    if field_count >= 4: output["bytesReturned"] = len(body)
    if field_count >= 5: output["contentType"] = content_type
    output["truncated"] = truncated
    # body_preview: include first N lines of body as a "preview" field (distinct for each 1-10)
    body_lines = body.splitlines()
    output["body_preview"] = "\n".join(body_lines[:body_preview])
    return RunResult(ok=True, output=output, tool_calls=request_count, correctness=1.0)