"""Output contract (2026-11-26 review): ``url`` is the caller's URL, ``fetched_url`` the vetted one.

The connect-host fix made http_get and url_fetch fetch the canonical URL that
``assert_safe_fetch_url`` rebuilds (lowercased scheme and host, IDNA host, an empty
``?`` or ``#`` kept as given (F2), ``:080`` -> ``:80``), and it also overwrote the output
``url`` with it. Callers that match a result to the URL they passed in no longer
saw their own string back. ``url`` is the input again, unchanged; the new
``fetched_url`` field carries the URL that was actually requested.

Network-free: names resolve to a public address through a fake resolver (IP
literals keep the real parser) and an in-process urllib handler answers requests.
"""
from __future__ import annotations

import email.message
import io
import socket
import urllib.request
import urllib.response

import pytest

import alienclaw.tools.http_get as http_get
import alienclaw.tools.url_fetch as url_fetch

_REAL_GETADDRINFO = socket.getaddrinfo
PUBLIC_V4 = "93.184.216.34"

TOOLS = pytest.mark.parametrize("tool", [http_get, url_fetch], ids=["http_get", "url_fetch"])


@pytest.fixture(autouse=True)
def _public_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake(host, port, family=0, type=0, proto=0, flags=0):
        try:
            return _REAL_GETADDRINFO(host, port, family, type, proto, flags | socket.AI_NUMERICHOST)
        except socket.gaierror:
            pass
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (PUBLIC_V4, port or 0))]

    monkeypatch.setattr(socket, "getaddrinfo", fake)

    def refuse(self, *args, **kwargs):
        raise RuntimeError("network access is disabled in this test module")

    monkeypatch.setattr(socket.socket, "connect", refuse)


class _RecordingHandler(urllib.request.BaseHandler):
    handler_order = 100  # ahead of the stock HTTP(S)Handler (500)

    def __init__(self) -> None:
        self.urls: list[str] = []

    def _serve(self, req: urllib.request.Request):
        self.urls.append(req.full_url)
        headers = email.message.Message()
        headers["Content-Type"] = "text/plain"
        resp = urllib.response.addinfourl(io.BytesIO(b"hello\n"), headers, req.full_url, 200)
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
    tool, transport: _RecordingHandler, given: str, canonical: str
) -> None:
    r = tool.run({"url": given})
    assert r.ok is True, r.error
    assert r.output["url"] == given
    assert r.output["fetched_url"] == canonical
    # urllib.request.Request.full_url omits an EMPTY fragment (no fragment is ever sent)
    assert transport.urls == [canonical.removesuffix("#")]


@TOOLS
@pytest.mark.parametrize("field_count", [1, 2, 3, 4, 5])
def test_fetched_url_present_at_every_field_count(
    tool, transport: _RecordingHandler, field_count: int
) -> None:
    r = tool.run({"url": "http://Public.Example/x"}, {"field_count": field_count})
    assert r.ok is True, r.error
    assert r.output["url"] == "http://Public.Example/x"
    assert r.output["fetched_url"] == "http://public.example/x"


@TOOLS
def test_failures_do_not_report_a_fetched_url(tool, transport: _RecordingHandler) -> None:
    """A URL the guard refuses is never requested, so there is no fetched_url."""
    r = tool.run({"url": "http://127.0.0.1/"})
    assert r.ok is False
    assert "fetched_url" not in (r.output or {})
    assert transport.urls == []
