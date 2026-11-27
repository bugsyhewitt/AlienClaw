"""Network-free test harness for the staged recon tools.

- ``fake_dns`` (autouse): replaces ``socket.getaddrinfo`` with a deterministic
  resolver. IP literals still go through the REAL libc parser, called with
  ``AI_NUMERICHOST`` (which by contract never performs a lookup), so obfuscated IPv4
  forms (``127.1``, ``0x7f.0.0.1``, ``2130706433``) behave exactly as in production.
  Names come from an in-memory table (``wildcard`` answers every other name);
  anything else is NXDOMAIN.
- ``network_attempts`` (autouse): every socket connect raises RuntimeError and its
  address is recorded, so a test that reaches the wire fails loudly instead of
  touching the network.
- ``_clean_env`` (autouse): drops proxy variables (``build_opener`` would install a
  ProxyHandler from them) and the web_search backend variable, so the developer's
  environment never leaks into a test. Tests that need a backend set a dummy URL.
- ``transport``: answers the fetch tools' requests in-process with a canned ``Reply``
  (or raises whatever the responder raises). The staged tools fetch through
  agent_tool_sandbox's PINNED opener; there the transport replaces only the TCP/TLS
  connection (``PinnedHTTPConnection`` / ``PinnedHTTPSConnection``, real ``__init__``
  kept), so the pinned handler's own checks (scheme, host and port, Host header,
  address re-check) and the no-redirect handler still run. ``handler.dials`` records
  each connection: scheme, host, port, SNI name and the pinned addresses. For an
  unpinned opener (the in-tree tools in the parity test) it is an urllib handler
  added in front of the stock ones, as before.

``urllib.request.urlopen`` (web_search) is mocked per test with ``unittest.mock``.

Bytecode writing is switched off before anything is imported: a ``.pyc`` embeds the
absolute source path, so caches under ``src/`` would make a plain-text scan of the
package for in-tree names report false hits (and the run would leave ``__pycache__``
in the sandbox and in-tree trees it imports).
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import email.message  # noqa: E402
import http.client  # noqa: E402
import io  # noqa: E402
import ipaddress  # noqa: E402
import socket  # noqa: E402
import urllib.request  # noqa: E402
import urllib.response  # noqa: E402
from collections.abc import Callable, Iterable  # noqa: E402
from dataclasses import dataclass, field  # noqa: E402
from types import ModuleType  # noqa: E402

import pytest  # noqa: E402
from agent_tool_sandbox import pinning  # noqa: E402

from pho3nix_recon_http import http_get, url_fetch  # noqa: E402
from pho3nix_recon_http.web_search import SEARCH_URL_ENV  # noqa: E402

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
    "cgnat.example": ["100.64.0.1"],
    "mapped-cgnat.example": ["::ffff:100.64.0.1"],
    "xn--bcher-kva.example": [PUBLIC_V4],
    "my_host.example": [PUBLIC_V4],
}

_PROXY_VARS = (
    "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
)


class FakeResolver:
    def __init__(self) -> None:
        self.records: dict[str, list[str]] = {k: list(v) for k, v in DEFAULT_RECORDS.items()}
        self.wildcard: str | None = None
        self.calls: list[object] = []

    def getaddrinfo(self, host, port, family=0, type=0, proto=0, flags=0):
        self.calls.append(host)
        try:
            return _REAL_GETADDRINFO(
                host, port, family, type, proto, flags | socket.AI_NUMERICHOST
            )
        except socket.gaierror:
            pass
        key = host.encode("idna") if isinstance(host, str) else bytes(host)
        key_s = key.split(b"\x00", 1)[0].decode("ascii").lower().rstrip(".")
        addrs = self.records.get(key_s) or ([self.wildcard] if self.wildcard else None)
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
def network_attempts(monkeypatch: pytest.MonkeyPatch) -> list:
    attempts: list = []

    def _refuse(self, address, *args, **kwargs):
        attempts.append(address)
        raise RuntimeError("network access is disabled in this test suite")

    monkeypatch.setattr(socket.socket, "connect", _refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", _refuse)
    return attempts


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (*_PROXY_VARS, SEARCH_URL_ENV):
        monkeypatch.delenv(name, raising=False)


# ── in-process transport ─────────────────────────────────────────────────────


@dataclass
class Reply:
    status: int = 200
    headers: dict[str, str] = field(default_factory=lambda: {"Content-Type": "text/plain"})
    body: bytes = b""


@dataclass(frozen=True)
class SeenRequest:
    full_url: str
    host: str
    method: str
    headers: tuple[tuple[str, str], ...]
    data: bytes | None

    def header(self, name: str) -> str | None:
        return {k.lower(): v for k, v in self.headers}.get(name.lower())


@dataclass(frozen=True)
class Dial:
    """One pinned connection: where it was allowed to go and what TLS would name."""

    scheme: str
    host: str
    port: int
    addresses: tuple[str, ...]
    server_hostname: str | None  # SNI / certificate name (https only)


Responder = Callable[[urllib.request.Request], Reply]


class FakeHTTPHandler(urllib.request.BaseHandler):
    """Answers http/https opens in-process. Runs ahead of the stock handlers."""

    handler_order = 100  # stock HTTPHandler / HTTPSHandler are 500

    def __init__(self, responder: Responder) -> None:
        self.responder = responder
        self.requests: list[SeenRequest] = []
        self.dials: list[Dial] = []

    def record(self, req: urllib.request.Request) -> None:
        self.requests.append(
            SeenRequest(
                req.full_url, req.host, req.get_method(),
                tuple(sorted(req.header_items())), req.data,
            )
        )

    def respond(self, req: urllib.request.Request):
        reply = self.responder(req)
        msg = email.message.Message()
        for name, value in reply.headers.items():
            msg[name] = value
        resp = urllib.response.addinfourl(io.BytesIO(reply.body), msg, req.full_url, reply.status)
        resp.reason = http.client.responses.get(reply.status, "")  # urllib's do_open reads it
        resp.msg = resp.reason  # read by HTTPErrorProcessor
        return resp

    def _serve(self, req: urllib.request.Request):
        self.record(req)
        return self.respond(req)

    http_open = https_open = _serve


class _RequestTap(urllib.request.BaseHandler):
    """Pinned openers only: hands the final urllib Request to the fake connection.

    Runs after the pinned handler's own request processing (order 500), so the
    headers are the ones the pinned handler will send. The request is recorded only
    when the connection sends it, so one the pinned handler refuses is never seen.
    """

    handler_order = 1000

    def __init__(self) -> None:
        self.pending: urllib.request.Request | None = None

    def _tap(self, req: urllib.request.Request) -> urllib.request.Request:
        self.pending = req
        return req

    http_request = https_request = _tap


def _fake_connection_class(base: type, handler: FakeHTTPHandler, tap: _RequestTap) -> type:
    """``base`` (a Pinned*Connection) with the socket work replaced by the handler."""

    class FakePinnedConnection(base):  # type: ignore[misc, valid-type]
        def connect(self) -> None:
            context = getattr(self, "_pinned_tls_context", None)
            handler.dials.append(Dial(
                "https" if context is not None else "http", self.host, self.port,
                tuple(str(ip) for ip in self.pinned_addresses),
                self.host if context is not None else None,
            ))

        def request(self, method, url, body=None, headers={}, *, encode_chunked=False):
            assert tap.pending is not None and tap.pending.selector == url
            self.connect()
            self._fake_req = tap.pending
            handler.record(self._fake_req)

        def getresponse(self):
            # Raised here, not in request(): urllib wraps an OSError from request()
            # in URLError, but lets getresponse() errors through unchanged, which is
            # what an in-front handler does too.
            return handler.respond(self._fake_req)

        def close(self) -> None:
            pass

    return FakePinnedConnection


def reply_with(
    body: bytes = b"", status: int = 200, content_type: str = "text/plain",
    content_length: bool = True, **extra: str,
) -> Responder:
    headers = {"Content-Type": content_type, **extra}
    if content_length:
        headers["Content-Length"] = str(len(body))
    return lambda req: Reply(status, dict(headers), body)


def install_transport(
    monkeypatch: pytest.MonkeyPatch, modules: Iterable[ModuleType], responder: Responder,
) -> FakeHTTPHandler:
    """Answer every request the given tool modules make with one FakeHTTPHandler.

    A module with ``build_pinned_opener`` (the staged tools) keeps its real pinned
    opener and gets fake connections; one with ``build_no_redirect_opener`` (the
    in-tree tools) gets the handler added in front of the stock ones.
    """
    handler = FakeHTTPHandler(responder)
    tap = _RequestTap()
    pinned = False
    for mod in modules:
        if hasattr(mod, "build_pinned_opener"):
            pinned = True
            real_pinned = mod.build_pinned_opener

            def build_pinned(target, *, context=None, deadline=None, real_pinned=real_pinned):
                opener = real_pinned(target, context=context, deadline=deadline)
                opener.add_handler(tap)
                return opener

            monkeypatch.setattr(mod, "build_pinned_opener", build_pinned)
        else:
            real_build = mod.build_no_redirect_opener

            def build(real_build=real_build):
                opener = real_build()
                opener.add_handler(handler)
                return opener

            monkeypatch.setattr(mod, "build_no_redirect_opener", build)
    if pinned:
        for name in ("PinnedHTTPConnection", "PinnedHTTPSConnection"):
            fake = _fake_connection_class(getattr(pinning, name), handler, tap)
            monkeypatch.setattr(pinning, name, fake)
    return handler


@pytest.fixture
def transport(monkeypatch: pytest.MonkeyPatch):
    def install(
        responder: Responder | None = None,
        modules: Iterable[ModuleType] = (http_get, url_fetch),
    ) -> FakeHTTPHandler:
        return install_transport(monkeypatch, modules, responder or reply_with(b"ok"))

    return install
