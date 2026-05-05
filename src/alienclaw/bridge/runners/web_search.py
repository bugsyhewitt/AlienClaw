import urllib.parse
import urllib.request
import json
from typing import Any
from .types import RunResult

_TIMEOUT_S = 20


def run(inputs: dict[str, Any]) -> RunResult:
    query = inputs.get("query", inputs.get("task", ""))
    if not query:
        return RunResult(ok=False, error="Missing 'query' field", correctness=0.0)
    num_results = min(int(inputs.get("num_results", 5)), 10)
    encoded = urllib.parse.quote_plus(str(query))
    url = f"https://ddg-webapp-aagd.vercel.app/search?q={encoded}&max_results={num_results}"
    try:
        with urllib.request.urlopen(url, timeout=_TIMEOUT_S) as resp:
            data = json.loads(resp.read())
        results = [
            {"title": r.get("title", ""), "url": r.get("href", ""), "snippet": r.get("body", "")}
            for r in (data if isinstance(data, list) else data.get("results", []))
        ][:num_results]
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
