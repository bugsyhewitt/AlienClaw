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
    headers = inputs.get("headers", {}) or {}
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
            status = resp.status
            body = resp.read(_MAX_RESPONSE_BYTES).decode("utf-8", errors="replace")
            content_type = resp.headers.get("Content-Type", "")
    except urllib.error.HTTPError as exc:
        return RunResult(
            ok=False,
            error=f"HTTP {exc.code}: {exc.reason}",
            output={"status_code": exc.code},
            correctness=0.0,
        )
    except Exception as exc:
        return RunResult(ok=False, error=f"Request failed: {exc}", correctness=0.0)
    # field_count: 1=url only, 2=+status_code, 3=+body, 4=+body_length, 5=+content_type
    output: dict[str, Any] = {}
    if field_count >= 1: output["url"] = url
    if field_count >= 2: output["status_code"] = status
    if field_count >= 3: output["body"] = body
    if field_count >= 4: output["body_length"] = len(body)
    if field_count >= 5: output["content_type"] = content_type
    # body_preview: include first N lines of body as a "preview" field (distinct for each 1-10)
    body_lines = body.splitlines()
    output["body_preview"] = "\n".join(body_lines[:body_preview])
    return RunResult(ok=True, output=output, correctness=1.0)
