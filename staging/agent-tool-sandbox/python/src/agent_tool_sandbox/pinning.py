"""
Connection pinning for the SSRF guard (DNS-rebinding protection), urllib-based.

``assert_safe_fetch_url`` resolves the host and checks every address, then hands back a
URL string; a client that fetches that string resolves the name AGAIN when it connects.
A DNS server that answers public-then-private wins that race. This module closes it:

  - ``resolve_and_validate(url)`` runs the same guard, resolving the host exactly once,
    and returns a ``PinnedTarget`` holding the addresses that passed.
  - ``build_pinned_opener(target)`` / ``pinned_urlopen(url)`` connect ONLY to those
    addresses (in resolver order, falling back on connect errors). No resolver is
    called at connect time. ``Host:`` stays the URL's authority, TLS SNI and certificate
    hostname verification use the original host name.
  - The opener follows no redirects, uses no proxy (an env proxy would resolve the name
    itself, past every IP check) and handles only the pinned scheme, host and port.

Standard library only.
"""
from __future__ import annotations

import errno
import http.client
import ipaddress
import re
import socket
import ssl
import sys
import urllib.request
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Union

from .ssrf_guard import (
    SsrfBlockedError,
    _connect_target,
    _ip_is_blocked,
    _NoRedirect,
    _validate_fetch_url,
)

IPAddress = Union[ipaddress.IPv4Address, ipaddress.IPv6Address]
_HEADER_TOKEN = re.compile(r"[!#$%&'*+\-.^_`|~0-9A-Za-z]+")  # RFC 9110 §5.6.2 token

__all__ = [
    "PinnedHTTPConnection",
    "PinnedHTTPSConnection",
    "PinnedTarget",
    "build_pinned_opener",
    "pinned_urlopen",
    "resolve_and_validate",
]


@dataclass(frozen=True)
class PinnedTarget:
    """A URL that passed the guard, plus the addresses its one resolution returned.

    ``host`` is the ASCII host as http.client sees it (IDNA name, or an IPv6 literal
    without brackets); ``port`` is the effective port; ``canonical_url`` is exactly what
    ``assert_safe_fetch_url`` returns; ``addresses`` are deduplicated, in resolver order,
    IPv4-mapped IPv6 answers unwrapped to IPv4, and every one passed the IP block.
    """

    scheme: str
    host: str
    port: int
    canonical_url: str
    addresses: tuple[IPAddress, ...]


def resolve_and_validate(url: str) -> PinnedTarget:
    """Run the SSRF guard on ``url`` with ONE resolution and return what to connect to.

    Same checks, order and error messages as ``assert_safe_fetch_url``: a URL is
    refused if ANY resolved address is blocked. Raises ``SsrfBlockedError``.
    """
    checked = _validate_fetch_url(url)
    return PinnedTarget(
        scheme=checked.scheme,
        host=checked.host,
        port=checked.port,
        canonical_url=checked.canonical_url,
        addresses=_checked_addresses(checked.ips),
    )


def _checked_addresses(addresses: Iterable[IPAddress | str]) -> tuple[IPAddress, ...]:
    """Normalise, re-check and deduplicate addresses to pin (hand-built lists included)."""
    if isinstance(addresses, (str, bytes)):
        raise SsrfBlockedError("Refusing to pin: addresses must be a list of IPs, not a string")
    out: list[IPAddress] = []
    for raw in addresses:
        if isinstance(raw, (ipaddress.IPv4Address, ipaddress.IPv6Address)):
            ip = raw
        elif isinstance(raw, str):
            try:
                ip = ipaddress.ip_address(raw)
            except ValueError:
                raise SsrfBlockedError(f"Refusing to pin non-IP address {raw!r}")
        else:
            raise SsrfBlockedError(f"Refusing to pin non-IP address {raw!r}")
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
        if _ip_is_blocked(ip):
            raise SsrfBlockedError(f"Refusing blocked IP {ip} (pinned address)")
        if ip not in out:
            out.append(ip)
    if not out:
        raise SsrfBlockedError("Refusing to pin an empty address list")
    return tuple(out)


