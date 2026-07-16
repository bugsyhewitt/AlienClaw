"""Tests for HTTP tool runners' max_attempts retry behavior.

Packet 110: HTTP tools (url_fetch, http_get, web_search) MUST honor the
max_attempts genome param (slot 0 in every MSB schema, contract: "Maximum retry
attempts on transient failure"). Prior to packet 110 these tools silently
ignored the param — see packeting tester finding 109 for the discovery.

Retry semantics (unified across the 3 tools, mirroring compute.py):
  - max_attempts (clamped 1..5): outer-loop retry budget
  - Transient failures (urllib.error.URLError — DNS / timeout / connection
    refused — plus ConnectionError, TimeoutError, OSError, json.JSONDecodeError
    for web_search): retried up to max_attempts
  - HTTPError (4xx/5xx, a subclass of URLError): NOT retried — return
    immediately on the first occurrence (per MSB: "do not retry")
  - tool_calls = attempt_count * request_count (cumulative across all attempts)

These tests use unittest.mock.patch on urllib.request.urlopen to drive
deterministic transient / fatal / success responses — no real network calls.
"""
from __future__ import annotations

import json
import urllib.error
from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest

from alienclaw.tools import url_fetch as url_fetch_mod
from alienclaw.tools import http_get as http_get_mod
from alienclaw.tools import web_search as web_search_mod
from alienclaw.tools.types import RunResult


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


# ─────────────────────────────────────────────────────────────────────────────
# url_fetch.py — max_attempts retry behavior
# ─────────────────────────────────────────────────────────────────────────────


