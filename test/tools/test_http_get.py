"""Direct unit tests for alienclaw.tools.http_get.

This file is the SEPARATE-NEW-FILE pattern (post-102 lesson): there is no
existing test/tools/test_http_get.py on origin/main, so we create one rather
than extending an existing file.

Coverage targets:
- The 5 missing lines per v8 report on origin/main (lines 13, 29-38)
- The MSB-spec field-name alignment (post-113 fix):
    url, statusCode, content, bytesReturned, contentType, truncated
- The bridge-server composition path used by fetch_then_parse.martian

The tests use a tiny http.server in a background thread to avoid mocking
urllib (which is fragile and exercises less of the production path).
"""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from alienclaw.tools.http_get import run as http_get_run


# ── Test stub server ──────────────────────────────────────────────────────
# A minimal BaseHTTPRequestHandler that records requests and returns
# configurable responses. Tests can customize per-handler via subclassing.

class _StubState:
    """Shared mutable state for the stub server (per-fixture)."""
    request_count = 0
    last_path = ""
    last_headers: dict = {}


class _StubHandler(BaseHTTPRequestHandler):
    """Default handler: returns 200 + JSON body with Content-Type header."""
    # The subclass below overrides these via class-level attributes.
    response_status = 200
    response_body = b'{"hello":"world"}'
    response_content_type = "application/json"

    def do_GET(self):  # noqa: N802 (BaseHTTPRequestHandler API)
        _StubState.request_count += 1
        _StubState.last_path = self.path
        _StubState.last_headers = {k: v for k, v in self.headers.items()}
        self.send_response(self.response_status)
        self.send_header("Content-Type", self.response_content_type)
        self.send_header("Content-Length", str(len(self.response_body)))
        self.end_headers()
        self.wfile.write(self.response_body)

    def log_message(self, format, *args):  # silence stderr noise
        pass


def _start_server(handler_cls=_StubHandler) -> tuple[HTTPServer, str]:
    """Start a stub HTTP server on an ephemeral port; return (server, base_url)."""
    server = HTTPServer(("127.0.0.1", 0), handler_cls)
    base_url = f"http://127.0.0.1:{server.server_address[1]}"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, base_url


@pytest.fixture
def stub_server():
    """Default stub: 200 + JSON body."""
    _StubState.request_count = 0
    _StubState.last_path = ""
    _StubState.last_headers = {}
    server, url = _start_server()
    yield url
    server.shutdown()


# ── Missing-input path (line 13) ─────────────────────────────────────────

class TestMissingUrl:
    def test_missing_url_returns_error(self):
        r = http_get_run({})
        assert r.ok is False
        assert r.error is not None
        assert "Missing 'url'" in r.error
        assert r.correctness == 0.0

    def test_empty_url_returns_error(self):
        r = http_get_run({"url": ""})
        assert r.ok is False
        assert r.error is not None
        assert "Missing 'url'" in r.error


# ── Happy path: MSB-spec field names ─────────────────────────────────────

class TestFieldNamesMsbCompliant:
    """Verify all output keys match seed/msb/http_get.msb OUTPUT CONTRACT."""

    def test_field_count_3_returns_statusCode_content(self, stub_server):
        r = http_get_run({"url": stub_server + "/"}, {"field_count": 3})
        assert r.ok is True
        # MSB-spec keys present at field_count=3
        assert "statusCode" in r.output
        assert "content" in r.output
        assert "truncated" in r.output
        # bytesReturned only appears at field_count >= 4
        assert "bytesReturned" not in r.output
        # Legacy Python keys MUST NOT be present (this is the fix)
        assert "status_code" not in r.output, "Legacy status_code leaked"
        assert "body" not in r.output, "Legacy body leaked"
        assert "body_length" not in r.output, "Legacy body_length leaked"
        assert "content_type" not in r.output, "Legacy content_type leaked"
        # MSB-spec values correct
        assert r.output["statusCode"] == 200
        assert r.output["content"] == '{"hello":"world"}'
        assert r.output["truncated"] is False

    def test_field_count_4_includes_bytesReturned(self, stub_server):
        r = http_get_run({"url": stub_server + "/"}, {"field_count": 4})
        assert r.ok is True
        assert "bytesReturned" in r.output
        assert r.output["bytesReturned"] == len('{"hello":"world"}')
        # contentType still not present (it's at field_count >= 5)
        assert "contentType" not in r.output

    def test_field_count_5_returns_contentType(self, stub_server):
        r = http_get_run({"url": stub_server + "/"}, {"field_count": 5})
        assert r.ok is True
        assert r.output["contentType"] == "application/json"
        assert r.output["statusCode"] == 200
        assert r.output["bytesReturned"] == len('{"hello":"world"}')

    def test_field_count_1_returns_only_url(self, stub_server):
        r = http_get_run({"url": stub_server + "/"}, {"field_count": 1})
        assert r.ok is True
        # field_count=1 → only url, plus the always-on truncated and body_preview extensions
        assert r.output["url"] == stub_server + "/"
        assert "statusCode" not in r.output
        assert "content" not in r.output
        assert "contentType" not in r.output
        assert r.output["truncated"] is False

    def test_url_field_always_present(self, stub_server):
        r = http_get_run({"url": stub_server + "/x"}, {"field_count": 3})
        assert r.output["url"] == stub_server + "/x"

    def test_body_preview_field_present_as_extension(self, stub_server):
        """body_preview is an extension field kept for backwards compat."""
        r = http_get_run({"url": stub_server + "/"}, {"field_count": 3})
        assert "body_preview" in r.output


