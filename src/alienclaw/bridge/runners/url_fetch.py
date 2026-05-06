import urllib.request
import urllib.error
from typing import Any
from .types import RunResult

_TIMEOUT_S = 30
_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
# field_count: 1=url only, 2=+status_code, 3=+content, 4=+content_length, 5=+content_type
_FIELDS = ["url", "status_code", "content", "content_length", "content_type"]


def run(inputs: dict[str, Any], params: dict[str, Any] = {}) -> RunResult:
    url = inputs.get("url", "")
    if not url:
        return RunResult(ok=False, error="Missing 'url' field", correctness=0.0)
    field_count = max(1, min(5, int(params.get("field_count", 3))))
    method = str(inputs.get("method", "GET")).upper()
    headers = inputs.get("headers", {}) or {}
    body_data = inputs.get("body")
    encoded_body = str(body_data).encode() if body_data is not None else None
    req = urllib.request.Request(url, data=encoded_body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
            status = resp.status
            raw = resp.read(_MAX_RESPONSE_BYTES)
            content_type = resp.headers.get("Content-Type", "")
            try:
                content = raw.decode("utf-8")
            except UnicodeDecodeError:
                content = raw.decode("latin-1")
    except urllib.error.HTTPError as exc:
        return RunResult(
            ok=False,
            error=f"HTTP {exc.code}: {exc.reason}",
            output={"status_code": exc.code},
            correctness=0.0,
        )
    except Exception as exc:
        return RunResult(ok=False, error=f"Fetch failed: {exc}", correctness=0.0)
    # content_preview 1-10: exactly N lines of content in "preview" field (or all if shorter)
    content_preview = max(1, int(params.get("content_preview", 2)))
    preview_lines = content.splitlines()[:content_preview]
    output: dict[str, Any] = {}
    if field_count >= 1: output["url"] = url
    if field_count >= 2: output["status_code"] = status
    if field_count >= 3: output["content"] = content
    if field_count >= 4: output["content_length"] = len(content)
    if field_count >= 5: output["content_type"] = content_type
    output["preview"] = "\n".join(preview_lines)  # always included; varies by content_preview param
    return RunResult(ok=True, output=output, correctness=1.0)
