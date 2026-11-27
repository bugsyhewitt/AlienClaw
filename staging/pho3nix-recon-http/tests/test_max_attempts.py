"""Tests for the HTTP tool runners' max_attempts retry behavior.

Ported from the in-tree test_max_attempts.py (packet 110). HTTP tools (url_fetch,
http_get, web_search) MUST honor the max_attempts param (slot 0 in every MSB schema,
contract: "Maximum retry attempts on transient failure").

Retry semantics (unified across the 3 tools):
  - max_attempts (clamped 1..5): outer-loop retry budget
  - Transient failures (urllib.error.URLError — DNS / timeout / connection
    refused — plus ConnectionError, TimeoutError, OSError, json.JSONDecodeError
    for web_search): retried up to max_attempts
  - HTTPError (4xx/5xx, a subclass of URLError): NOT retried — return
    immediately on the first occurrence (per MSB: "do not retry")
  - tool_calls = attempt_count * request_count (cumulative across all attempts)

These tests patch urllib at the module level (or urllib.request.urlopen) to drive
deterministic transient / fatal / success responses. The in-tree web_search cases
that ran a real StubServer use an in-memory urlopen instead. No network calls.
"""
from __future__ import annotations

import json
import urllib.error
from io import BytesIO
from unittest import mock
from unittest.mock import MagicMock, patch

import pytest

from pho3nix_recon_http import http_get as http_get_mod
from pho3nix_recon_http import url_fetch as url_fetch_mod
from pho3nix_recon_http import web_search as web_search_mod
from pho3nix_recon_http.web_search import SEARCH_URL_ENV

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def _make_response(body: bytes, status: int = 200, content_type: str = "text/plain") -> MagicMock:
    """Build a context-manager mock that pretends to be urllib's response."""
    resp = MagicMock()
    resp.status = status
    resp.read.return_value = body
    resp.headers = {"Content-Type": content_type}
    resp.__enter__ = MagicMock(return_value=resp)
    resp.__exit__ = MagicMock(return_value=False)
    return resp


def _raise_url_error(msg: str = "Name or service not known") -> urllib.error.URLError:
    return urllib.error.URLError(msg)


def _bypass_ssrf_and_link_opener(mod):
    """Bypass the SSRF guard and bridge opener.open() → urllib.request.urlopen so the
    mock-urllib tests keep their call_count assertions intact."""
    fake_opener = MagicMock()
    fake_opener.open.side_effect = (
        lambda req, timeout=None: mod.urllib.request.urlopen(req, timeout=timeout)
    )
    name = mod.__name__
    with mock.patch(f"{name}.assert_safe_fetch_url", lambda u: u):
        with mock.patch(f"{name}.build_no_redirect_opener", return_value=fake_opener):
            yield


# ─────────────────────────────────────────────────────────────────────────────
# url_fetch.py — max_attempts retry behavior
# ─────────────────────────────────────────────────────────────────────────────


