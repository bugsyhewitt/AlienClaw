"""Direct unit tests for pho3nix_recon_http.http_get.

Ported from the in-tree test_http_get.py. Coverage targets:
- The MSB-spec field-name alignment:
    url, statusCode, content, bytesReturned, contentType, truncated
- Param clamping, the HTTPError / transient error paths, header pass-through,
  the truncation flag and the raw byte count.

The in-tree tests ran a real http.server on 127.0.0.1 and bypassed the SSRF guard.
Here the transport is an in-process urllib handler and the guard runs for real:
``public.example`` resolves (fake DNS) to a public address.
"""
from __future__ import annotations

import urllib.error

import pytest

from conftest import reply_with
from pho3nix_recon_http.http_get import run as http_get_run

BASE = "http://public.example"
JSON_BODY = b'{"hello":"world"}'


@pytest.fixture
def stub_handler(transport):
    """Default stub: 200 + JSON body. Returns the in-process handler (records requests)."""
    return transport(reply_with(JSON_BODY, content_type="application/json"))


@pytest.fixture
def stub_server(stub_handler):
    """The base URL the default stub answers."""
    return BASE


# ── Missing-input path ───────────────────────────────────────────────────────

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


# ── Happy path: MSB-spec field names ─────────────────────────────────────────

class TestFieldNamesMsbCompliant:
    """Verify all output keys match the MSB OUTPUT CONTRACT."""

    def test_field_count_3_returns_status_code_content(self, stub_server):
        r = http_get_run({"url": stub_server + "/"}, {"field_count": 3})
        assert r.ok is True
        assert "statusCode" in r.output
        assert "content" in r.output
        assert "truncated" in r.output
        assert "bytesReturned" not in r.output
        assert "status_code" not in r.output, "Legacy status_code leaked"
        assert "body" not in r.output, "Legacy body leaked"
        assert "body_length" not in r.output, "Legacy body_length leaked"
        assert "content_type" not in r.output, "Legacy content_type leaked"
        assert r.output["statusCode"] == 200
        assert r.output["content"] == '{"hello":"world"}'
        assert r.output["truncated"] is False

    def test_field_count_4_includes_bytes_returned(self, stub_server):
        r = http_get_run({"url": stub_server + "/"}, {"field_count": 4})
        assert r.ok is True
        assert r.output["bytesReturned"] == len(JSON_BODY)
        assert "contentType" not in r.output

    def test_field_count_5_returns_content_type(self, stub_server):
        r = http_get_run({"url": stub_server + "/"}, {"field_count": 5})
        assert r.ok is True
        assert r.output["contentType"] == "application/json"
        assert r.output["statusCode"] == 200
        assert r.output["bytesReturned"] == len(JSON_BODY)

    def test_field_count_1_returns_only_url(self, stub_server):
        r = http_get_run({"url": stub_server + "/"}, {"field_count": 1})
        assert r.ok is True
        assert r.output["url"] == stub_server + "/"
        assert "statusCode" not in r.output
        assert "content" not in r.output
        assert "contentType" not in r.output
        assert r.output["truncated"] is False

    def test_url_field_always_present(self, stub_server):
        r = http_get_run({"url": stub_server + "/x"}, {"field_count": 3})
        assert r.output["url"] == stub_server + "/x"

    def test_body_preview_field_present_as_extension(self, stub_server):
        r = http_get_run({"url": stub_server + "/"}, {"field_count": 3})
        assert "body_preview" in r.output


# ── Param clamping ───────────────────────────────────────────────────────────

