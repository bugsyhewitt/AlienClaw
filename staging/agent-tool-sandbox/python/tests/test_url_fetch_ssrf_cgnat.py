"""CGNAT 100.64.0.0/10 (RFC 6598) must be blocked by the SSRF guard.

Ported from the reference repo's open PR #630 (guard level). This block is a
declared divergence from the in-tree guard, which does not block it.
"""
from __future__ import annotations

import ipaddress

import pytest

from agent_tool_sandbox.ssrf_guard import SsrfBlockedError, _ip_is_blocked, assert_safe_fetch_url


@pytest.mark.parametrize("url", [
    "http://100.64.0.1/",          # CGNAT 100.64/10 low
    "http://100.64.0.255/",        # CGNAT 100.64/10 /24
    "http://100.127.255.255/",     # CGNAT 100.64/10 high
    "http://100.100.100.100/",     # CGNAT midpoint
    "http://100.100.100.200/",     # Alibaba Cloud metadata endpoint (inside CGNAT)
    "http://100.64.0.1:8080/",     # CGNAT with explicit port
    "http://100.64.0.1/path?q=1",  # CGNAT with path + query
    "http://1681915905/",          # decimal 100.64.0.1
    "http://0x64.0x40.0.1/",       # hex 100.64.0.1
    "http://[::ffff:100.64.0.1]/",  # IPv4-mapped literal, unwrapped by the resolver
    "http://cgnat.example/",       # name resolving into CGNAT
    "http://mapped-cgnat.example/",  # name resolving to mapped CGNAT (AAAA)
])
def test_guard_blocks_cgnat(url: str) -> None:
    with pytest.raises(SsrfBlockedError) as excinfo:
        assert_safe_fetch_url(url)
    err = str(excinfo.value).lower()
    assert "refusing" in err or "blocked" in err, (
        f"CGNAT URL {url!r} was not blocked by the SSRF guard: {excinfo.value!r}"
    )


@pytest.mark.parametrize("url", [
    "http://100.63.0.1/",          # just below CGNAT (100.63.0.0/16)
    "http://100.63.255.255/",      # last address below CGNAT
    "http://100.128.0.0/",         # first address above CGNAT
    "http://100.128.0.1/",         # just above CGNAT (100.128.0.0/9)
])
def test_guard_does_not_block_adjacent_to_cgnat(url: str) -> None:
    assert assert_safe_fetch_url(url) == url


@pytest.mark.parametrize(("ip", "blocked"), [
    ("100.63.255.255", False),
    ("100.64.0.0", True),
    ("100.64.0.1", True),
    ("100.127.255.255", True),
    ("100.128.0.0", False),
])
def test_ip_is_blocked_cgnat_edges(ip: str, blocked: bool) -> None:
    assert _ip_is_blocked(ipaddress.IPv4Address(ip)) is blocked
