"""SSRF core-guard tests, ported from the reference url_fetch tool suite (guard level only).

Verifies the guard blocks:
- file:// and other non-http(s) schemes
- Loopback, RFC1918, link-local, metadata, IPv6 variants, obfuscation forms
- 3xx redirects (no-redirect opener — equiv of fetch redirect:'error')

Drives the real guard. DNS is the network-free fake from conftest.py; the
redirect is served by an in-process fake transport instead of a local server.
"""
from __future__ import annotations

import pytest

from agent_tool_sandbox import SsrfBlockedError, assert_safe_fetch_url, build_no_redirect_opener

# ── Blocked-URL parametrize ───────────────────────────────────────────────────

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
]


@pytest.mark.parametrize("url", BLOCKED_URLS)
def test_guard_blocks_ssrf_target(url: str) -> None:
    with pytest.raises(SsrfBlockedError) as excinfo:
        assert_safe_fetch_url(url)
    err = str(excinfo.value).lower()
    assert "refusing" in err or "blocked" in err, (
        f"Expected SSRF rejection for {url!r}, got error: {excinfo.value!r}"
    )


def test_guard_allows_public_host_and_returns_url_unchanged() -> None:
    url = "http://public.example/path?q=1"
    assert assert_safe_fetch_url(url) == url


# ── Redirect block ─────────────────────────────────────────────────────────────

def test_no_redirect_opener_blocks_redirect(fake_transport) -> None:
    """urllib's automatic redirect-follow must be disabled (parity with redirect:'error')."""
    opener = build_no_redirect_opener()
    transport = fake_transport(opener, lambda req: (302, {"Location": "file:///etc/passwd"}))
    with pytest.raises(SsrfBlockedError) as excinfo:
        opener.open("http://public.example/", timeout=1)
    err = str(excinfo.value).lower()
    assert "redirect" in err or "blocked" in err or "302" in err, (
        f"Expected redirect-blocked error, got: {excinfo.value!r}"
    )
    assert transport.requests == ["http://public.example/"], "redirect target was fetched"
