"""PKT-577 SSRF-core guard tests for http_get.

Mirrors test_url_fetch_ssrf.py for the http_get tool.
"""
from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest import mock

import pytest

from alienclaw.tools.http_get import run as http_get_run


# ── Blocked-URL parametrize ───────────────────────────────────────────────────

@pytest.mark.parametrize("url", [
    "file:///etc/passwd",
    "file:///etc/hostname",
    "file:///root/.ssh/id_rsa",
    "ftp://127.0.0.1/",
    "gopher://127.0.0.1:1/_test",
    "http://127.0.0.1/",
    "http://127.0.0.1:8080/admin",
    "http://2130706433/",          # decimal 127.0.0.1
    "http://0x7f.0.0.1/",          # hex
    "http://0177.0.0.1/",          # octal
    "http://127.1/",               # short-form loopback
    "http://0/",                   # 0.0.0.0
    "http://10.0.0.1/",            # RFC1918
    "http://192.168.1.1/",         # RFC1918
    "http://172.16.0.1/",          # RFC1918
    "http://169.254.169.254/latest/meta-data/",  # cloud metadata
    "http://[::1]/",               # IPv6 loopback
    "http://[::ffff:127.0.0.1]/",  # IPv4-mapped IPv6
    "http://[fe80::1]/",           # IPv6 link-local
    "http://[fc00::1]/",           # IPv6 ULA
])
def test_http_get_blocks_ssrf_target(url):
    r = http_get_run({"url": url})
    assert r.ok is False
    assert r.correctness == 0.0
    err = (r.error or "").lower()
    assert "refusing" in err or "blocked" in err, (
        f"Expected SSRF rejection for {url!r}, got error: {r.error!r}"
    )


# ── Redirect block ─────────────────────────────────────────────────────────────

class _RedirectHandler(BaseHTTPRequestHandler):
    """Returns 302 → file:///etc/passwd."""
    def do_GET(self):
        self.send_response(302)
        self.send_header("Location", "file:///etc/passwd")
        self.end_headers()

    def log_message(self, *a):
        pass


def test_http_get_blocks_redirect():
    """Redirect-follow must be disabled (parity with TS redirect:'error')."""
    server = HTTPServer(("127.0.0.1", 0), _RedirectHandler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        redirect_url = f"http://127.0.0.1:{port}/"
        with mock.patch("alienclaw.tools.http_get.assert_safe_fetch_url", lambda u: u):
            r = http_get_run({"url": redirect_url, "max_attempts": 1})
        assert r.ok is False, "Expected ok=False when redirect is blocked"
        err = (r.error or "").lower()
        assert "redirect" in err or "blocked" in err or "302" in err, (
            f"Expected redirect-blocked error, got: {r.error!r}"
        )
    finally:
        server.shutdown()