class TestUrlFetchMaxAttempts:
    """url_fetch.run() honors params['max_attempts'] for transient retries."""

    @pytest.fixture(autouse=True)
    def _bypass(self):
        yield from _bypass_ssrf_and_link_opener(url_fetch_mod)

    def test_default_max_attempts_is_one_preserves_current_behavior(self):
        resp = _make_response(b"hello", status=200, content_type="text/plain")
        with patch.object(url_fetch_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.request.urlopen.return_value = resp
            result = url_fetch_mod.run({"url": "http://example.test/"})
        assert result.ok
        assert result.tool_calls == 1
        assert mock_urllib.request.urlopen.call_count == 1

    def test_max_attempts_three_succeeds_on_third_attempt(self):
        success_resp = _make_response(b"final content", status=200, content_type="text/plain")
        with patch.object(url_fetch_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.error = urllib.error
            mock_urllib.request.urlopen.side_effect = [
                _raise_url_error("connection refused"),
                _raise_url_error("connection refused"),
                success_resp,
            ]
            result = url_fetch_mod.run({"url": "http://example.test/"}, {"max_attempts": 3})
        assert result.ok
        assert result.tool_calls == 3
        assert mock_urllib.request.urlopen.call_count == 3

    def test_max_attempts_three_always_fails_returns_error(self):
        with patch.object(url_fetch_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.error = urllib.error
            mock_urllib.request.urlopen.side_effect = _raise_url_error("timeout")
            result = url_fetch_mod.run({"url": "http://example.test/"}, {"max_attempts": 3})
        assert not result.ok
        assert result.tool_calls == 3
        assert "3 attempts" in result.error
        assert mock_urllib.request.urlopen.call_count == 3

    def test_max_attempts_clamped_above_five(self):
        with patch.object(url_fetch_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.error = urllib.error
            mock_urllib.request.urlopen.side_effect = _raise_url_error("network down")
            result = url_fetch_mod.run({"url": "http://example.test/"}, {"max_attempts": 99})
        assert not result.ok
        assert result.tool_calls == 5
        assert mock_urllib.request.urlopen.call_count == 5

    def test_max_attempts_clamped_below_one(self):
        resp = _make_response(b"ok", status=200, content_type="text/plain")
        with patch.object(url_fetch_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.request.urlopen.return_value = resp
            result = url_fetch_mod.run({"url": "http://example.test/"}, {"max_attempts": 0})
        assert result.ok
        assert result.tool_calls == 1
        assert mock_urllib.request.urlopen.call_count == 1

    def test_http_error_4xx_is_fatal_no_retry(self):
        http_err = urllib.error.HTTPError(
            "http://example.test/missing", 404, "Not Found", {}, BytesIO(b"")
        )
        with patch.object(url_fetch_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.error = urllib.error
            mock_urllib.request.urlopen.side_effect = http_err
            result = url_fetch_mod.run(
                {"url": "http://example.test/missing"}, {"max_attempts": 5}
            )
        assert not result.ok
        assert "HTTP 404" in result.error
        assert result.tool_calls == 1
        assert mock_urllib.request.urlopen.call_count == 1

    def test_max_attempts_with_request_count(self):
        """max_attempts=2 × request_count=2: the inner loop breaks on the first
        transient, so total tool_calls = max_attempts (not max_attempts × request_count)."""
        with patch.object(url_fetch_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.error = urllib.error
            mock_urllib.request.urlopen.side_effect = _raise_url_error("refused")
            result = url_fetch_mod.run(
                {"url": "http://example.test/"}, {"max_attempts": 2, "request_count": 2}
            )
        assert not result.ok
        assert result.tool_calls == 2
        assert mock_urllib.request.urlopen.call_count == 2


# ─────────────────────────────────────────────────────────────────────────────
# http_get.py — max_attempts retry behavior
# ─────────────────────────────────────────────────────────────────────────────


class TestHttpGetMaxAttempts:
    """http_get.run() honors params['max_attempts'] for transient retries."""

    @pytest.fixture(autouse=True)
    def _bypass(self):
        yield from _bypass_ssrf_and_link_opener(http_get_mod)

    def test_default_max_attempts_is_one_preserves_current_behavior(self):
        resp = _make_response(b"hello", status=200, content_type="text/plain")
        with patch.object(http_get_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.request.urlopen.return_value = resp
            result = http_get_mod.run({"url": "http://example.test/"})
        assert result.ok
        assert result.tool_calls == 1
        assert mock_urllib.request.urlopen.call_count == 1

    def test_max_attempts_three_succeeds_on_third_attempt(self):
        success_resp = _make_response(b"final", status=200, content_type="text/plain")
        with patch.object(http_get_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.error = urllib.error
            mock_urllib.request.urlopen.side_effect = [
                _raise_url_error("connection reset"),
                _raise_url_error("connection reset"),
                success_resp,
            ]
            result = http_get_mod.run({"url": "http://example.test/"}, {"max_attempts": 3})
        assert result.ok
        assert result.tool_calls == 3
        assert mock_urllib.request.urlopen.call_count == 3

    def test_max_attempts_three_always_fails(self):
        with patch.object(http_get_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.error = urllib.error
            mock_urllib.request.urlopen.side_effect = _raise_url_error("timeout")
            result = http_get_mod.run({"url": "http://example.test/"}, {"max_attempts": 3})
        assert not result.ok
        assert result.tool_calls == 3
        assert "3 attempts" in result.error

    def test_http_error_500_is_fatal_no_retry(self):
        http_err = urllib.error.HTTPError(
            "http://example.test/", 500, "Internal Server Error", {}, BytesIO(b"")
        )
        with patch.object(http_get_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.error = urllib.error
            mock_urllib.request.urlopen.side_effect = http_err
            result = http_get_mod.run({"url": "http://example.test/"}, {"max_attempts": 5})
        assert not result.ok
        assert "HTTP 500" in result.error
        assert result.tool_calls == 1
        assert mock_urllib.request.urlopen.call_count == 1

    def test_max_attempts_clamped_above_five(self):
        with patch.object(http_get_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.error = urllib.error
            mock_urllib.request.urlopen.side_effect = _raise_url_error("network down")
            result = http_get_mod.run({"url": "http://example.test/"}, {"max_attempts": 42})
        assert not result.ok
        assert result.tool_calls == 5
        assert mock_urllib.request.urlopen.call_count == 5


# ─────────────────────────────────────────────────────────────────────────────
# web_search.py — max_attempts retry behavior
# ─────────────────────────────────────────────────────────────────────────────


_STUB = "http://stub.test/search"
_PAYLOAD = json.dumps([{"title": "r1", "href": "https://x/1", "body": "b1"}]).encode()


class TestWebSearchMaxAttempts:
    """web_search.run() honors params['max_attempts'] for transient retries.

    The "missing backend" case is a config error, NOT transient: it must not retry.
    """

    def test_default_max_attempts_is_one_preserves_current_behavior(self):
        with patch("urllib.request.urlopen", return_value=_make_response(_PAYLOAD)):
            with patch.dict("os.environ", {SEARCH_URL_ENV: _STUB}):
                result = web_search_mod.run({"query": "test"})
        assert result.ok
        assert result.tool_calls == 1

    def test_max_attempts_three_succeeds_on_third_attempt(self):
        call_count = {"n": 0}

        def fake_urlopen(url, timeout=None):
            call_count["n"] += 1
            if call_count["n"] <= 2:
                raise urllib.error.URLError("backend unreachable")
            return _make_response(_PAYLOAD)

        with patch.dict("os.environ", {SEARCH_URL_ENV: _STUB}):
            with patch("urllib.request.urlopen", side_effect=fake_urlopen):
                result = web_search_mod.run({"query": "test"}, {"max_attempts": 3})
        assert result.ok
        assert result.tool_calls == 3
        assert call_count["n"] == 3

    def test_max_attempts_three_always_fails(self):
        with patch("urllib.request.urlopen", side_effect=_raise_url_error("backend down")):
            with patch.dict("os.environ", {SEARCH_URL_ENV: _STUB}):
                result = web_search_mod.run({"query": "test"}, {"max_attempts": 3})
        assert not result.ok
        assert result.tool_calls == 3
        assert "3 attempts" in result.error

    def test_http_error_from_backend_is_fatal_no_retry(self):
        http_err = urllib.error.HTTPError(_STUB, 503, "Service Unavailable", {}, BytesIO(b""))
        with patch("urllib.request.urlopen", side_effect=http_err):
            with patch.dict("os.environ", {SEARCH_URL_ENV: _STUB}):
                result = web_search_mod.run({"query": "test"}, {"max_attempts": 5})
        assert not result.ok
        assert "503" in result.error
        assert result.tool_calls == 1

    def test_missing_backend_is_not_retried(self):
        result = web_search_mod.run({"query": "test"}, {"max_attempts": 5})
        assert not result.ok
        assert "not configured" in result.error.lower()
        assert result.tool_calls == 1

    def test_max_attempts_clamped_above_five(self):
        with patch("urllib.request.urlopen", side_effect=_raise_url_error("network down")):
            with patch.dict("os.environ", {SEARCH_URL_ENV: _STUB}):
                result = web_search_mod.run({"query": "test"}, {"max_attempts": 10})
        assert not result.ok
        assert result.tool_calls == 5

    def test_json_decode_error_is_retried_as_transient(self):
        bad_resp = _make_response(b"<html>not-valid-json</html>", content_type="text/html")
        with patch("urllib.request.urlopen", return_value=bad_resp) as mock_open:
            with patch.dict("os.environ", {SEARCH_URL_ENV: _STUB}):
                result = web_search_mod.run({"query": "test"}, {"max_attempts": 3})
        assert not result.ok
        assert result.tool_calls == 3
        assert "3 attempts" in result.error
        assert mock_open.call_count == 3
