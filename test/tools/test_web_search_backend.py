"""Tests for web_search runner with new no-default-backend behavior."""
from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import pytest

from alienclaw.tools.web_search import run as web_search_run


_RESULTS = [
    {"title": f"Result {i}", "href": f"https://example.com/{i}", "body": f"Body {i}"}
    for i in range(1, 16)
]
_RESULTS_JSON = json.dumps(_RESULTS).encode()


class TestNoBackend:
    def test_missing_url_returns_failure(self):
        env = {k: v for k, v in os.environ.items() if k != "ALIENCLAW_SEARCH_URL"}
        with patch.dict(os.environ, env, clear=True):
            result = web_search_run({"query": "test"})
        assert not result.ok
        assert "not configured" in result.error.lower()
        assert result.correctness == 0.0

    def test_missing_url_returns_tool_calls_1(self):
        env = {k: v for k, v in os.environ.items() if k != "ALIENCLAW_SEARCH_URL"}
        with patch.dict(os.environ, env, clear=True):
            result = web_search_run({"query": "test"})
        assert result.tool_calls == 1

    def test_empty_url_returns_failure(self):
        with patch.dict(os.environ, {"ALIENCLAW_SEARCH_URL": ""}):
            result = web_search_run({"query": "test"})
        assert not result.ok


class TestWithStub:
    def test_stub_url_returns_results(self, tmp_path):
        from alienclaw.diagnostics.stub_servers import StubServer
        canned = {"/search": (200, _RESULTS_JSON, "application/json")}
        with StubServer(canned) as stub_url:
            with patch.dict(os.environ, {"ALIENCLAW_SEARCH_URL": stub_url + "/search"}):
                result = web_search_run({"query": "test", "num_results": 5})
        assert result.ok
        assert len(result.output["results"]) == 5
        assert result.correctness == 1.0

    def test_stub_url_page_count_sets_tool_calls(self):
        from alienclaw.diagnostics.stub_servers import StubServer
        canned = {"/search": (200, _RESULTS_JSON, "application/json")}
        with StubServer(canned) as stub_url:
            with patch.dict(os.environ, {"ALIENCLAW_SEARCH_URL": stub_url + "/search"}):
                result = web_search_run({"query": "test"}, {"page_count": 2})
        assert result.tool_calls == 2

    def test_stub_failure_returns_error(self):
        from alienclaw.diagnostics.stub_servers import StubServer
        canned = {"/search": (500, b"Internal Error", "text/plain")}
        with StubServer(canned) as stub_url:
            with patch.dict(os.environ, {"ALIENCLAW_SEARCH_URL": stub_url + "/search"}):
                result = web_search_run({"query": "test"})
        assert not result.ok

    def test_missing_query_still_fails(self):
        from alienclaw.diagnostics.stub_servers import StubServer
        canned = {"/search": (200, _RESULTS_JSON, "application/json")}
        with StubServer(canned) as stub_url:
            with patch.dict(os.environ, {"ALIENCLAW_SEARCH_URL": stub_url + "/search"}):
                result = web_search_run({})
        assert not result.ok
        assert "query" in result.error.lower()

    def test_negative_num_results_clamped_to_one(self):
        """Negative num_results must not produce wrong slice or negative URL params."""
        from alienclaw.diagnostics.stub_servers import StubServer
        canned = {"/search": (200, _RESULTS_JSON, "application/json")}
        with StubServer(canned) as stub_url:
            with patch.dict(os.environ, {"ALIENCLAW_SEARCH_URL": stub_url + "/search"}):
                result = web_search_run({"query": "test", "num_results": -3})
        assert result.ok
        assert len(result.output["results"]) == 1  # clamped to 1

    def test_zero_num_results_clamped_to_one(self):
        """Zero num_results must clamp to 1, not produce an empty-or-wrong result."""
        from alienclaw.diagnostics.stub_servers import StubServer
        canned = {"/search": (200, _RESULTS_JSON, "application/json")}
        with StubServer(canned) as stub_url:
            with patch.dict(os.environ, {"ALIENCLAW_SEARCH_URL": stub_url + "/search"}):
                result = web_search_run({"query": "test", "num_results": 0})
        assert result.ok
        assert len(result.output["results"]) == 1

    def test_sensitivity_audit_still_works(self):
        """Full sensitivity audit should still show tc>0 for web_search with stub."""
        from alienclaw.diagnostics.stub_servers import StubServer
        canned = {"/search": (200, _RESULTS_JSON, "application/json")}
        with StubServer(canned) as stub_url:
            with patch.dict(os.environ, {"ALIENCLAW_SEARCH_URL": stub_url + "/search"}):
                # Test the runner directly with two different page_counts
                r1 = web_search_run({"query": "test"}, {"page_count": 1})
                r3 = web_search_run({"query": "test"}, {"page_count": 3})
        assert r1.tool_calls != r3.tool_calls, "tool_calls must vary with page_count"
        assert r1.ok and r3.ok


def _make_response(body: bytes, status: int = 200, content_type: str = "application/json") -> MagicMock:
    resp = MagicMock()
    resp.status = status
    resp.read.return_value = body
    resp.headers = {"Content-Type": content_type}
    resp.__enter__ = MagicMock(return_value=resp)
    resp.__exit__ = MagicMock(return_value=False)
    return resp


class TestMalformedResponse:
    """Degrade gracefully on any JSON body that is not a list-of-dicts."""

    _STUB = "http://stub.test/search"

    def _run(self, body_value) -> object:
        body = json.dumps(body_value).encode()
        resp = _make_response(body)
        with patch("urllib.request.urlopen", return_value=resp):
            with patch.dict(os.environ, {"ALIENCLAW_SEARCH_URL": self._STUB}):
                return web_search_run({"query": "test"}, {"max_attempts": 1, "page_count": 1})

    def _assert_degraded(self, result) -> None:
        assert result.ok is True, f"expected ok=True, got ok={result.ok}, error={getattr(result, 'error', None)}"
        assert result.output["results"] == [], f"expected [], got {result.output['results']}"
        assert result.correctness == 0.5, f"expected 0.5, got {result.correctness}"

    def test_null_body(self):
        self._assert_degraded(self._run(None))

    def test_string_body(self):
        self._assert_degraded(self._run("hello"))

    def test_number_body(self):
        self._assert_degraded(self._run(42))

    def test_bool_body(self):
        self._assert_degraded(self._run(True))

    def test_list_of_strings(self):
        self._assert_degraded(self._run(["a", "b"]))

    def test_list_of_ints(self):
        self._assert_degraded(self._run([1, 2, 3]))

    def test_dict_with_null_results(self):
        self._assert_degraded(self._run({"results": None}))

    def test_dict_with_string_results(self):
        self._assert_degraded(self._run({"results": "not a list"}))

    def test_dict_with_int_results(self):
        self._assert_degraded(self._run({"results": 42}))