def _dial(
    addresses: tuple[IPAddress, ...], port: int, timeout: Any, source_address: Any
) -> socket.socket:
    """TCP-connect to the first pinned address that accepts. Never calls a resolver.

    Mirrors ``socket.create_connection`` (per-attempt timeout, optional bind, last error
    re-raised), but builds the sockaddr from the IP itself instead of from getaddrinfo.
    """
    last_error: OSError | None = None
    for ip in addresses:
        if ip.version == 4:
            family, sockaddr = socket.AF_INET, (str(ip), port)
        else:
            family, sockaddr = socket.AF_INET6, (str(ip), port, 0, 0)
        sock = socket.socket(family, socket.SOCK_STREAM)
        try:
            if timeout is not socket._GLOBAL_DEFAULT_TIMEOUT:
                sock.settimeout(timeout)
            if source_address:
                sock.bind(source_address)
            sock.connect(sockaddr)
        except OSError as exc:
            sock.close()
            last_error = exc
            continue
        return sock
    if last_error is None:  # unreachable: _checked_addresses never returns an empty tuple
        raise SsrfBlockedError("Refusing to connect: no pinned address")
    raise last_error


def _disable_nagle(sock: socket.socket) -> None:
    """Same as http.client's connect(): TCP_NODELAY, tolerated where unsupported."""
    try:
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    except OSError as exc:
        if exc.errno != errno.ENOPROTOOPT:
            raise


def _default_tls_context() -> ssl.SSLContext:
    """http.client's default HTTPS context: CERT_REQUIRED, check_hostname, ALPN http/1.1.

    Built with ``ssl.create_default_context()`` directly, so a process-wide
    ``ssl._create_default_https_context = ssl._create_unverified_context`` hack does
    not turn verification off here.
    """
    context = ssl.create_default_context()
    context.set_alpn_protocols(["http/1.1"])
    if context.post_handshake_auth is not None:
        context.post_handshake_auth = True
    return context


class _PinnedConnectionMixin:
    """Shared by both pinned connection classes."""

    pinned_addresses: tuple[IPAddress, ...]

    def set_tunnel(self, host: str, port: int | None = None, headers: Any = None) -> None:
        raise SsrfBlockedError(
            "Refusing to tunnel a pinned connection: a proxy resolves the name itself"
        )


class PinnedHTTPConnection(_PinnedConnectionMixin, http.client.HTTPConnection):
    """``http.client.HTTPConnection`` that dials only ``addresses``.

    ``host`` (and ``port``) keep their usual meaning for the request line and the
    ``Host:`` header; the TCP connection goes to the first of ``addresses`` that
    accepts. ``addresses`` are re-checked against the IP block on construction.
    """

    def __init__(
        self, host: str, port: int | None = None, *,
        addresses: Iterable[IPAddress | str], **kwargs: Any,
    ) -> None:
        super().__init__(host, port, **kwargs)
        self.pinned_addresses = _checked_addresses(addresses)

    def connect(self) -> None:
        sys.audit("http.client.connect", self, self.host, self.port)
        sock = _dial(self.pinned_addresses, self.port, self.timeout, self.source_address)
        try:
            _disable_nagle(sock)
        except BaseException:
            sock.close()
            raise
        self.sock = sock


class PinnedHTTPSConnection(_PinnedConnectionMixin, http.client.HTTPSConnection):
    """``http.client.HTTPSConnection`` that dials only ``addresses``.

    TLS runs over the pinned socket with ``server_hostname=host``, so SNI carries the
    original name and, with the default context (CERT_REQUIRED, check_hostname=True),
    the certificate is verified against that name, not against the IP.
    """

    def __init__(
        self, host: str, port: int | None = None, *,
        addresses: Iterable[IPAddress | str], context: ssl.SSLContext | None = None,
        **kwargs: Any,
    ) -> None:
        if context is None:
            context = _default_tls_context()
        super().__init__(host, port, context=context, **kwargs)
        self.pinned_addresses = _checked_addresses(addresses)
        self._pinned_tls_context = context

    def connect(self) -> None:
        sys.audit("http.client.connect", self, self.host, self.port)
        sock = _dial(self.pinned_addresses, self.port, self.timeout, self.source_address)
        try:
            _disable_nagle(sock)
            self.sock = self._pinned_tls_context.wrap_socket(sock, server_hostname=self.host)
        except BaseException:
            sock.close()
            raise


def _assert_host_header(req: urllib.request.Request) -> None:
    """A caller-set Host header must name the pinned authority (no vhost steering).

    Header names must be RFC 9110 tokens: 'Host ' or ' Host' would otherwise skip the
    check below and still reach the wire as a second Host line.
    """
    expected = req.host.lower()
    for name, value in (*req.headers.items(), *req.unredirected_hdrs.items()):
        if not _HEADER_TOKEN.fullmatch(name):
            raise SsrfBlockedError(f"Refusing header name {name!r}: not an RFC 9110 token")
        if name.lower() == "host" and str(value).strip().lower() != expected:
            raise SsrfBlockedError(
                f"Refusing Host header {value!r}: the pinned request is for {req.host!r}"
            )