class TestParamClamping:
    def test_field_count_clamped_to_5(self, stub_server):
        r = http_get_run({"url": stub_server + "/"}, {"field_count": 99})
        assert r.ok is True
        for key in ("url", "statusCode", "content", "bytesReturned", "contentType"):
            assert key in r.output

    def test_field_count_clamped_to_1(self, stub_server):
        r = http_get_run({"url": stub_server + "/"}, {"field_count": -5})
        assert r.ok is True
        assert r.output.get("statusCode") is None

    def test_body_preview_clamped_to_10(self, transport):
        transport(reply_with(b"\n".join(b"l%d" % i for i in range(15))))
        r = http_get_run({"url": BASE + "/"}, {"body_preview": 99})
        assert r.ok is True
        assert r.output["body_preview"].splitlines() == [f"l{i}" for i in range(10)]

    def test_request_count_drives_tool_calls(self, stub_server, stub_handler):
        r = http_get_run({"url": stub_server + "/"}, {"request_count": 3})
        assert r.ok is True
        assert r.tool_calls == 3
        assert len(stub_handler.requests) == 3

    def test_request_count_clamped_to_5(self, stub_server):
        r = http_get_run({"url": stub_server + "/"}, {"request_count": 99})
        assert r.ok is True
        assert r.tool_calls == 5


# ── Error path (HTTPError + generic Exception) ───────────────────────────────

class TestErrorPath:
    def test_http_error_returns_status_code_in_output(self, transport):
        transport(reply_with(b"Not Found", status=404))
        r = http_get_run({"url": BASE + "/"})
        assert r.ok is False
        assert "HTTP 404" in r.error
        assert r.output.get("statusCode") == 404
        assert "status_code" not in r.output
        assert r.tool_calls == 1
        assert r.correctness == 0.0

    def test_connection_refused_returns_error(self, transport):
        def refuse(req):
            raise urllib.error.URLError(ConnectionRefusedError(111, "Connection refused"))

        transport(refuse)
        r = http_get_run({"url": BASE + ":1/"}, {"request_count": 1})
        assert r.ok is False
        assert "Request failed" in r.error
        assert r.correctness == 0.0


# ── Headers pass-through ─────────────────────────────────────────────────────

class TestHeaders:
    def test_custom_headers_forwarded(self, stub_server, stub_handler):
        r = http_get_run(
            {"url": stub_server + "/", "headers": {"X-Test-Header": "value-1"}},
            {"request_count": 1},
        )
        assert r.ok is True
        assert stub_handler.requests[-1].header("X-Test-Header") == "value-1"


# ── Truncation flag ──────────────────────────────────────────────────────────

class TestTruncatedFlag:
    def test_truncated_true_when_content_length_exceeds_cap(self, transport):
        transport(reply_with(b"x" * (2 * 1024 * 1024)))
        r = http_get_run({"url": BASE + "/big"}, {"field_count": 5})
        assert r.ok is True
        assert r.output["truncated"] is True
        assert r.output["bytesReturned"] == 1 * 1024 * 1024

    def test_truncated_false_when_response_fits(self, stub_server):
        r = http_get_run({"url": stub_server + "/"})
        assert r.ok is True
        assert r.output["truncated"] is False


# ── UTF-8 multi-byte: bytesReturned must be raw byte count ───────────────────

class TestBytesReturnedMultiByte:
    def test_bytes_returned_matches_content_length_header_for_utf8(self, transport):
        """UTF-8 body 'café' = 5 bytes, 4 chars. Must report 5, not 4."""
        transport(reply_with("café".encode(), content_type="text/plain; charset=utf-8"))
        r = http_get_run({"url": BASE}, {"field_count": 4, "max_attempts": 1, "request_count": 1})
        assert r.ok is True
        assert r.output["bytesReturned"] == 5

    def test_bytes_returned_equals_bytes_for_3byte_utf8(self, transport):
        """CJK '字' = 3 bytes UTF-8. 1 char body = 3 bytes returned."""
        transport(reply_with("字".encode(), content_type="text/plain; charset=utf-8"))
        r = http_get_run({"url": BASE}, {"field_count": 4, "max_attempts": 1, "request_count": 1})
        assert r.output["bytesReturned"] == 3
