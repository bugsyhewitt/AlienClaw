import urllib.request
import urllib.error
from typing import Any
from .types import RunResult

_TIMEOUT_S = 30
_MAX_RESPONSE_BYTES = 2 * 1024 * 1024


def run(inputs: dict[str, Any]) -> RunResult:
    url = inputs.get("url", "")
    if not url:
        return RunResult(ok=False, error="Missing 'url' field", correctness=0.0)
    method = str(inputs.get("method", "GET")).upper()
    headers = inputs.get("headers", {}) or {}
    body_data = inputs.get("body")
    encoded_body = str(body_data).encode() if body_data is not None else None
    req = urllib.request.Request(url, data=encoded_body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
            status = resp.status
            raw = resp.read(_MAX_RESPONSE_BYTES)
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
    return RunResult(
        ok=True,
        output={"url": url, "method": method, "status_code": status, "content": content},
        correctness=1.0,
    )
