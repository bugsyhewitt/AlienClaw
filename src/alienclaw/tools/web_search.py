import os
import urllib.parse
import urllib.request
import urllib.error
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
    # max_attempts (slot 0): transient-retry budget per the MSB PARAMETER_SCHEMA.
    max_attempts = max(1, min(5, int(params.get("max_attempts", 1))))
    max_results = max(1, min(int(params.get("max_results", 5)), 10))
    num_results = max(1, min(int(inputs.get("num_results", max_results)), max_results))
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

    # Transient retry loop — same fatal-vs-transient split as http_get.py:
    # HTTPError is deterministic per URL (fail fast); everything else
    # (DNS, timeout, refused, bad JSON) retries up to max_attempts. Every
    # urlopen counts toward tool_calls, so retries cost fitness.
    last_error: str | None = None
    total_tool_calls = 0
    for _attempt in range(max_attempts):
        all_results: list[dict] = []
        pages_fetched = 0
        transient_failure = False
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
            except urllib.error.HTTPError as exc:
                total_tool_calls += 1
                return RunResult(
                    ok=False,
                    error=f"Web search unavailable: HTTP {exc.code}: {exc.reason}",
                    output={"query": query, "results": [], "pages_fetched": pages_fetched},
                    tool_calls=total_tool_calls,
                    correctness=0.0,
                )
            except Exception as exc:
                total_tool_calls += 1
                last_error = f"Web search unavailable: {exc}"
                transient_failure = True
                break
            total_tool_calls += 1
            pages_fetched += 1
        if not transient_failure:
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
                output={"query": query, "result_count": len(unique_results), "results": unique_results, "pages_fetched": pages_fetched},
                tool_calls=total_tool_calls,
                correctness=correctness,
            )

    return RunResult(
        ok=False,
        error=f"Failed after {max_attempts} attempts: {last_error}",
        output={"query": query, "results": []},
        tool_calls=total_tool_calls,
        correctness=0.0,
    )