# ── Param clamping ────────────────────────────────────────────────────────

class TestParamClamping:
    def test_field_count_clamped_to_5(self, stub_server):
        r = http_get_run({"url": stub_server + "/"}, {"field_count": 99})
        assert r.ok is True
        # All 5 fields present (clamps down)
        for key in ("url", "statusCode", "content", "bytesReturned", "contentType"):
            assert key in r.output

    def test_field_count_clamped_to_1(self, stub_server):
        r = http_get_run({"url": stub_server + "/"}, {"field_count": -5})
        assert r.ok is True
        assert r.output.get("statusCode") is None

    def test_body_preview_clamped_to_10(self, stub_server):
        # Stub returns a single-line JSON, so body_preview=1 line either way;
        # what we verify is no crash and the field is present.
        r = http_get_run({"url": stub_server + "/"}, {"body_preview": 99})
        assert r.ok is True
        assert "body_preview" in r.output

    def test_request_count_drives_tool_calls(self, stub_server):
        r = http_get_run({"url": stub_server + "/"}, {"request_count": 3})
        assert r.ok is True
        assert r.tool_calls == 3
        assert _StubState.request_count == 3

    def test_request_count_clamped_to_5(self, stub_server):
        r = http_get_run({"url": stub_server + "/"}, {"request_count": 99})
        assert r.ok is True
        assert r.tool_calls == 5


# ── Error path (lines 29-38: HTTPError + generic Exception) ───────────────

class _ErrorHandler(_StubHandler):
    response_status = 404
    response_body = b"Not Found"


class TestErrorPath:
    def test_http_error_returns_statusCode_in_output(self):
        _StubState.request_count = 0
        server, url = _start_server(_ErrorHandler)
        try:
            r = http_get_run({"url": url + "/"})
        finally:
            server.shutdown()
        assert r.ok is False
        assert "HTTP 404" in r.error
        # HTTPError path output uses the MSB-spec key, not the legacy one
        assert r.output.get("statusCode") == 404
        assert "status_code" not in r.output
        assert r.tool_calls == 1
        assert r.correctness == 0.0

    def test_connection_refused_returns_error(self):
        # Port 1 is reserved/unused; connect should fail.
        r = http_get_run({"url": "http://127.0.0.1:1/"}, {"request_count": 1})
        assert r.ok is False
        assert "Request failed" in r.error
        assert r.correctness == 0.0


# ── Headers pass-through ──────────────────────────────────────────────────

class TestHeaders:
    def test_custom_headers_forwarded(self, stub_server):
        r = http_get_run(
            {"url": stub_server + "/", "headers": {"X-Test-Header": "value-1"}},
            {"request_count": 1},
        )
        assert r.ok is True
        assert _StubState.last_headers.get("X-Test-Header") == "value-1"


# ── Truncation flag (new MSB-spec field) ─────────────────────────────────

class _LongHandler(_StubHandler):
    # Send 2 MiB to exceed the 1 MiB cap
    response_status = 200
    response_body = b"x" * (2 * 1024 * 1024)
    response_content_type = "text/plain"


class TestTruncatedFlag:
    def test_truncated_true_when_content_length_exceeds_cap(self):
        _StubState.request_count = 0
        server, url = _start_server(_LongHandler)
        try:
            r = http_get_run({"url": url + "/big"}, {"field_count": 5})
        finally:
            server.shutdown()
        assert r.ok is True
        assert r.output["truncated"] is True
        # bytesReturned is capped at _MAX_RESPONSE_BYTES (1 MiB)
        assert r.output["bytesReturned"] == 1 * 1024 * 1024

    def test_truncated_false_when_response_fits(self, stub_server):
        r = http_get_run({"url": stub_server + "/"})
        assert r.ok is True
        assert r.output["truncated"] is False