class _PinnedHandler(urllib.request.AbstractHTTPHandler):
    """http_open / https_open that only ever reach the pinned target's addresses."""

    def __init__(self, target: PinnedTarget, tls_context: ssl.SSLContext | None) -> None:
        super().__init__()
        self._target = target
        self._tls_context = tls_context

    def _open(self, req: urllib.request.Request, scheme: str) -> http.client.HTTPResponse:
        target = self._target
        if scheme != target.scheme:
            raise SsrfBlockedError(
                f"Refusing {scheme} request: opener is pinned to {target.canonical_url!r}"
            )
        _assert_host_header(req)

        def connection(host: str, **kwargs: Any) -> http.client.HTTPConnection:
            conn: http.client.HTTPConnection
            if scheme == "https":
                conn = PinnedHTTPSConnection(
                    host, addresses=target.addresses, context=self._tls_context, **kwargs
                )
            else:
                conn = PinnedHTTPConnection(host, addresses=target.addresses, **kwargs)
            if (conn.host.lower(), conn.port) != (target.host, target.port):
                raise SsrfBlockedError(
                    f"Refusing request for {(conn.host, conn.port)!r}: opener is pinned "
                    f"to {(target.host, target.port)!r}"
                )
            return conn

        return self.do_open(connection, req)

    def http_open(self, req: urllib.request.Request) -> http.client.HTTPResponse:
        return self._open(req, "http")

    def https_open(self, req: urllib.request.Request) -> http.client.HTTPResponse:
        return self._open(req, "https")

    http_request = https_request = urllib.request.AbstractHTTPHandler.do_request_


def build_pinned_opener(
    target: PinnedTarget, *, context: ssl.SSLContext | None = None
) -> urllib.request.OpenerDirector:
    """A urllib opener that connects only to ``target.addresses``.

    Only http(s) requests for ``target``'s scheme, host and port are served; anything
    else raises ``SsrfBlockedError`` (other http(s) targets) or ``URLError`` (other
    schemes: no file, ftp or data handler is installed). Redirects raise
    ``SsrfBlockedError`` like ``build_no_redirect_opener``. No proxy is used, whatever
    the environment says. ``context`` replaces the default verifying TLS context.
    The target is re-checked, so a hand-built ``PinnedTarget`` gets the same IP policy.
    """
    if not isinstance(target, PinnedTarget):
        raise TypeError(f"expected PinnedTarget, got {type(target).__name__}")
    if target.scheme not in ("http", "https"):
        raise SsrfBlockedError(f"Refusing non-http(s) scheme {target.scheme!r}")
    _checked_addresses(target.addresses)
    if _connect_target(target.canonical_url) != (target.host, target.port):
        raise SsrfBlockedError(
            f"Refusing inconsistent PinnedTarget: {target.canonical_url!r} does not "
            f"connect to {(target.host, target.port)!r}"
        )
    if target.scheme == "https" and context is None:
        context = _default_tls_context()
    # Assembled by hand, not with build_opener(): build_opener() adds a ProxyHandler that
    # reads http_proxy/https_proxy/all_proxy, and urllib consults proxies ONLY through a
    # ProxyHandler. (ProxyHandler({}) would be a no-op: add_handler drops a handler with
    # no protocol methods.) It also adds file/ftp/data handlers, which are left out here.
    opener = urllib.request.OpenerDirector()
    for handler in (
        _PinnedHandler(target, context),
        _NoRedirect(),
        urllib.request.HTTPDefaultErrorHandler(),
        urllib.request.HTTPErrorProcessor(),
        urllib.request.UnknownHandler(),
    ):
        opener.add_handler(handler)
    return opener


def pinned_urlopen(
    url: str,
    data: bytes | None = None,
    *,
    timeout: float | None = 30.0,
    headers: Mapping[str, str] | None = None,
    method: str | None = None,
    context: ssl.SSLContext | None = None,
) -> http.client.HTTPResponse:
    """Guard ``url``, resolve it once, and fetch it over a connection pinned to the result.

    ``timeout`` applies to each socket operation (each connect attempt, each read), not
    to the whole request. Raises ``SsrfBlockedError`` on a guard refusal or redirect,
    ``urllib.error.HTTPError`` on other 4xx/5xx/3xx statuses, ``urllib.error.URLError``
    when no pinned address accepts the connection.
    """
    target = resolve_and_validate(url)
    opener = build_pinned_opener(target, context=context)
    request = urllib.request.Request(
        target.canonical_url, data=data, headers=dict(headers or {}), method=method
    )
    return opener.open(request, timeout=timeout)
