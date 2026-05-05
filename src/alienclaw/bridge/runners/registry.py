from typing import Callable, Any
from .types import RunResult
from . import compute, extract_json, file_read, file_write, http_get, search_text, url_fetch, web_search

RunnerFn = Callable[[dict[str, Any]], RunResult]

RUNNER_REGISTRY: dict[str, RunnerFn] = {
    "compute": compute.run,
    "extract_json": extract_json.run,
    "file_read": file_read.run,
    "file_write": file_write.run,
    "http_get": http_get.run,
    "search_text": search_text.run,
    "url_fetch": url_fetch.run,
    "web_search": web_search.run,
}
