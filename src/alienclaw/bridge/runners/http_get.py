import urllib.request
import urllib.error
from typing import Any
from .types import RunResult

_TIMEOUT_S = 30
_MAX_RESPONSE_BYTES = 1 * 1024 * 1024


def run(inputs: dict[str, Any]) -> RunResult:
    url = inputs.get("url", "")
    if not url:
        return RunResult(ok=False, error="Missing 'url' field", correctness=0.0)
    headers = inputs.get("headers", {}) or {}
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
            status = resp.status
            body = resp.read(_MAX_RESPONSE_BYTES).decode("utf-8", errors="replace")
            response_headers = dict(resp.headers)
    except urllib.error.HTTPError as exc:
        return RunResult(
            ok=False,
            error=f"HTTP {exc.code}: {exc.reason}",
            output={"status_code": exc.code},
            correctness=0.0,
        )
    except Exception as exc:
        return RunResult(ok=False, error=f"Request failed: {exc}", correctness=0.0)
    return RunResult(
        ok=True,
        output={"url": url, "status_code": status, "body": body, "headers": response_headers},
        correctness=1.0,
    )