class TestUrlFetchMaxAttempts:
    """url_fetch.run() honors params['max_attempts'] for transient retries."""

    def test_default_max_attempts_is_one_preserves_current_behavior(self):
        """No max_attempts in params → exactly 1 attempt, same as before packet 110."""
        resp = _make_response(b"hello", status=200, content_type="text/plain")
        with patch.object(url_fetch_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.request.urlopen.return_value = resp
            result = url_fetch_mod.run({"url": "http://example.test/"})
        assert result.ok
        assert result.tool_calls == 1  # request_count=1 default
        assert mock_urllib.request.urlopen.call_count == 1

    def test_max_attempts_three_succeeds_on_third_attempt(self):
        """max_attempts=3, transient failure twice then success → returns ok with tool_calls=3."""
        # Build a sequence: transient, transient, success
        success_resp = _make_response(b"final content", status=200, content_type="text/plain")
        with patch.object(url_fetch_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.error = urllib.error
            mock_urllib.request.urlopen.side_effect = [
                _raise_url_error("connection refused"),
                _raise_url_error("connection refused"),
                success_resp,
            ]
            result = url_fetch_mod.run(
                {"url": "http://example.test/"},
                {"max_attempts": 3},
            )
        assert result.ok
        assert result.tool_calls == 3  # 3 attempts × request_count=1
        assert mock_urllib.request.urlopen.call_count == 3

    def test_max_attempts_three_always_fails_returns_error(self):
        """max_attempts=3, all transient failures → ok=False, tool_calls=3."""
        with patch.object(url_fetch_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.error = urllib.error
            mock_urllib.request.urlopen.side_effect = _raise_url_error("timeout")
            result = url_fetch_mod.run(
                {"url": "http://example.test/"},
                {"max_attempts": 3},
            )
        assert not result.ok
        assert result.tool_calls == 3
        assert "3 attempts" in result.error
        assert mock_urllib.request.urlopen.call_count == 3

    def test_max_attempts_clamped_above_five(self):
        """max_attempts=99 → clamped to 5 (MSB contract: range 1..5)."""
        with patch.object(url_fetch_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.error = urllib.error
            mock_urllib.request.urlopen.side_effect = _raise_url_error("network down")
            result = url_fetch_mod.run(
                {"url": "http://example.test/"},
                {"max_attempts": 99},
            )
        assert not result.ok
        assert result.tool_calls == 5  # clamped
        assert mock_urllib.request.urlopen.call_count == 5

    def test_max_attempts_clamped_below_one(self):
        """max_attempts=0 → clamped to 1 (preserves old single-attempt behavior)."""
        resp = _make_response(b"ok", status=200, content_type="text/plain")
        with patch.object(url_fetch_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.request.urlopen.return_value = resp
            result = url_fetch_mod.run(
                {"url": "http://example.test/"},
                {"max_attempts": 0},
            )
        assert result.ok
        assert result.tool_calls == 1
        assert mock_urllib.request.urlopen.call_count == 1

    def test_http_error_4xx_is_fatal_no_retry(self):
        """HTTPError (404) → returns immediately, no retry, tool_calls=1."""
        # HTTPError with code=404 IS an instance of URLError (subclass).
        # The except clause ordering (HTTPError BEFORE URLError) ensures it
        # is caught first and treated as fatal.
        http_err = urllib.error.HTTPError(
            "http://example.test/missing", 404, "Not Found", {}, BytesIO(b"")
        )
        with patch.object(url_fetch_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.error = urllib.error
            mock_urllib.request.urlopen.side_effect = http_err
            result = url_fetch_mod.run(
                {"url": "http://example.test/missing"},
                {"max_attempts": 5},
            )
        assert not result.ok
        assert "HTTP 404" in result.error
        assert result.tool_calls == 1  # No retry — single attempt
        assert mock_urllib.request.urlopen.call_count == 1

    def test_max_attempts_with_request_count(self):
        """max_attempts=2 × request_count=2: inner loop breaks on first transient.
        With always-transient stub, each attempt calls urlopen once then breaks,
        so total tool_calls = max_attempts (not max_attempts × request_count).
        This is the correct behavior: no point retrying request_count times
        within an attempt when the network is down."""
        with patch.object(url_fetch_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.error = urllib.error
            mock_urllib.request.urlopen.side_effect = _raise_url_error("refused")
            result = url_fetch_mod.run(
                {"url": "http://example.test/"},
                {"max_attempts": 2, "request_count": 2},
            )
        assert not result.ok
        # tool_calls = 2 (one urlopen call per attempt, broken early on transient)
        assert result.tool_calls == 2
        assert mock_urllib.request.urlopen.call_count == 2


# ─────────────────────────────────────────────────────────────────────────────
# http_get.py — max_attempts retry behavior
# ─────────────────────────────────────────────────────────────────────────────


class TestHttpGetMaxAttempts:
    """http_get.run() honors params['max_attempts'] for transient retries."""

    def test_default_max_attempts_is_one_preserves_current_behavior(self):
        """No max_attempts in params → exactly 1 attempt."""
        resp = _make_response(b"hello", status=200, content_type="text/plain")
        with patch.object(http_get_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.request.urlopen.return_value = resp
            result = http_get_mod.run({"url": "http://example.test/"})
        assert result.ok
        assert result.tool_calls == 1
        assert mock_urllib.request.urlopen.call_count == 1

    def test_max_attempts_three_succeeds_on_third_attempt(self):
        """max_attempts=3, transient×2 then success → ok with tool_calls=3."""
        success_resp = _make_response(b"final", status=200, content_type="text/plain")
        with patch.object(http_get_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.error = urllib.error
            mock_urllib.request.urlopen.side_effect = [
                _raise_url_error("connection reset"),
                _raise_url_error("connection reset"),
                success_resp,
            ]
            result = http_get_mod.run(
                {"url": "http://example.test/"},
                {"max_attempts": 3},
            )
        assert result.ok
        assert result.tool_calls == 3
        assert mock_urllib.request.urlopen.call_count == 3

    def test_max_attempts_three_always_fails(self):
        """max_attempts=3, all transient → ok=False, tool_calls=3."""
        with patch.object(http_get_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.error = urllib.error
            mock_urllib.request.urlopen.side_effect = _raise_url_error("timeout")
            result = http_get_mod.run(
                {"url": "http://example.test/"},
                {"max_attempts": 3},
            )
        assert not result.ok
        assert result.tool_calls == 3
        assert "3 attempts" in result.error

    def test_http_error_500_is_fatal_no_retry(self):
        """HTTPError 500 → returns immediately, no retry, tool_calls=1."""
        http_err = urllib.error.HTTPError(
            "http://example.test/", 500, "Internal Server Error", {}, BytesIO(b"")
        )
        with patch.object(http_get_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.error = urllib.error
            mock_urllib.request.urlopen.side_effect = http_err
            result = http_get_mod.run(
                {"url": "http://example.test/"},
                {"max_attempts": 5},
            )
        assert not result.ok
        assert "HTTP 500" in result.error
        assert result.tool_calls == 1
        assert mock_urllib.request.urlopen.call_count == 1

    def test_max_attempts_clamped_above_five(self):
        """max_attempts=42 → clamped to 5."""
        with patch.object(http_get_mod, "urllib") as mock_urllib:
            mock_urllib.request.Request = MagicMock()
            mock_urllib.error = urllib.error
            mock_urllib.request.urlopen.side_effect = _raise_url_error("network down")
            result = http_get_mod.run(
                {"url": "http://example.test/"},
                {"max_attempts": 42},
            )
        assert not result.ok
        assert result.tool_calls == 5
        assert mock_urllib.request.urlopen.call_count == 5


# ─────────────────────────────────────────────────────────────────────────────
# web_search.py — max_attempts retry behavior
# ─────────────────────────────────────────────────────────────────────────────


class TestWebSearchMaxAttempts:
    """web_search.run() honors params['max_attempts'] for transient retries.

    Note: web_search has a special "missing backend" case that is NOT transient —
    it's a config error and must NOT trigger retries (would just waste tool_calls).
    """

    def test_default_max_attempts_is_one_preserves_current_behavior(self):
        """No max_attempts in params → exactly 1 attempt when backend is configured."""
        from alienclaw.diagnostics.stub_servers import StubServer

        results_payload = [{"title": "r1", "href": "https://x/1", "body": "b1"}]
        canned = {"/search": (200, json.dumps(results_payload).encode(), "application/json")}
        with StubServer(canned) as stub_url:
            with patch.dict("os.environ", {"ALIENCLAW_SEARCH_URL": stub_url + "/search"}):
                result = web_search_mod.run({"query": "test"})
        assert result.ok
        assert result.tool_calls == 1

    def test_max_attempts_three_succeeds_on_third_attempt(self):
        """max_attempts=3, transient×2 then success → ok with tool_calls=3."""
        from alienclaw.diagnostics.stub_servers import StubServer

        results_payload = [{"title": "r1", "href": "https://x/1", "body": "b1"}]
        canned = {"/search": (200, json.dumps(results_payload).encode(), "application/json")}
        call_count = {"n": 0}

        # Wrap urlopen to fail twice then succeed (StubServer doesn't support
        # transient-fault injection, so we patch the urlopen level directly).
        original_urlopen = urllib.request.urlopen

        def fake_urlopen(url, timeout=None):
            call_count["n"] += 1
            if call_count["n"] <= 2:
                raise urllib.error.URLError("backend unreachable")
            return original_urlopen(url, timeout=timeout)

        with StubServer(canned) as stub_url:
            with patch.dict("os.environ", {"ALIENCLAW_SEARCH_URL": stub_url + "/search"}):
                with patch("urllib.request.urlopen", side_effect=fake_urlopen):
                    result = web_search_mod.run(
                        {"query": "test"},
                        {"max_attempts": 3},
                    )
        assert result.ok
        assert result.tool_calls == 3
        assert call_count["n"] == 3

    def test_max_attempts_three_always_fails(self):
        """max_attempts=3, all transient → ok=False, tool_calls=3."""
        with patch("urllib.request.urlopen", side_effect=_raise_url_error("backend down")):
            with patch.dict("os.environ", {"ALIENCLAW_SEARCH_URL": "http://stub.test/search"}):
                result = web_search_mod.run(
                    {"query": "test"},
                    {"max_attempts": 3},
                )
        assert not result.ok
        assert result.tool_calls == 3
        assert "3 attempts" in result.error

    def test_http_error_from_backend_is_fatal_no_retry(self):
        """HTTPError 503 from the backend → returns immediately, tool_calls=1."""
        http_err = urllib.error.HTTPError(
            "http://stub.test/search", 503, "Service Unavailable", {}, BytesIO(b"")
        )
        with patch("urllib.request.urlopen", side_effect=http_err):
            with patch.dict("os.environ", {"ALIENCLAW_SEARCH_URL": "http://stub.test/search"}):
                result = web_search_mod.run(
                    {"query": "test"},
                    {"max_attempts": 5},
                )
        assert not result.ok
        assert "503" in result.error
        assert result.tool_calls == 1  # No retry on HTTPError

    def test_missing_backend_is_not_retried(self):
        """Missing ALIENCLAW_SEARCH_URL is a config error — NOT a transient failure.
        Must return immediately with tool_calls=1, not max_attempts * page_count."""
        env = {k: v for k, v in __import__("os").environ.items() if k != "ALIENCLAW_SEARCH_URL"}
        with patch.dict("os.environ", env, clear=True):
            result = web_search_mod.run(
                {"query": "test"},
                {"max_attempts": 5},
            )
        assert not result.ok
        assert "not configured" in result.error.lower()
        assert result.tool_calls == 1  # Config error, no retry attempted

    def test_max_attempts_clamped_above_five(self):
        """max_attempts=10 → clamped to 5."""
        with patch("urllib.request.urlopen", side_effect=_raise_url_error("network down")):
            with patch.dict("os.environ", {"ALIENCLAW_SEARCH_URL": "http://stub.test/search"}):
                result = web_search_mod.run(
                    {"query": "test"},
                    {"max_attempts": 10},
                )
        assert not result.ok
        assert result.tool_calls == 5

    def test_json_decode_error_is_retried_as_transient(self):
        """A 200 response whose body is not valid JSON raises json.JSONDecodeError.
        The module docstring lists JSONDecodeError as a transient failure that is
        retried up to max_attempts — this test exercises that code path explicitly.
        HTTPError (deterministic) must NOT be confused with this: HTTPError is
        caught before the bare `except Exception` and returns immediately."""
        bad_resp = _make_response(b"<html>not-valid-json</html>", status=200, content_type="text/html")
        with patch("urllib.request.urlopen", return_value=bad_resp) as mock_open:
            with patch.dict("os.environ", {"ALIENCLAW_SEARCH_URL": "http://stub.test/search"}):
                result = web_search_mod.run(
                    {"query": "test"},
                    {"max_attempts": 3},
                )
        assert not result.ok
        assert result.tool_calls == 3          # one urlopen per attempt
        assert "3 attempts" in result.error
        assert mock_open.call_count == 3       # retried all 3 times
