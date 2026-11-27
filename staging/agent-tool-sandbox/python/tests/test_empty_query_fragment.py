"""Regression (2026-11-26 security review, F2): an empty '?' or '#' is kept as given.

urlsplit()/urlunsplit() dropped an empty query or fragment, so the canonical URL for
'http://h/a?' was 'http://h/a' and the tools requested '/a' (pre-signed URLs, servers
that route on '?'). Only the authority is rebuilt now. The redirect path joined a
Location with urljoin(), which before Python 3.14 drops the same markers (and for a bare
'?' keeps the base's query); _join_location keeps them on every version, as WHATWG does.
"""
from __future__ import annotations

import pytest

from agent_tool_sandbox import assert_safe_fetch_url, resolve_and_validate
from agent_tool_sandbox.pinning import _join_location


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("http://public.example/a?", "http://public.example/a?"),
        ("http://public.example/?", "http://public.example/?"),
        ("http://public.example?", "http://public.example?"),
        ("http://public.example/a#", "http://public.example/a#"),
        ("http://public.example/a?#", "http://public.example/a?#"),
        ("http://public.example#", "http://public.example#"),
        ("HTTP://Public.Example:080/A;?#", "http://public.example:80/A;?#"),
        ("http://public.example:/a?", "http://public.example/a?"),
        ("http://[2606:2800:220:1::1]:8080?", "http://[2606:2800:220:1::1]:8080?"),
        ("https://bücher.example/café?", "https://xn--bcher-kva.example/caf%C3%A9?"),
        ("http://public.example/a//b?x=%2F#f", "http://public.example/a//b?x=%2F#f"),
    ],
)
def test_canonical_url_keeps_empty_query_and_fragment(url: str, expected: str) -> None:
    assert assert_safe_fetch_url(url) == expected
    assert resolve_and_validate(url).canonical_url == expected


@pytest.mark.parametrize(
    ("base", "location", "expected"),
    [
        ("http://h/a?x=1", "/b?", "http://h/b?"),
        ("http://h/a?x=1", "?", "http://h/a?"),
        ("http://h/a?x=1", "#", "http://h/a?x=1#"),
        ("http://h/a?x=1", "", "http://h/a?x=1"),
        ("http://h/a", "b?#", "http://h/b?#"),
        ("http://h/a?q", "?#", "http://h/a?#"),
        ("http://h/a", "?q#", "http://h/a?q#"),
        ("http://h/a", "#a?", "http://h/a#a?"),
        ("http://h/a?q", "/c?d#e", "http://h/c?d#e"),
        ("http://h/a", "https://g/x?", "https://g/x?"),
    ],
)
def test_redirect_location_keeps_empty_query_and_fragment(
    base: str, location: str, expected: str
) -> None:
    assert _join_location(base, location) == expected
