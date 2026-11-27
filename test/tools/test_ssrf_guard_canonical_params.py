"""The canonical URL returned by assert_safe_fetch_url must name the same resource.

Found by the staged sandbox's property tests (2026-11-26): rebuilding through
urlparse()/urlunparse() dropped an EMPTY ';params' component, so 'http://h/a;'
came back as 'http://h/a', a different resource. Network-free.
"""

from __future__ import annotations

import socket

import pytest

from alienclaw.tools._ssrf_guard import assert_safe_fetch_url

PUBLIC_V4 = "93.184.216.34"


@pytest.fixture(autouse=True)
def public_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake(host, port, family=0, type=0, proto=0, flags=0):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (PUBLIC_V4, port or 0))]

    monkeypatch.setattr(socket, "getaddrinfo", fake)

    def refuse(self, *args, **kwargs):
        raise RuntimeError("network access is disabled in this test module")

    monkeypatch.setattr(socket.socket, "connect", refuse)


@pytest.mark.parametrize(
    "url, expected",
    [
        ("http://example.com/a;", "http://example.com/a;"),
        ("http://example.com/a;?q=1", "http://example.com/a;?q=1"),
        ("http://example.com/a;b", "http://example.com/a;b"),
        ("http://example.com/x;/y", "http://example.com/x;/y"),
        ("https://example.com/a;#frag", "https://example.com/a;#frag"),
    ],
)
def test_canonical_url_keeps_semicolon_params(url: str, expected: str) -> None:
    assert assert_safe_fetch_url(url) == expected


# F2 (2026-11-26 security review): urlsplit()/urlunsplit() also dropped an EMPTY '?' query
# (and '#'), so '/a?' was requested as '/a' (pre-signed URLs, servers that route on '?').
# Only the authority is rebuilt now; everything after it is kept exactly as given.
@pytest.mark.parametrize(
    "url, expected",
    [
        ("http://example.com/a?", "http://example.com/a?"),
        ("http://example.com/?", "http://example.com/?"),
        ("http://example.com?", "http://example.com?"),
        ("http://example.com/a#", "http://example.com/a#"),
        ("http://example.com/a?#", "http://example.com/a?#"),
        ("http://example.com#", "http://example.com#"),
        ("HTTP://Example.COM:080/A;?#", "http://example.com:80/A;?#"),
        ("http://example.com:/a?", "http://example.com/a?"),
        ("http://[2606:2800:220:1::1]:8080?", "http://[2606:2800:220:1::1]:8080?"),
        ("https://bücher.example/a?", "https://xn--bcher-kva.example/a?"),
        ("http://example.com/a//b?x=%2F#f", "http://example.com/a//b?x=%2F#f"),
    ],
)
def test_canonical_url_keeps_empty_query_and_fragment(url: str, expected: str) -> None:
    assert assert_safe_fetch_url(url) == expected
