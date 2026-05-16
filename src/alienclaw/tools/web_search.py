import os
import urllib.parse
import urllib.request
import json
from typing import Any
from .types import RunResult

_TIMEOUT_S = 20

# No default backend — operators must configure ALIENCLAW_SEARCH_URL.
# See seed/msb/web_search.msb for configuration guidance.
# The diagnostics audit and tests set this to a stub server URL.
_SEARCH_BASE: str = ""


def run(inputs: dict[str, Any], params: dict[str, Any] = {}) -> RunResult:
    query = inputs.get("query", inputs.get("task", ""))
    if not query:
        return RunResult(ok=False, error="Missing 'query' field", correctness=0.0)
    max_results = max(1, min(int(params.get("max_results", 5)), 10))
    num_results = min(int(inputs.get("num_results", max_results)), max_results)
    # page_count: fetch N pages of results (pagination); tool_calls=N
    page_count = max(1, min(3, int(params.get("page_count", 1))))
    search_base = os.environ.get("ALIENCLAW_SEARCH_URL", _SEARCH_BASE).strip()

    if not search_base:
        return RunResult(
            ok=False,
            error="web_search backend not configured. Set ALIENCLAW_SEARCH_URL env var.",
            output={"query": query, "results": []},
            tool_calls=1,
            correctness=0.0,
        )

    encoded = urllib.parse.quote_plus(str(query))
    all_results: list[dict] = []
    for page in range(page_count):
        offset = page * num_results
        url = f"{search_base}?q={encoded}&max_results={num_results}&offset={offset}"
        try:
            with urllib.request.urlopen(url, timeout=_TIMEOUT_S) as resp:
                data = json.loads(resp.read())
            page_results = [
                {"title": r.get("title", ""), "url": r.get("href", ""), "snippet": r.get("body", "")}
                for r in (data if isinstance(data, list) else data.get("results", []))
            ][:num_results]
            all_results.extend(page_results)
        except Exception as exc:
            return RunResult(
                ok=False,
                error=f"Web search unavailable: {exc}",
                output={"query": query, "results": [], "pages_fetched": page},
                tool_calls=page + 1,
                correctness=0.0,
            )
    # Deduplicate by URL, preserving order
    seen: set[str] = set()
    unique_results: list[dict] = []
    for r in all_results:
        if r["url"] not in seen:
            seen.add(r["url"])
            unique_results.append(r)
    unique_results = unique_results[:max_results]
    correctness = 1.0 if unique_results else 0.5
    return RunResult(
        ok=True,
        output={"query": query, "result_count": len(unique_results), "results": unique_results, "pages_fetched": page_count},
        tool_calls=page_count,
        correctness=correctness,
    )
