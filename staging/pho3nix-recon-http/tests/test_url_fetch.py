"""Tests for url_fetch.run(): the content_preview clamp and all major branches.

Ported from the in-tree test_url_fetch.py. The in-tree tests ran real http.servers
on 127.0.0.1 and bypassed the SSRF guard; here the transport is an in-process
urllib handler and the guard runs (``public.example`` resolves to a public address).
"""
from __future__ import annotations

import pytest

from conftest import reply_with
from pho3nix_recon_http.url_fetch import run

BASE = "http://public.example"
ELEVEN_LINES = b"line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\n"


@pytest.fixture
def local_server(transport):
    transport(reply_with(ELEVEN_LINES, content_length=False))
    return BASE


@pytest.fixture
def latin1_server(transport):
    # 'café résumé' in latin-1; not valid UTF-8
    transport(reply_with(b"caf\xe9 r\xe9sum\xe9", content_type="text/plain; charset=latin-1",
                         content_length=False))
    return BASE


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


# ── content_preview clamp ────────────────────────────────────────────────────

class TestContentPreviewClamp:
    """The content_preview param is spec'd as 1-10. Verify the clamp holds."""

    def test_content_preview_clamped_to_10_when_99(self, local_server):
        r = run({"url": local_server}, {"content_preview": 99})
        assert r.ok is True
        assert len(r.output["preview"].splitlines()) <= 10

    def test_content_preview_default_is_2(self, local_server):
        r = run({"url": local_server})
        assert len(r.output["preview"].splitlines()) == 2

    def test_content_preview_1_gives_1_line(self, local_server):
        r = run({"url": local_server}, {"content_preview": 1})
        assert len(r.output["preview"].splitlines()) == 1

    def test_content_preview_10_gives_at_most_10_lines(self, local_server):
        r = run({"url": local_server}, {"content_preview": 10})
        assert len(r.output["preview"].splitlines()) == 10

    def test_content_preview_clamped_to_min_1_when_0(self, local_server):
        r = run({"url": local_server}, {"content_preview": 0})
        assert r.ok is True
        assert len(r.output["preview"].splitlines()) >= 1


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
        assert "statusCode" in r.output
        assert "status_code" not in r.output
        assert "contentType" in r.output
        assert "content_type" not in r.output

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


# ── UnicodeDecodeError fallback ──────────────────────────────────────────────

class TestUnicodeDecodeErrorFallback:
    def test_non_utf8_response_decoded_as_latin1(self, latin1_server):
        r = run({"url": latin1_server}, {"field_count": 3, "content_preview": 5})
        assert r.ok is True
        assert "café" in r.output.get("preview", "") or "résumé" in r.output.get("preview", "")


# ── UTF-8 multi-byte: contentLength must be raw byte count ───────────────────

class TestContentLengthMultiByte:
    def test_content_length_matches_byte_count_for_utf8(self, transport):
        """UTF-8 body 'café' = 5 bytes, 4 chars. Must report 5, not 4."""
        transport(reply_with("café".encode(), content_type="text/plain; charset=utf-8"))
        r = run({"url": BASE}, {"field_count": 4, "max_attempts": 1, "request_count": 1})
        assert r.ok is True
        assert r.output["contentLength"] == 5

    def test_content_length_equals_bytes_for_3byte_utf8(self, transport):
        """CJK '字' = 3 bytes UTF-8. 1 char body = 3 bytes returned."""
        transport(reply_with("字".encode(), content_type="text/plain; charset=utf-8"))
        r = run({"url": BASE}, {"field_count": 4, "max_attempts": 1, "request_count": 1})
        assert r.ok is True
        assert r.output["contentLength"] == 3


# ── method / body pass-through (no in-tree counterpart) ──────────────────────

class TestMethodAndBody:
    def test_method_is_upper_cased_and_body_stringified(self, transport):
        handler = transport(reply_with(b"ok"))
        r = run({"url": BASE + "/api", "method": "post", "body": {"a": 1}})
        assert r.ok is True
        seen = handler.requests[-1]
        assert seen.method == "POST"
        assert seen.data == b"{'a': 1}"

    def test_falsy_body_is_still_sent(self, transport):
        handler = transport(reply_with(b"ok"))
        run({"url": BASE, "method": "PUT", "body": 0})
        assert handler.requests[-1].data == b"0"
