"""The guard must vet the host urllib actually connects to (regression, fixed 2026-11-26).

The guard used to check ``urlparse(url).hostname`` and return the URL unchanged,
while urllib connects to ``Request(url).host`` as split by http.client: userinfo
kept, percent-escapes decoded, tab/CR/LF (which urlsplit silently drops) kept.
Whenever the checked name resolves publicly (a wildcard record, a resolver search
domain, or a DNS zone the attacker controls) the guard passed and the connection
went elsewhere. ``http://%31%32%37.0.0.1/`` was vetted as the NAME
``%31%32%37.0.0.1`` and then connected to the literal ``127.0.0.1``.

Two more differentials (security review SR-01 / SR-03): urlparse splits the port
at the FIRST ':' while http.client splits at the LAST (``http://a.x.tld:b.x.tld:80/``
is checked as ``a.x.tld`` and connected as ``a.x.tld:b.x.tld``), and WHATWG
parsers such as urllib3 (so requests) end the authority at ``\\``
(``http://169.254.169.254\\@example.com/`` is checked as ``example.com``).

The guard now refuses every spelling on which parsers can disagree (backslash,
whitespace, control chars, userinfo, ``%`` in the host, a second ``:`` outside
brackets, host characters outside ``[a-z0-9._-]`` after IDNA) and returns a
canonical URL rebuilt from the validated parts; fetch that URL.

Adapted from the reference suite's test/tools/test_ssrf_guard_connect_host.py.
DNS is the conftest fake; every checked name below is given a public record so
that only the parse disagreement can block it.
"""
from __future__ import annotations

import http.client
import urllib.request
from urllib.parse import urlparse

import pytest

from agent_tool_sandbox import SsrfBlockedError, assert_safe_fetch_url, build_no_redirect_opener

PUBLIC_V4 = "93.184.216.34"

MISMATCH_URLS = [
    "http://%31%32%37.0.0.1/",                         # vetted as a name, connects 127.0.0.1
    "http://%31%36%39.254.169.254/latest/meta-data/",  # connects 169.254.169.254
    "http://%5b::1%5d/",                               # connects [::1]
    "http://a%2ex.attacker.example/",                  # connects a.x.attacker.example
    "http://127.0.0.1%2f.attacker.example/",           # connects '127.0.0.1/.attacker...'
    "http://127.0.0.1%23.attacker.example/",           # connects '127.0.0.1#.attacker...'
    "http://evil@x.attacker.example/",                 # connects 'evil@x.attacker.example'
    "http://user:pw@public.example/",                  # userinfo is refused outright
    "http://public.example@x.attacker.example/",
    # urlparse splits the port at the FIRST ':', http.client at the LAST
    "http://a.attacker.example:b.attacker.example:80/",
    "http://public.example:80:80/",
    # urllib3/requests end the authority at '\' (WHATWG); urlparse does not
    "http://169.254.169.254\\@example.com/../latest/meta-data/",
    "http://127.0.0.1\\@x.attacker.example/",
    "http://169.254.169.254\\.attacker.example/",
    # urlsplit silently drops tab/CR/LF that urllib keeps; whitespace / controls refused
    "http://x.attacker.example\t.y/",
    "http://x.attacker.example\n.y/",
    "http://public.example/a\tb",
    " http://public.example/",
    "http://public.example/a b",
    # outside [a-z0-9._-] after IDNA
    "http://a!b.attacker.example/",
]


@pytest.fixture(autouse=True)
def _checked_names_resolve_publicly(fake_dns):
    for url in MISMATCH_URLS:
        fake_dns.records[urlparse(url).hostname] = [PUBLIC_V4]
    return fake_dns


def _connect_host(url: str) -> str:
    """The host urllib hands to the socket layer: Request's split, then http.client's."""
    return http.client.HTTPConnection(urllib.request.Request(url).host).host


@pytest.mark.parametrize("url", MISMATCH_URLS)
def test_guard_refuses_url_whose_connect_host_differs(url: str) -> None:
    with pytest.raises(SsrfBlockedError) as excinfo:
        assert_safe_fetch_url(url)
    assert str(excinfo.value).startswith("Refusing")


def test_percent_encoded_loopback_is_not_even_resolved(fake_dns) -> None:
    fake_dns.calls.clear()
    with pytest.raises(SsrfBlockedError):
        assert_safe_fetch_url("http://%31%32%37.0.0.1/")
    assert fake_dns.calls == []


@pytest.mark.parametrize("url", [
    "http://%31%32%37.0.0.1/",
    "http://evil@x.attacker.example/",
    "http://a.attacker.example:b.attacker.example:80/",
    "http://169.254.169.254\\@example.com/../latest/meta-data/",
])
def test_guarded_fetch_never_reaches_transport(url: str, fake_transport) -> None:
    opener = build_no_redirect_opener()
    transport = fake_transport(opener, lambda req: (200, {}))
    with pytest.raises(SsrfBlockedError):
        opener.open(assert_safe_fetch_url(url), timeout=1)
    assert transport.requests == []


CANONICAL = [
    ("http://public.example/path?q=1", "http://public.example/path?q=1"),
    ("http://public.example", "http://public.example"),
    ("HTTP://Public.Example:080/a;p?q=1#f", "http://public.example:80/a;p?q=1#f"),
    ("https://bücher.example/x", "https://xn--bcher-kva.example/x"),
    ("http://[2606:4700:4700::1111]:8443/", "http://[2606:4700:4700::1111]:8443/"),
    ("http://public.example./", "http://public.example./"),
    ("http://public.example:/", "http://public.example/"),
]


@pytest.mark.parametrize(("raw", "expected"), CANONICAL)
def test_guard_returns_canonical_url(raw: str, expected: str) -> None:
    out = assert_safe_fetch_url(raw)  # xn--bcher-kva.example has a conftest record
    assert out == expected
    parsed = urlparse(out)
    assert parsed.username is None and parsed.password is None
    assert _connect_host(out) == parsed.hostname
    assert out.isascii()


# ── every HTTP client must agree with the guard on the returned URL ───────────
# The guard returns a string any client may fetch; a client that splits it
# differently connects somewhere unvetted (urllib3/requests and '\' was the
# critical case). Third-party parsers are optional: each is skipped if absent.

def _host_urllib3(url: str) -> str:
    return pytest.importorskip("urllib3").util.parse_url(url).host


def _host_httpx(url: str) -> str:
    return pytest.importorskip("httpx").URL(url).raw_host.decode("ascii")


def _host_yarl(url: str) -> str:
    return pytest.importorskip("yarl").URL(url).raw_host


CLIENT_HOST_PARSERS = {
    "urllib": _connect_host,
    "urllib3": _host_urllib3,
    "httpx": _host_httpx,
    "yarl": _host_yarl,
}


@pytest.mark.parametrize("client", sorted(CLIENT_HOST_PARSERS))
@pytest.mark.parametrize("raw", [raw for raw, _ in CANONICAL] + ["https://public.example:8443/"])
def test_every_client_parses_the_checked_host(raw: str, client: str) -> None:
    out = assert_safe_fetch_url(raw)
    parsed = CLIENT_HOST_PARSERS[client](out)
    assert parsed.strip("[]").lower().rstrip(".") == urlparse(out).hostname.rstrip(".")


def test_fetch_goes_to_the_canonical_url(fake_transport) -> None:
    opener = build_no_redirect_opener()
    transport = fake_transport(opener, lambda req: (200, {}))
    opener.open(assert_safe_fetch_url("http://Public.Example/x"), timeout=1)
    assert transport.requests == ["http://public.example/x"]
