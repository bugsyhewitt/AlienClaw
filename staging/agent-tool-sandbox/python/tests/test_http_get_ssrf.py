"""SSRF guard + no-redirect opener composition, ported from the reference http_get tool suite.

The reference tool runs ``assert_safe_fetch_url`` and then issues the request
through ``build_no_redirect_opener()``. These tests drive that same composition
against an in-process fake transport and assert two things the tool relies on:
a blocked URL never reaches the transport, and no redirect is ever followed.
"""
from __future__ import annotations

import urllib.error

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


def _guarded_get(url: str, fake_transport, responder):
    """Guard, then open through the no-redirect opener (the reference tool's order)."""
    opener = build_no_redirect_opener()
    transport = fake_transport(opener, responder)
    try:
        safe_url = assert_safe_fetch_url(url)
        return transport, opener.open(safe_url, timeout=1)
    except Exception as exc:
        exc.transport = transport  # type: ignore[attr-defined]
        raise


@pytest.mark.parametrize("url", BLOCKED_URLS)
def test_blocked_url_never_reaches_transport(url: str, fake_transport) -> None:
    with pytest.raises(SsrfBlockedError) as excinfo:
        _guarded_get(url, fake_transport, lambda req: (200, {}))
    err = str(excinfo.value).lower()
    assert "refusing" in err or "blocked" in err
    assert excinfo.value.transport.requests == [], f"{url!r} reached the transport"


def test_public_url_is_fetched_once(fake_transport) -> None:
    transport, resp = _guarded_get("http://public.example/", fake_transport, lambda r: (200, {}))
    assert resp.code == 200
    assert transport.requests == ["http://public.example/"]


# ── Redirect block ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("code", [301, 302, 303, 307, 308])
def test_redirect_codes_raise_ssrf_blocked(code: int, fake_transport) -> None:
    """Redirect-follow must be disabled (parity with redirect:'error')."""
    responder = lambda req: (code, {"Location": "http://169.254.169.254/"})  # noqa: E731
    with pytest.raises(SsrfBlockedError) as excinfo:
        _guarded_get("http://public.example/", fake_transport, responder)
    err = str(excinfo.value).lower()
    assert "redirect" in err and "169.254.169.254" in err
    assert excinfo.value.transport.requests == ["http://public.example/"]


@pytest.mark.parametrize("code", [300, 304, 305])
def test_other_3xx_are_errors_not_follows(code: int, fake_transport) -> None:
    responder = lambda req: (code, {"Location": "http://169.254.169.254/"})  # noqa: E731
    with pytest.raises(urllib.error.HTTPError) as excinfo:
        _guarded_get("http://public.example/", fake_transport, responder)
    assert excinfo.value.code == code
    assert excinfo.value.transport.requests == ["http://public.example/"]


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="KNOWN GAP (identical to in-tree): the guard checks urlparse().hostname, but "
    "urllib connects to Request().host, which keeps userinfo and percent-decodes. With an "
    "attacker-controlled DNS zone this is a race-free variant of DNS rebinding.",
)
@pytest.mark.parametrize("url", [
    "http://evil@x.public.example/",   # urllib host: 'evil@x.public.example'
    "http://a%2ex.public.example/",    # urllib host: 'a.x.public.example'
])
def test_connect_host_matches_checked_host(url: str, fake_dns) -> None:
    import urllib.request
    from urllib.parse import urlparse

    fake_dns.records["x.public.example"] = ["93.184.216.34"]
    fake_dns.records["a%2ex.public.example"] = ["93.184.216.34"]
    assert assert_safe_fetch_url(url) == url  # the guard accepts it
    assert urllib.request.Request(url).host == urlparse(url).hostname


def test_opener_has_only_the_blocking_redirect_handler() -> None:
    import urllib.request

    opener = build_no_redirect_opener()
    redirect_handlers = [
        h for h in opener.handlers if isinstance(h, urllib.request.HTTPRedirectHandler)
    ]
    assert len(redirect_handlers) == 1
    assert type(redirect_handlers[0]) is not urllib.request.HTTPRedirectHandler
