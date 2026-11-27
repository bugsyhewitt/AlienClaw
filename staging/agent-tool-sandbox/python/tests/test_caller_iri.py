"""A non-ASCII URL from the CALLER (an IRI) is canonicalised, as a redirect Location is.

``http://bücher.example/café`` used to pass the guard with its path unchanged, so the
"canonical" URL it returned was not ASCII, and ``pinned_urlopen`` let http.client's
``UnicodeEncodeError`` escape (it cannot put ``é`` in a request line), as
``urllib.request.urlopen`` does. Now the guard applies its character rule to the URL as
given, then percent-encodes, as UTF-8, every non-ASCII character of the path, query and
fragment, BEFORE validating, so every check and the returned URL see the canonical form.
The host is IDNA-encoded (or refused) by the guard, as before.

The expected strings are what WHATWG ``new URL(raw).href`` gives (the TS twin's parser),
except that the guard keeps an explicit port (``:80``) where WHATWG drops a default one,
and keeps an empty path empty where WHATWG writes ``/``.

Network-free: DNS is conftest's fake resolver; ``wire`` replaces ``socket.socket``.
"""
from __future__ import annotations

import io
import socket
from types import SimpleNamespace

import pytest

from agent_tool_sandbox import (
    SsrfBlockedError,
    assert_safe_fetch_url,
    pinned_urlopen,
    resolve_and_validate,
)

PUBLIC_V4 = "93.184.216.34"

CANONICAL_IRIS = [
    ("http://bücher.example/café", "http://xn--bcher-kva.example/caf%C3%A9"),
    ("https://public.example/s?q=é&r=ü#frag-é",
     "https://public.example/s?q=%C3%A9&r=%C3%BC#frag-%C3%A9"),
    ("http://public.example/%C3%A9é", "http://public.example/%C3%A9%C3%A9"),  # not re-encoded
    ("http://public.example/a;é", "http://public.example/a;%C3%A9"),
    ("http://public.example/\U0001f600", "http://public.example/%F0%9F%98%80"),
    ("HTTP://Bücher.Example:080/naïve", "http://xn--bcher-kva.example:80/na%C3%AFve"),
    ("http://public.example?é", "http://public.example?%C3%A9"),  # query right after the host
]


@pytest.mark.parametrize(("raw", "expected"), CANONICAL_IRIS)
def test_guard_percent_encodes_a_caller_iri(raw: str, expected: str) -> None:
    out = assert_safe_fetch_url(raw)
    assert out == expected
    assert out.isascii()
    assert assert_safe_fetch_url(out) == out  # the canonical form is a fixed point


@pytest.mark.parametrize(("raw", "expected"), CANONICAL_IRIS)
def test_pinned_target_carries_the_canonical_url(raw: str, expected: str) -> None:
    target = resolve_and_validate(raw)
    assert target.canonical_url == expected
    assert target.host.isascii()


@pytest.mark.parametrize("url", [
    "http://public.example/a　b",       # ideographic space
    "http://public.example/a\u0085b",       # NEL
    "http://public.example/a​b",       # zero-width space (format character)
    "http://public.example/?q= ",      # line separator
    "http://public.example/# ",        # no-break space
    "http://public.example/\udce9",         # lone surrogate: quote() could not encode it
])
def test_encoding_launders_no_whitespace_or_control(url: str) -> None:
    """The character rule runs on the URL as given, so encoding cannot hide one as %XX."""
    with pytest.raises(SsrfBlockedError, match="^Refusing URL containing "):
        assert_safe_fetch_url(url)


@pytest.mark.parametrize(("url", "message"), [
    ("http://10.0.0.1/café", "^Refusing hostname '10.0.0.1': not an allowed destination$"),
    ("http://ｌｏｃａｌｈｏｓｔ/café", "reserved loopback name"),
    ("ftp://public.example/café", "^Refusing non-http\\(s\\) scheme 'ftp'"),
    ("http://user@public.example/café", "^Refusing URL with userinfo"),
    ("http://nxdomain.example/é", "^Refusing hostname 'nxdomain.example': not an allowed"),
])
def test_a_refused_iri_is_still_refused(url: str, message: str) -> None:
    with pytest.raises(SsrfBlockedError, match=message):
        assert_safe_fetch_url(url)


class _WireSocket:
    """Records what is sent; answers every connection with one canned 200."""

    state: SimpleNamespace

    def __init__(self, *args, **kwargs) -> None:
        self.connected_to = None
        self.sent = bytearray()
        self.state.sockets.append(self)

    def settimeout(self, value) -> None:
        pass

    def setsockopt(self, *args) -> None:
        pass

    def connect(self, addr) -> None:
        self.connected_to = addr

    def sendall(self, data) -> None:
        self.sent += data

    def makefile(self, mode="rb", *args, **kwargs):
        return io.BytesIO(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")

    def close(self) -> None:
        pass

    def head(self) -> list[str]:
        return bytes(self.sent).partition(b"\r\n\r\n")[0].decode("ascii").split("\r\n")


@pytest.fixture
def wire(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    state = SimpleNamespace(sockets=[])
    monkeypatch.setattr(socket, "socket", type("WireSocket", (_WireSocket,), {"state": state}))
    return state


@pytest.mark.parametrize(("url", "request_line"), [
    ("http://bücher.example/café?q=ü", "GET /caf%C3%A9?q=%C3%BC HTTP/1.1"),
    ("http://public.example/naïve#frag-é", "GET /na%C3%AFve HTTP/1.1"),
])
def test_pinned_urlopen_sends_a_caller_iri_percent_encoded(url, request_line, wire) -> None:
    """Before: UnicodeEncodeError out of http.client, which is not a documented error."""
    with pinned_urlopen(url, timeout=5) as resp:
        assert resp.read() == b"ok"
    (sock,) = wire.sockets
    assert sock.connected_to == (PUBLIC_V4, 80)
    head = sock.head()
    assert head[0] == request_line
    assert any(line.lower().startswith("host: ") and line.isascii() for line in head[1:])
