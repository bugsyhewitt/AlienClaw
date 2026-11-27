"""SSRF-core guard tests for url_fetch, driving the real agent_tool_sandbox guard.

Ported from the in-tree test_url_fetch_ssrf.py. Verifies the guard blocks:
- file:// and other non-http(s) schemes
- Loopback, RFC1918, link-local, metadata, IPv6 variants, obfuscation forms
- 3xx redirects (disabled opener — equiv of TS redirect:'error')

The redirect test used a real http.server on 127.0.0.1 with the guard bypassed;
here the 3xx comes from an in-process handler and the guard runs.
"""
from __future__ import annotations

import pytest

from conftest import reply_with
from pho3nix_recon_http.url_fetch import run as url_fetch_run
from test_http_get_ssrf import BLOCKED_URLS


@pytest.mark.parametrize("url", BLOCKED_URLS)
def test_url_fetch_blocks_ssrf_target(url, transport):
    handler = transport()
    r = url_fetch_run({"url": url})
    assert r.ok is False
    assert r.correctness == 0.0
    err = (r.error or "").lower()
    assert "refusing" in err or "blocked" in err, (
        f"Expected SSRF rejection for {url!r}, got error: {r.error!r}"
    )
    assert handler.requests == []


@pytest.mark.parametrize("method", ["GET", "POST", "PUT"])
@pytest.mark.parametrize("status", [301, 302, 303, 307, 308])
def test_url_fetch_blocks_redirect(status, method, transport):
    """urllib's automatic redirect-follow must be disabled for every method."""
    handler = transport(reply_with(b"", status=status, Location="file:///etc/passwd"))
    r = url_fetch_run(
        {"url": "http://public.example/", "method": method, "body": "x", "max_attempts": 1}
    )
    assert r.ok is False, "Expected ok=False when redirect is blocked"
    assert r.error == "Redirect to 'file:///etc/passwd' blocked"
    assert len(handler.requests) == 1
