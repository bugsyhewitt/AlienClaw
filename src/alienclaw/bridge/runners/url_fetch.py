import urllib.request
import urllib.error
from typing import Any
from .types import RunResult

_TIMEOUT_S = 30
_MAX_RESPONSE_BYTES = 2 * 1024 * 1024


def run(inputs: dict[str, Any], params: dict[str, Any] = {}) -> RunResult:
    url = inputs.get("url", "")
    if not url:
        return RunResult(ok=False, error="Missing 'url' field", correctness=0.0)
    include_headers = bool(params.get("include_headers", False))
    method = str(inputs.get("method", "GET")).upper()
    headers = inputs.get("headers", {}) or {}
    body_data = inputs.get("body")
    encoded_body = str(body_data).encode() if body_data is not None else None
    req = urllib.request.Request(url, data=encoded_body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
            status = resp.status
            raw = resp.read(_MAX_RESPONSE_BYTES)
            response_headers = dict(resp.headers)
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
    output: dict[str, Any] = {"url": url, "method": method, "status_code": status, "content": content}
    if include_headers:
        output["headers"] = response_headers
    return RunResult(ok=True, output=output, correctness=1.0)
