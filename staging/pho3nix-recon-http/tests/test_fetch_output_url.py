"""Output contract: ``url`` is the caller's URL, ``fetched_url`` the vetted one.

Ported from the in-tree test_fetch_output_url.py (2026-11-26 review). The guard
returns a canonical URL (lowercased scheme and host, IDNA host, an empty ``?`` or ``#``
kept as given (F2), ``:080`` -> ``:80``) and the tools fetch it. Callers that match a result to
the URL they passed in need their own string back, so ``url`` is the input, unchanged,
and ``fetched_url`` carries the URL that was actually requested.

Network-free: every name resolves to a public address (wildcard fake DNS; IP literals
keep the real parser) and the conftest transport answers in-process. The in-tree file
brings its own resolver and recording handler; here the conftest ones are used.
"""
from __future__ import annotations

import pytest

from conftest import PUBLIC_V4
from pho3nix_recon_http import http_get, url_fetch

TOOLS = pytest.mark.parametrize("tool", [http_get, url_fetch], ids=["http_get", "url_fetch"])


@pytest.fixture(autouse=True)
def _public_dns(fake_dns) -> None:
    fake_dns.wildcard = PUBLIC_V4


CASES = [
    ("http://Public.Example/x", "http://public.example/x"),
    ("https://bücher.example/x", "https://xn--bcher-kva.example/x"),
    # F2 (2026-11-26 security review): an empty '?' or '#' is kept, as given (was dropped)
    ("http://public.example/x?", "http://public.example/x?"),
    ("http://public.example/x#", "http://public.example/x#"),
    ("http://public.example?", "http://public.example?"),
    ("HTTP://Public.Example:080/a?q=1#f", "http://public.example:80/a?q=1#f"),
    ("http://public.example/already/canonical?q=1", "http://public.example/already/canonical?q=1"),
]


@TOOLS
@pytest.mark.parametrize(("given", "canonical"), CASES)
def test_url_is_the_input_and_fetched_url_is_what_was_requested(
    tool, transport, given: str, canonical: str
) -> None:
    handler = transport()
    r = tool.run({"url": given})
    assert r.ok is True, r.error
    assert r.output["url"] == given
    assert r.output["fetched_url"] == canonical
    # urllib.request.Request.full_url omits an EMPTY fragment (no fragment is ever sent)
    assert [s.full_url for s in handler.requests] == [canonical.removesuffix("#")]


@TOOLS
@pytest.mark.parametrize("field_count", [1, 2, 3, 4, 5])
def test_fetched_url_present_at_every_field_count(tool, transport, field_count: int) -> None:
    transport()
    r = tool.run({"url": "http://Public.Example/x"}, {"field_count": field_count})
    assert r.ok is True, r.error
    assert r.output["url"] == "http://Public.Example/x"
    assert r.output["fetched_url"] == "http://public.example/x"


@TOOLS
def test_failures_do_not_report_a_fetched_url(tool, transport) -> None:
    """A URL the guard refuses is never requested, so there is no fetched_url."""
    handler = transport()
    r = tool.run({"url": "http://127.0.0.1/"})
    assert r.ok is False
    assert "fetched_url" not in (r.output or {})
    assert handler.requests == []
