"""Tests for the web_search runner (no default backend).

Ported from the in-tree test_web_search_backend.py. The in-tree TestWithStub class
ran a real StubServer on 127.0.0.1; here ``urllib.request.urlopen`` is replaced by
an in-memory backend that records every URL it is asked for. The backend URL is a
dummy (``http://stub.test/search``) set with monkeypatch; nothing reads a real one.
"""
from __future__ import annotations

import io
import json
import urllib.error
from unittest.mock import MagicMock, patch

import pytest

from pho3nix_recon_http.web_search import SEARCH_URL_ENV
from pho3nix_recon_http.web_search import run as web_search_run

_STUB = "http://stub.test/search"
_RESULTS = [
    {"title": f"Result {i}", "href": f"https://example.com/{i}", "body": f"Body {i}"}
    for i in range(1, 16)
]
_RESULTS_JSON = json.dumps(_RESULTS).encode()


class FakeBackend:
    """Stands in for urllib.request.urlopen: canned status + body, every URL recorded."""

    def __init__(self, status: int = 200, body: bytes = _RESULTS_JSON) -> None:
        self.status = status
        self.body = body
        self.urls: list[str] = []

    def __call__(self, url, timeout=None):
        self.urls.append(url)
        if self.status >= 400:
            raise urllib.error.HTTPError(url, self.status, "Internal Error", {}, io.BytesIO())
        return _make_response(self.body, self.status)


def _make_response(body: bytes, status: int = 200, content_type: str = "application/json"):
    resp = MagicMock()
    resp.status = status
    resp.read.return_value = body
    resp.headers = {"Content-Type": content_type}
    resp.__enter__ = MagicMock(return_value=resp)
    resp.__exit__ = MagicMock(return_value=False)
    return resp


@pytest.fixture
def stub_backend(monkeypatch):
    backend = FakeBackend()
    monkeypatch.setenv(SEARCH_URL_ENV, _STUB)
    monkeypatch.setattr("urllib.request.urlopen", backend)
    return backend


class TestNoBackend:
    def test_missing_url_returns_failure(self):
        result = web_search_run({"query": "test"})
        assert not result.ok
        assert "not configured" in result.error.lower()
        assert result.correctness == 0.0

    def test_missing_url_returns_tool_calls_1(self):
        result = web_search_run({"query": "test"})
        assert result.tool_calls == 1

    def test_empty_url_returns_failure(self, monkeypatch):
        monkeypatch.setenv(SEARCH_URL_ENV, "")
        result = web_search_run({"query": "test"})
        assert not result.ok

    def test_whitespace_url_is_not_configured(self, monkeypatch):
        monkeypatch.setenv(SEARCH_URL_ENV, "   ")
        result = web_search_run({"query": "test"})
        assert not result.ok
        assert result.error == f"web_search backend not configured. Set {SEARCH_URL_ENV} env var."


class TestWithStub:
    def test_stub_url_returns_results(self, stub_backend):
        result = web_search_run({"query": "test", "num_results": 5})
        assert result.ok
        assert len(result.output["results"]) == 5
        assert result.correctness == 1.0

    def test_stub_url_page_count_sets_tool_calls(self, stub_backend):
        result = web_search_run({"query": "test"}, {"page_count": 2})
        assert result.tool_calls == 2

    def test_stub_failure_returns_error(self, stub_backend):
        stub_backend.status = 500
        result = web_search_run({"query": "test"})
        assert not result.ok

    def test_missing_query_still_fails(self, stub_backend):
        result = web_search_run({})
        assert not result.ok
        assert "query" in result.error.lower()
        assert stub_backend.urls == []

    def test_negative_num_results_clamped_to_one(self, stub_backend):
        result = web_search_run({"query": "test", "num_results": -3})
        assert result.ok
        assert len(result.output["results"]) == 1

    def test_zero_num_results_clamped_to_one(self, stub_backend):
        result = web_search_run({"query": "test", "num_results": 0})
        assert result.ok
        assert len(result.output["results"]) == 1

    def test_sensitivity_audit_still_works(self, stub_backend):
        r1 = web_search_run({"query": "test"}, {"page_count": 1})
        r3 = web_search_run({"query": "test"}, {"page_count": 3})
        assert r1.tool_calls != r3.tool_calls, "tool_calls must vary with page_count"
        assert r1.ok and r3.ok

    def test_request_urls_encode_query_and_paginate(self, stub_backend):
        """No in-tree counterpart: pins the backend request URL format."""
        web_search_run({"query": "a b&c=d", "num_results": 3}, {"page_count": 3})
        assert stub_backend.urls == [
            f"{_STUB}?q=a+b%26c%3Dd&max_results=3&offset={offset}" for offset in (0, 3, 6)
        ]

    def test_duplicate_urls_across_pages_are_dropped(self, stub_backend):
        """No in-tree counterpart: every page returns the same results, so dedup keeps one."""
        result = web_search_run({"query": "test", "num_results": 2}, {"page_count": 3})
        assert result.ok
        assert [r["url"] for r in result.output["results"]] == [
            "https://example.com/1", "https://example.com/2",
        ]
        assert result.output["pages_fetched"] == 3


class TestMalformedResponse:
    """Degrade gracefully on any JSON body that is not a list-of-dicts."""

    def _run(self, body_value):
        resp = _make_response(json.dumps(body_value).encode())
        with patch("urllib.request.urlopen", return_value=resp):
            with patch.dict("os.environ", {SEARCH_URL_ENV: _STUB}):
                return web_search_run({"query": "test"}, {"max_attempts": 1, "page_count": 1})

    def _assert_degraded(self, result) -> None:
        assert result.ok is True, f"expected ok=True, got error={result.error!r}"
        assert result.output["results"] == []
        assert result.correctness == 0.5

    @pytest.mark.parametrize("body", [
        None, "hello", 42, True, ["a", "b"], [1, 2, 3],
        {"results": None}, {"results": "not a list"}, {"results": 42},
    ], ids=repr)
    def test_degraded_body(self, body):
        self._assert_degraded(self._run(body))
