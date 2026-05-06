"""Tests for web_search runner with new no-default-backend behavior."""
from __future__ import annotations

import json
import os
from unittest.mock import patch

import pytest

from alienclaw.bridge.runners.web_search import run as web_search_run


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
