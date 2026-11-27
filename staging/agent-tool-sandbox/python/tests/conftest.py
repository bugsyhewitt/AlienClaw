"""Network-free test harness.

- ``fake_dns`` (autouse): replaces ``socket.getaddrinfo`` with a deterministic
  resolver. IP literals still go through the REAL libc parser, called with
  ``AI_NUMERICHOST`` (which by contract never performs a lookup), so every
  obfuscated IPv4 form (``127.1``, ``0x7f.0.0.1``, ``2130706433``...) and the
  real idna host encoding (and its UnicodeError) behave exactly as in
  production. Names are answered from an in-memory table; anything else is
  NXDOMAIN.
- ``_no_network`` (autouse): any socket connect raises, so a test that
  accidentally reaches the wire fails loudly instead of touching the network.
- ``fake_transport``: installs an in-process urllib handler that answers
  http(s) requests with a canned status + headers (no sockets).
"""
from __future__ import annotations

import email.message
import http.client
import io
import ipaddress
import socket
import urllib.request
import urllib.response
from collections.abc import Callable

import pytest

_REAL_GETADDRINFO = socket.getaddrinfo

PUBLIC_V4 = "93.184.216.34"
PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946"

DEFAULT_RECORDS: dict[str, list[str]] = {
    "localhost": ["127.0.0.1", "::1"],
    "public.example": [PUBLIC_V4],
    "public6.example": [PUBLIC_V6],
    "dual.example": [PUBLIC_V4, PUBLIC_V6],
    "mixed.example": [PUBLIC_V4, "10.0.0.1"],
    "metadata.google.internal": ["169.254.169.254"],
    "mapped-metadata.example": ["::ffff:169.254.169.254"],
    "ula.example": ["fd00::1"],
    "linklocal6.example": ["fe80::1"],
    "cgnat.example": ["100.64.0.1"],
    "mapped-cgnat.example": ["::ffff:100.64.0.1"],
    "xn--bcher-kva.example": [PUBLIC_V4],
}


class FakeResolver:
    def __init__(self) -> None:
        self.records: dict[str, list[str]] = {k: list(v) for k, v in DEFAULT_RECORDS.items()}
        self.raw: dict[str, list[tuple]] = {}
        self.raises: dict[str, BaseException] = {}
        self.calls: list[object] = []

    def getaddrinfo(self, host, port, family=0, type=0, proto=0, flags=0):
        self.calls.append(host)
        if isinstance(host, str) and host in self.raises:
            raise self.raises[host]
        if isinstance(host, str) and host in self.raw:
            return list(self.raw[host])
        try:
            return _REAL_GETADDRINFO(
                host, port, family, type, proto, flags | socket.AI_NUMERICHOST
            )
        except socket.gaierror:
            pass
        key = host.encode("idna") if isinstance(host, str) else bytes(host)
        # C-string semantics: libc sees the name up to the first NUL.
        key_s = key.split(b"\x00", 1)[0].decode("ascii").lower()
        if key_s.endswith("."):
            key_s = key_s[:-1]
        addrs = self.records.get(key_s)
        if not addrs:
            raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")
        out = []
        for a in addrs:
            if ipaddress.ip_address(a).version == 4:
                out.append((socket.AF_INET, socket.SOCK_STREAM, 6, "", (a, port or 0)))
            else:
                out.append((socket.AF_INET6, socket.SOCK_STREAM, 6, "", (a, port or 0, 0, 0)))
        return out


@pytest.fixture(autouse=True)
def fake_dns(monkeypatch: pytest.MonkeyPatch) -> FakeResolver:
    resolver = FakeResolver()
    monkeypatch.setattr(socket, "getaddrinfo", resolver.getaddrinfo)
    return resolver


@pytest.fixture(autouse=True)
def _no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def _refuse(self, *args, **kwargs):
        raise RuntimeError("network access is disabled in this test suite")

    monkeypatch.setattr(socket.socket, "connect", _refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", _refuse)


Responder = Callable[[urllib.request.Request], "tuple[int, dict[str, str]]"]


class FakeHTTPHandler(urllib.request.BaseHandler):
    """Answers http/https opens in-process. Runs ahead of the stock handlers."""

    handler_order = 100  # stock HTTPHandler / HTTPSHandler are 500

    def __init__(self, responder: Responder) -> None:
        self.responder = responder
        self.requests: list[str] = []

    def _serve(self, req: urllib.request.Request):
        self.requests.append(req.full_url)
        code, headers = self.responder(req)
        msg = email.message.Message()
        for name, value in headers.items():
            msg[name] = value
        resp = urllib.response.addinfourl(io.BytesIO(b"body"), msg, req.full_url, code)
        resp.msg = http.client.responses.get(code, "")
        return resp

    http_open = https_open = _serve


@pytest.fixture
def fake_transport() -> Callable[[urllib.request.OpenerDirector, Responder], FakeHTTPHandler]:
    def install(opener: urllib.request.OpenerDirector, responder: Responder) -> FakeHTTPHandler:
        handler = FakeHTTPHandler(responder)
        opener.add_handler(handler)
        return handler

    return install
