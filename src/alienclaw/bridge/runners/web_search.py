import os
import urllib.parse
import urllib.request
import json
from typing import Any
from .types import RunResult

_TIMEOUT_S = 20
# Allow test/audit environments to override the search URL so audits stay hermetic.
# Production: always uses the real DDG endpoint.
_SEARCH_BASE = os.environ.get(
    "ALIENCLAW_SEARCH_URL",
    "https://ddg-webapp-aagd.vercel.app/search",
)


def run(inputs: dict[str, Any], params: dict[str, Any] = {}) -> RunResult:
    query = inputs.get("query", inputs.get("task", ""))
    if not query:
        return RunResult(ok=False, error="Missing 'query' field", correctness=0.0)
    max_results = max(1, min(int(params.get("max_results", 5)), 10))
    num_results = min(int(inputs.get("num_results", max_results)), max_results)
    search_base = os.environ.get("ALIENCLAW_SEARCH_URL", _SEARCH_BASE)
    encoded = urllib.parse.quote_plus(str(query))
    url = f"{search_base}?q={encoded}&max_results={num_results}"
    try:
        with urllib.request.urlopen(url, timeout=_TIMEOUT_S) as resp:
            data = json.loads(resp.read())
        results = [
            {"title": r.get("title", ""), "url": r.get("href", ""), "snippet": r.get("body", "")}
            for r in (data if isinstance(data, list) else data.get("results", []))
        ][:max_results]
    except Exception as exc:
        return RunResult(
            ok=False,
            error=f"Web search unavailable: {exc}",
            output={"query": query, "results": []},
            correctness=0.0,
        )
    return RunResult(
        ok=True,
        output={"query": query, "result_count": len(results), "results": results},
        correctness=1.0 if results else 0.5,
    )
