"""Regression (2026-11-26): the SSRF guard must vet the host urllib actually connects to.

``assert_safe_fetch_url`` checked ``urlparse(url).hostname``, but urllib connects to
``Request(url).host``, split by http.client: userinfo is kept, percent-escapes are
decoded, and the tab/CR/LF that urlsplit silently drops are kept. Whenever the
checked name resolves to a public address (a wildcard record, a resolver search
domain, or any DNS zone the attacker controls) the guard passed and the tool
connected somewhere else. Concretely, ``http://%31%32%37.0.0.1/`` was vetted as the
NAME ``%31%32%37.0.0.1`` and then connected to the literal ``127.0.0.1``.

Also covered (docs/salvage/SANDBOX-SECURITY-REVIEW.md SR-01 / SR-03): urlparse splits
the port at the FIRST ':' while http.client splits at the LAST, and WHATWG parsers
(urllib3, so requests) end the authority at a backslash.

The guard now refuses every spelling on which parsers can disagree (backslash,
whitespace, control chars, userinfo, '%' in the host, a second ':' outside brackets,
host characters outside [a-z0-9._-] after IDNA) and returns a canonical URL rebuilt
from the validated parts, which callers fetch.

Network-free: getaddrinfo is replaced by a wildcard resolver (literals still go
through the real parser with AI_NUMERICHOST, which never performs a lookup) and
socket connect raises. The tool-level tests swap in an in-process transport.
"""
from __future__ import annotations

import email.message
import http.client
import io
import socket
import urllib.request
import urllib.response
from urllib.parse import urlparse

import pytest

import alienclaw.tools.http_get as http_get
import alienclaw.tools.url_fetch as url_fetch
from alienclaw.tools._ssrf_guard import SsrfBlockedError, assert_safe_fetch_url

_REAL_GETADDRINFO = socket.getaddrinfo
PUBLIC_V4 = "93.184.216.34"


@pytest.fixture(autouse=True)
def wildcard_dns(monkeypatch: pytest.MonkeyPatch) -> list:
    """Every NAME resolves to a public address; IP literals keep their real meaning."""
    seen: list = []

    def fake(host, port, family=0, type=0, proto=0, flags=0):
        seen.append(host)
        try:
            return _REAL_GETADDRINFO(host, port, family, type, proto, flags | socket.AI_NUMERICHOST)
        except socket.gaierror:
            pass
        if isinstance(host, str):
            host.encode("idna")  # keep the real UnicodeError contract for illegal labels
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (PUBLIC_V4, port or 0))]

    monkeypatch.setattr(socket, "getaddrinfo", fake)
    return seen


@pytest.fixture(autouse=True)
def _no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(self, *args, **kwargs):
        raise RuntimeError("network access is disabled in this test module")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", refuse)


def _connect_host(url: str) -> str:
    """The host urllib hands to the socket layer: Request's split, then http.client's."""
    return http.client.HTTPConnection(urllib.request.Request(url).host).host


# ── guard level ────────────────────────────────────────────────────────────────

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
    # review SR-03: urlparse splits the port at the FIRST ':', http.client at the LAST
    "http://a.attacker.example:b.attacker.example:80/",
    "http://public.example:80:80/",
    # review SR-01: urllib3/requests end the authority at '\' (WHATWG); urlparse does not
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


@pytest.mark.parametrize("url", MISMATCH_URLS)
def test_guard_refuses_url_whose_connect_host_differs(url: str) -> None:
    with pytest.raises(SsrfBlockedError) as excinfo:
        assert_safe_fetch_url(url)
    assert str(excinfo.value).startswith("Refusing")


def test_percent_encoded_loopback_is_not_even_resolved(wildcard_dns: list) -> None:
    with pytest.raises(SsrfBlockedError):
        assert_safe_fetch_url("http://%31%32%37.0.0.1/")
    assert wildcard_dns == []


CANONICAL = [
    ("http://public.example/path?q=1", "http://public.example/path?q=1"),
    ("http://public.example", "http://public.example"),
    ("HTTP://Public.Example:080/a;p?q=1#f", "http://public.example:80/a;p?q=1#f"),
    ("https://bücher.example/x", "https://xn--bcher-kva.example/x"),
    ("http://[2606:4700:4700::1111]:8443/", "http://[2606:4700:4700::1111]:8443/"),
    ("http://public.example./", "http://public.example./"),
    ("http://public.example:/", "http://public.example/"),
    ("http://my_host.example/", "http://my_host.example/"),
]


@pytest.mark.parametrize(("raw", "expected"), CANONICAL)
def test_guard_returns_canonical_url(raw: str, expected: str) -> None:
    out = assert_safe_fetch_url(raw)
    assert out == expected
    parsed = urlparse(out)
    assert parsed.username is None and parsed.password is None
    assert _connect_host(out) == parsed.hostname
    assert out.isascii()


# ── tool level: the fetched URL is the vetted one ─────────────────────────────

class _RecordingHandler(urllib.request.BaseHandler):
    handler_order = 100  # ahead of the stock HTTP(S)Handler (500)

    def __init__(self) -> None:
        self.hosts: list[str] = []

    def _serve(self, req: urllib.request.Request):
        self.hosts.append(req.host)
        headers = email.message.Message()
        headers["Content-Type"] = "text/plain"
        resp = urllib.response.addinfourl(io.BytesIO(b"internal"), headers, req.full_url, 200)
        resp.msg = "OK"  # read by urllib's HTTPErrorProcessor
        return resp

    http_open = https_open = _serve


@pytest.fixture
def transport(monkeypatch: pytest.MonkeyPatch) -> _RecordingHandler:
    handler = _RecordingHandler()
    real_build = http_get.build_no_redirect_opener

    def build():
        opener = real_build()
        opener.add_handler(handler)
        return opener

    monkeypatch.setattr(http_get, "build_no_redirect_opener", build)
    monkeypatch.setattr(url_fetch, "build_no_redirect_opener", build)
    return handler


@pytest.mark.parametrize("tool", [http_get, url_fetch], ids=["http_get", "url_fetch"])
@pytest.mark.parametrize("url", [
    "http://%31%32%37.0.0.1/",
    "http://evil@x.attacker.example/",
    "http://a.attacker.example:b.attacker.example:80/",
    "http://169.254.169.254\\@example.com/../latest/meta-data/",
])
def test_tool_never_connects_to_unvetted_host(tool, url: str, transport) -> None:
    r = tool.run({"url": url})
    assert r.ok is False, f"{url!r} was fetched from {transport.hosts!r}"
    assert transport.hosts == []


@pytest.mark.parametrize("tool", [http_get, url_fetch], ids=["http_get", "url_fetch"])
def test_tool_fetches_and_reports_canonical_url(tool, transport) -> None:
    r = tool.run({"url": "http://Public.Example/x"})
    assert r.ok is True, r.error
    assert transport.hosts == ["public.example"]
    # `url` stays the caller's input; the canonical URL fetched is `fetched_url`
    # (see test_fetch_output_url.py).
    assert r.output["url"] == "http://Public.Example/x"
    assert r.output["fetched_url"] == "http://public.example/x"
