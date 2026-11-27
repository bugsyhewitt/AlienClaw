"""pho3nix-recon-http: recon request tools for an agent (http_get, url_fetch, web_search,
search_text). The two fetch tools go through the agent_tool_sandbox SSRF guard.

Every tool is ``run(inputs: dict, params: dict = {}) -> RunResult``. ``TOOL_REGISTRY``
maps tool names to those functions.
"""
from typing import Any, Callable

from . import http_get, search_text, url_fetch, web_search
from .types import RunResult

RunnerFn = Callable[[dict[str, Any]], RunResult]

TOOL_REGISTRY: dict[str, RunnerFn] = {
    "http_get": http_get.run,
    "search_text": search_text.run,
    "url_fetch": url_fetch.run,
    "web_search": web_search.run,
}

__all__ = ["RunResult", "RunnerFn", "TOOL_REGISTRY"]

__version__ = "0.0.0.dev0"
