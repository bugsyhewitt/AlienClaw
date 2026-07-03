"""Tests for url_fetch.run() — covers the content_preview clamp bug and all major branches."""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, HTTPServer
import threading

import pytest

from alienclaw.tools.url_fetch import run


# ── Minimal in-process HTTP server for success-path tests ───────────────────

class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        body = b"line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(body)

@pytest.fixture(scope="module")
def local_server():
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{port}"
    server.shutdown()


# ── Missing-URL guard ────────────────────────────────────────────────────────

class TestMissingUrl:
    def test_empty_url_returns_failure(self):
        r = run({})
        assert r.ok is False
        assert r.correctness == 0.0
        assert "Missing 'url'" in r.error

    def test_explicit_empty_string_url(self):
        r = run({"url": ""})
        assert r.ok is False
        assert "Missing 'url'" in r.error


# ── content_preview clamp: THE BUG ───────────────────────────────────────────

class TestContentPreviewClamp:
    """The content_preview param is spec'd as 1-10. Verify the clamp holds."""

    def test_content_preview_clamped_to_10_when_99(self, local_server):
        r = run({"url": local_server}, {"content_preview": 99})
        assert r.ok is True
        # server returns 11 lines; if unclamped, preview would be 11 lines.
        # With correct clamp, preview must be at most 10 lines.
        preview_lines = r.output["preview"].splitlines()
        assert len(preview_lines) <= 10, (
            f"content_preview=99 produced {len(preview_lines)} lines; expected <=10 (clamp to 10)"
        )

    def test_content_preview_default_is_2(self, local_server):
        r = run({"url": local_server})
        preview_lines = r.output["preview"].splitlines()
        assert len(preview_lines) == 2

    def test_content_preview_1_gives_1_line(self, local_server):
        r = run({"url": local_server}, {"content_preview": 1})
        preview_lines = r.output["preview"].splitlines()
        assert len(preview_lines) == 1

    def test_content_preview_10_gives_at_most_10_lines(self, local_server):
        r = run({"url": local_server}, {"content_preview": 10})
        preview_lines = r.output["preview"].splitlines()
        assert len(preview_lines) == 10

    def test_content_preview_clamped_to_min_1_when_0(self, local_server):
        r = run({"url": local_server}, {"content_preview": 0})
        assert r.ok is True
        preview_lines = r.output["preview"].splitlines()
        assert len(preview_lines) >= 1


# ── field_count output keys ──────────────────────────────────────────────────

class TestFieldCount:
    def test_field_count_1_url_only(self, local_server):
        r = run({"url": local_server}, {"field_count": 1})
        assert "url" in r.output
        assert "statusCode" not in r.output
        assert "content" not in r.output

    def test_field_count_3_includes_content(self, local_server):
        r = run({"url": local_server}, {"field_count": 3})
        assert "url" in r.output
        assert "statusCode" in r.output
        assert "content" in r.output
        assert "contentLength" not in r.output

    def test_output_fields_are_camelcase(self, local_server):
        r = run({"url": local_server}, {"field_count": 5})
        assert r.ok is True
        assert "statusCode" in r.output, "MSB OUTPUT CONTRACT requires statusCode"
        assert "status_code" not in r.output, "snake_case status_code violates MSB OUTPUT CONTRACT"
        assert "contentType" in r.output, "MSB OUTPUT CONTRACT requires contentType"
        assert "content_type" not in r.output, "snake_case content_type violates MSB OUTPUT CONTRACT"

    def test_preview_always_present(self, local_server):
        for fc in [1, 2, 3, 4, 5]:
            r = run({"url": local_server}, {"field_count": fc})
            assert "preview" in r.output, f"preview missing at field_count={fc}"


# ── request_count / tool_calls ───────────────────────────────────────────────

class TestRequestCount:
    def test_default_tool_calls_is_1(self, local_server):
        r = run({"url": local_server})
        assert r.tool_calls == 1

    def test_request_count_3_sets_tool_calls_3(self, local_server):
        r = run({"url": local_server}, {"request_count": 3})
        assert r.tool_calls == 3

    def test_request_count_clamped_to_5(self, local_server):
        r = run({"url": local_server}, {"request_count": 99})
        assert r.tool_calls == 5
