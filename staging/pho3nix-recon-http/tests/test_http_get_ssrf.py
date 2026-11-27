"""SSRF-core guard tests for http_get, driving the real agent_tool_sandbox guard.

Ported from the in-tree test_http_get_ssrf.py. The redirect test used a real
http.server on 127.0.0.1 with the guard bypassed; here the 3xx comes from an
in-process handler behind the tool's own no-redirect opener, and the guard runs.
"""
from __future__ import annotations

import pytest

from conftest import reply_with
from pho3nix_recon_http.http_get import run as http_get_run

BLOCKED_URLS = [
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
    # names resolving to internal addresses (fake DNS)
    "http://localhost/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://mixed.example/",       # one public + one RFC1918 record
    "http://mapped-metadata.example/",
    "http://cgnat.example/",       # RFC 6598, blocked by agent_tool_sandbox only
]


@pytest.mark.parametrize("url", BLOCKED_URLS)
def test_http_get_blocks_ssrf_target(url, transport):
    handler = transport()
    r = http_get_run({"url": url})
    assert r.ok is False
    assert r.correctness == 0.0
    err = (r.error or "").lower()
    assert "refusing" in err or "blocked" in err, (
        f"Expected SSRF rejection for {url!r}, got error: {r.error!r}"
    )
    assert handler.requests == []


@pytest.mark.parametrize("location", ["file:///etc/passwd", "http://169.254.169.254/"])
@pytest.mark.parametrize("status", [301, 302, 303, 307, 308])
def test_http_get_blocks_redirect(status, location, transport):
    """Redirect-follow must be disabled (parity with TS redirect:'error')."""
    handler = transport(reply_with(b"", status=status, Location=location))
    r = http_get_run({"url": "http://public.example/", "max_attempts": 1})
    assert r.ok is False, "Expected ok=False when redirect is blocked"
    assert r.error == f"Redirect to {location!r} blocked"
    assert r.tool_calls == 1
    assert [s.full_url for s in handler.requests] == ["http://public.example/"]
