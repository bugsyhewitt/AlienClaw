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
  - ``pinned_urlopen`` spends ONE monotonic deadline (``timeout``) on the resolution,
    every connect attempt, TLS, sending, the response head and every body read, and can
    follow redirects on request (``follow_redirects=N``), checking and pinning each hop.

Standard library only.
"""
from __future__ import annotations

import errno
import http.client
import io
import ipaddress
import math
import re
import socket
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Union
from urllib.parse import urljoin, urlsplit

from .ssrf_guard import (
    SsrfBlockedError,
    _assert_unambiguous_chars,
    _connect_target,
    _ip_is_blocked,
    _NoRedirect,
    _redact_url,
    _validate_fetch_url,
)

IPAddress = Union[ipaddress.IPv4Address, ipaddress.IPv6Address]
_HEADER_TOKEN = re.compile(r"[!#$%&'*+\-.^_`|~0-9A-Za-z]+")  # RFC 9110 §5.6.2 token

__all__ = [
    "DeadlineExceededError",
    "PinnedHTTPConnection",
    "PinnedHTTPSConnection",
    "PinnedTarget",
    "build_pinned_opener",
    "pinned_urlopen",
    "resolve_and_validate",
]


class DeadlineExceededError(urllib.error.URLError, TimeoutError):
    """The total timeout ran out (``pinned_urlopen``'s ``timeout``, or a ``deadline=``).

    Both a ``TimeoutError`` and a ``urllib.error.URLError``, so code written for the old
    per-operation timeouts (``URLError`` while connecting, ``TimeoutError`` while reading)
    still catches it. ``phase`` says what was running when it ran out.
    """

    def __init__(self, phase: str) -> None:
        super().__init__(f"total timeout exceeded while {phase}")
        self.args = (phase,)
        self.phase = phase

    def __str__(self) -> str:
        return str(self.reason)


class _Budget:
    """Per-operation socket timeouts that never outlast one ``time.monotonic()`` deadline."""

    def __init__(self, deadline: float, per_operation: Any) -> None:
        self.deadline = deadline
        self.per_operation = per_operation  # the connection's own timeout, kept as a cap

    def check(self, phase: str) -> float:
        """Seconds left; raises ``DeadlineExceededError`` when there are none."""
        left = self.deadline - time.monotonic()
        if left <= 0:
            raise DeadlineExceededError(phase)
        return left

    def arm(self, sock: Any, phase: str) -> bool:
        """Set ``sock``'s timeout for its next operation; True if the deadline bounds it."""
        left = self.check(phase)
        cap = self.per_operation
        if cap is socket._GLOBAL_DEFAULT_TIMEOUT:
            cap = socket.getdefaulttimeout()
        if cap is None or cap >= left:
            sock.settimeout(left)
            return True
        sock.settimeout(cap)
        return False


def _deadline_after(timeout: Any) -> float | None:
    """``time.monotonic()`` deadline for a total ``timeout`` in seconds (None: no deadline)."""
    if timeout is None:
        return None
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)):
        raise TypeError(f"timeout must be a number of seconds or None, not {timeout!r}")
    if not (math.isfinite(timeout) and timeout > 0):
        raise ValueError(f"timeout must be a positive, finite number of seconds, not {timeout!r}")
    return time.monotonic() + timeout


def _check_deadline_type(deadline: Any) -> None:
    if deadline is not None and (isinstance(deadline, bool)
                                 or not isinstance(deadline, (int, float))):
        raise TypeError(f"deadline must be a time.monotonic() value, not {deadline!r}")


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
        if _ip_is_blocked(ip):  # caller-supplied addresses: naming them discloses nothing
            raise SsrfBlockedError(
                f"Refusing blocked IP {ip} (pinned address)", blocked_address=ip
            )
        if ip not in out:
            out.append(ip)
    if not out:
        raise SsrfBlockedError("Refusing to pin an empty address list")
    return tuple(out)


def _dial(
    addresses: tuple[IPAddress, ...], port: int, timeout: Any, source_address: Any,
    budget: _Budget | None = None,
) -> socket.socket:
    """TCP-connect to the first pinned address that accepts. Never calls a resolver.

    Mirrors ``socket.create_connection`` (per-attempt timeout, optional bind, last error
    re-raised), but builds the sockaddr from the IP itself instead of from getaddrinfo.
    With a ``budget``, each attempt gets only what is left of the deadline, so the
    number of addresses (which the name's DNS chooses) cannot stretch the call (PR-02).
    """
    last_error: OSError | None = None
    for ip in addresses:
        if ip.version == 4:
            family, sockaddr = socket.AF_INET, (str(ip), port)
        else:
            family, sockaddr = socket.AF_INET6, (str(ip), port, 0, 0)
        if budget is not None:
            budget.check("connecting")
        sock = socket.socket(family, socket.SOCK_STREAM)
        bounded = False
        try:
            if budget is not None:
                bounded = budget.arm(sock, "connecting")
            elif timeout is not socket._GLOBAL_DEFAULT_TIMEOUT:
                sock.settimeout(timeout)
            if source_address:
                sock.bind(source_address)
            sock.connect(sockaddr)
        except DeadlineExceededError:
            sock.close()
            raise
        except OSError as exc:
            sock.close()
            if budget is not None and (
                (bounded and isinstance(exc, TimeoutError))
                or time.monotonic() >= budget.deadline
            ):
                raise DeadlineExceededError("connecting") from exc
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


_SEND_CHUNK = 16384  # one TLS record: SSLSocket.sendall restarts its timeout per record


class _DeadlineReader(io.RawIOBase):
    """Raw response reader: every socket read gets only what is left of the deadline.

    A per-socket timeout restarts on every read, so a server that drips one byte per
    second never trips it; re-arming the timeout from the deadline before each read
    does (G4). Wraps ``sock.makefile("rb", buffering=0)``, which keeps the descriptor
    alive after urllib closes the connection's socket, as the stock response does.
    """

    def __init__(self, sock: Any, budget: _Budget) -> None:
        super().__init__()
        self._sock = sock
        self._raw = sock.makefile("rb", buffering=0)
        self._budget = budget

    def readable(self) -> bool:
        return True

    def readinto(self, buffer: Any) -> int | None:
        bounded = self._budget.arm(self._sock, "reading the response")
        try:
            return self._raw.readinto(buffer)
        except TimeoutError as exc:
            if bounded:
                raise DeadlineExceededError("reading the response") from exc
            raise

    def fileno(self) -> int:
        return self._raw.fileno()

    def close(self) -> None:
        if not self.closed:
            try:
                self._raw.close()
            finally:
                super().close()


class _DeadlineBufferedReader(io.BufferedReader):
    """The response's ``fp``: refuses every read once the deadline has passed.

    Bytes buffered ahead are refused too, so "the deadline covers the body" holds however
    the body arrived (the TypeScript twin aborts its body stream the same way).
    """

    def __init__(self, raw: _DeadlineReader, budget: _Budget) -> None:
        super().__init__(raw)
        self._budget = budget

    def _check(self) -> None:
        self._budget.check("reading the response")

    def read(self, size: int | None = -1) -> bytes:
        self._check()
        return super().read(size)

    def read1(self, size: int = -1) -> bytes:
        self._check()
        return super().read1(size)

    def readinto(self, buffer: Any) -> int:
        self._check()
        return super().readinto(buffer)

    def readinto1(self, buffer: Any) -> int:
        self._check()
        return super().readinto1(buffer)

    def readline(self, size: int | None = -1) -> bytes:
        self._check()
        return super().readline(size)

    def peek(self, size: int = 0) -> bytes:
        self._check()
        return super().peek(size)


class _DeadlineSocketView:
    """What ``HTTPResponse`` is given as its socket: it only ever calls ``makefile``."""

    def __init__(self, sock: Any, budget: _Budget) -> None:
        self._sock = sock
        self._budget = budget

    def makefile(self, mode: str = "rb", *args: Any, **kwargs: Any) -> io.BufferedReader:
        return _DeadlineBufferedReader(_DeadlineReader(self._sock, self._budget), self._budget)


class _PinnedConnectionMixin:
    """Shared by both pinned connection classes."""

    pinned_addresses: tuple[IPAddress, ...]
    sock: Any
    auto_open: int
    timeout: Any
    _budget: _Budget | None

    def _init_deadline(self, deadline: float | None) -> None:
        _check_deadline_type(deadline)
        self._budget = None if deadline is None else _Budget(deadline, self.timeout)
        if self._budget is not None:
            self.response_class = self._deadline_response

    def _deadline_response(self, sock: Any, *args: Any, **kwargs: Any) -> Any:
        assert self._budget is not None
        return http.client.HTTPResponse(_DeadlineSocketView(sock, self._budget), *args, **kwargs)

    def send(self, data: Any) -> None:
        budget = self._budget
        if budget is None:
            super().send(data)  # type: ignore[misc]
            return
        if self.sock is None:
            if not self.auto_open:
                raise http.client.NotConnected()
            self.connect()  # type: ignore[attr-defined]
        chunks: Iterable[Any]
        try:
            view = memoryview(data).cast("B")
        except (TypeError, ValueError):  # a file or an iterable: http.client splits it
            chunks = (data,)
        else:
            chunks = (view[i:i + _SEND_CHUNK] for i in range(0, max(len(view), 1), _SEND_CHUNK))
        for chunk in chunks:
            bounded = budget.arm(self.sock, "sending the request")
            try:
                super().send(chunk)  # type: ignore[misc]
            except TimeoutError as exc:
                if bounded:
                    raise DeadlineExceededError("sending the request") from exc
                raise

    def set_tunnel(self, host: str, port: int | None = None, headers: Any = None) -> None:
        raise SsrfBlockedError(
            "Refusing to tunnel a pinned connection: a proxy resolves the name itself"
        )


class PinnedHTTPConnection(_PinnedConnectionMixin, http.client.HTTPConnection):
    """``http.client.HTTPConnection`` that dials only ``addresses``.

    ``host`` (and ``port``) keep their usual meaning for the request line and the
    ``Host:`` header; the TCP connection goes to the first of ``addresses`` that
    accepts. ``addresses`` are re-checked against the IP block on construction.
    ``deadline`` (a ``time.monotonic()`` value) bounds connecting, sending and every
    response read in total; ``timeout`` then caps each operation as usual.
    """

    def __init__(
        self, host: str, port: int | None = None, *,
        addresses: Iterable[IPAddress | str], deadline: float | None = None, **kwargs: Any,
    ) -> None:
        super().__init__(host, port, **kwargs)
        self.pinned_addresses = _checked_addresses(addresses)
        self._init_deadline(deadline)

    def connect(self) -> None:
        sys.audit("http.client.connect", self, self.host, self.port)
        sock = _dial(
            self.pinned_addresses, self.port, self.timeout, self.source_address, self._budget
        )
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
        deadline: float | None = None, **kwargs: Any,
    ) -> None:
        if context is None:
            context = _default_tls_context()
        super().__init__(host, port, context=context, **kwargs)
        self.pinned_addresses = _checked_addresses(addresses)
        self._pinned_tls_context = context
        self._init_deadline(deadline)

    def connect(self) -> None:
        sys.audit("http.client.connect", self, self.host, self.port)
        sock = _dial(
            self.pinned_addresses, self.port, self.timeout, self.source_address, self._budget
        )
        try:
            _disable_nagle(sock)
            # The socket timeout bounds the WHOLE handshake (CPython 3.5+), so arming it
            # with what is left of the deadline bounds TLS.
            bounded = self._budget is not None and self._budget.arm(sock, "in the TLS handshake")
            try:
                self.sock = self._pinned_tls_context.wrap_socket(sock, server_hostname=self.host)
            except TimeoutError as exc:
                if bounded:
                    raise DeadlineExceededError("in the TLS handshake") from exc
                raise
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

    def __init__(
        self, target: PinnedTarget, tls_context: ssl.SSLContext | None,
        deadline: float | None = None,
    ) -> None:
        super().__init__()
        self._target = target
        self._tls_context = tls_context
        self._deadline = deadline

    def _open(self, req: urllib.request.Request, scheme: str) -> http.client.HTTPResponse:
        target = self._target
        if scheme != target.scheme:
            raise SsrfBlockedError(
                f"Refusing {scheme} request: opener is pinned to "
                f"{_redact_url(target.canonical_url)!r}"
            )
        _assert_host_header(req)
        deadline = self._deadline

        def connection(host: str, **kwargs: Any) -> http.client.HTTPConnection:
            conn: http.client.HTTPConnection
            if scheme == "https":
                conn = PinnedHTTPSConnection(
                    host, addresses=target.addresses, context=self._tls_context,
                    deadline=deadline, **kwargs,
                )
            else:
                conn = PinnedHTTPConnection(
                    host, addresses=target.addresses, deadline=deadline, **kwargs
                )
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
    target: PinnedTarget, *, context: ssl.SSLContext | None = None,
    deadline: float | None = None,
) -> urllib.request.OpenerDirector:
    """A urllib opener that connects only to ``target.addresses``.

    Only http(s) requests for ``target``'s scheme, host and port are served; anything
    else raises ``SsrfBlockedError`` (other http(s) targets) or ``URLError`` (other
    schemes: no file, ftp or data handler is installed). Redirects raise
    ``SsrfBlockedError`` like ``build_no_redirect_opener``. No proxy is used, whatever
    the environment says. ``context`` replaces the default verifying TLS context.
    The target is re-checked, so a hand-built ``PinnedTarget`` gets the same IP policy.

    ``deadline`` (a ``time.monotonic()`` value; default none) bounds every request made
    through the opener in total (connect attempts, TLS, sending, every response read)
    and raises ``DeadlineExceededError``; ``open(..., timeout=)`` still caps each operation.
    Without it, ``timeout`` is per operation only, as in urllib.
    """
    return _assemble_opener(target, context, deadline, _NoRedirect())


def _assemble_opener(
    target: PinnedTarget, context: ssl.SSLContext | None, deadline: float | None,
    redirect_handler: urllib.request.BaseHandler,
) -> urllib.request.OpenerDirector:
    if not isinstance(target, PinnedTarget):
        raise TypeError(f"expected PinnedTarget, got {type(target).__name__}")
    if target.scheme not in ("http", "https"):
        raise SsrfBlockedError(f"Refusing non-http(s) scheme {target.scheme!r}")
    _checked_addresses(target.addresses)
    if _connect_target(target.canonical_url) != (target.host, target.port):
        raise SsrfBlockedError(
            f"Refusing inconsistent PinnedTarget: {_redact_url(target.canonical_url)!r} "
            f"does not connect to {(target.host, target.port)!r}"
        )
    _check_deadline_type(deadline)
    if target.scheme == "https" and context is None:
        context = _default_tls_context()
    # Assembled by hand, not with build_opener(): build_opener() adds a ProxyHandler that
    # reads http_proxy/https_proxy/all_proxy, and urllib consults proxies ONLY through a
    # ProxyHandler. (ProxyHandler({}) would be a no-op: add_handler drops a handler with
    # no protocol methods.) It also adds file/ftp/data handlers, which are left out here.
    opener = urllib.request.OpenerDirector()
    for handler in (
        _PinnedHandler(target, context, deadline),
        redirect_handler,
        urllib.request.HTTPDefaultErrorHandler(),
        urllib.request.HTTPErrorProcessor(),
        urllib.request.UnknownHandler(),
    ):
        opener.add_handler(handler)
    return opener


# getaddrinfo cannot be interrupted, so under a deadline the one resolution runs in a
# daemon thread that the caller stops waiting for at the deadline. At most this many
# lookups run at once, abandoned ones included: past the cap a call fails closed
# (DeadlineExceededError) instead of starting more threads. An abandoned thread ends when the
# system resolver gives up (resolv.conf timeout x attempts), and its answer is discarded.
_MAX_RESOLVER_THREADS = 16
_RESOLVER_SLOTS = threading.BoundedSemaphore(_MAX_RESOLVER_THREADS)


def _resolve_within(url: str, deadline: float | None) -> PinnedTarget:
    """``resolve_and_validate(url)``, abandoned with ``DeadlineExceededError`` at ``deadline``."""
    if deadline is None:
        return resolve_and_validate(url)
    slots = _RESOLVER_SLOTS
    left = deadline - time.monotonic()
    if left <= 0 or not slots.acquire(timeout=left):
        raise DeadlineExceededError("waiting for a resolver thread")
    outcome: list[Any] = []
    done = threading.Event()

    def work() -> None:
        try:
            outcome.append(resolve_and_validate(url))
        except BaseException as exc:  # handed to the caller, who re-raises it
            outcome.append(exc)
        finally:
            slots.release()
            done.set()

    try:
        threading.Thread(target=work, name="pinned-resolve", daemon=True).start()
    except BaseException:
        slots.release()
        raise
    if not done.wait(max(deadline - time.monotonic(), 0)):
        raise DeadlineExceededError("resolving the host name")
    result = outcome[0]
    if isinstance(result, BaseException):
        raise result
    return result


_MAX_FOLLOW_REDIRECTS = 20
_CREDENTIAL_HEADERS = frozenset({"authorization", "cookie", "proxy-authorization"})
_BODY_HEADERS = frozenset({"content-type", "content-length", "content-encoding",
                           "content-language", "content-location", "transfer-encoding"})


class _RedirectReceivedError(Exception):
    """Internal: a 3xx with a Location, raised out of opener.open to pinned_urlopen."""

    def __init__(self, code: int, location: str) -> None:
        super().__init__(code, location)
        self.code = code
        self.location = location


class _HandBackRedirect(urllib.request.HTTPRedirectHandler):
    """Hands every redirect back to ``pinned_urlopen`` instead of following it here.

    Only 301/302/303/307/308 reach it (Fetch's redirect statuses); any other 3xx, Location
    or not, is left to ``HTTPDefaultErrorHandler`` and raises ``HTTPError``.
    """

    def http_error_302(self, req, fp, code, msg, headers):  # noqa: N802
        locations = headers.get_all("Location") or []
        if len(locations) > 1:
            # urllib took the first one, the TS twin's header join made one URL of them
            # all; browsers refuse the response (ERR_RESPONSE_HEADERS_MULTIPLE_LOCATION).
            fp.close()
            raise SsrfBlockedError(
                f"Refusing redirect (status {code}): {len(locations)} Location headers"
            )
        if not locations or not locations[0].strip(" \t"):
            # No Location, or an empty one: HTTPDefaultErrorHandler raises HTTPError, as
            # urllib does. An empty Location is not followed as a reference to the current
            # URL (RFC 3986 5.2), which only requested the same URL again up to the hop cap.
            return None
        fp.close()  # the redirect body is never read
        raise _RedirectReceivedError(code, locations[0])

    http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302


def _location_text(location: str) -> str:
    """A Location header as the text its sender meant: its bytes read as UTF-8.

    http.client decodes header bytes as Latin-1, so a UTF-8 ``/café`` arrives as
    ``/cafÃ©``. A value that is not ASCII is turned back into its bytes and decoded as
    UTF-8, invalid sequences becoming U+FFFD, as browsers and fetch() do (undici's
    ``normalizeBinaryStringToUtf8``; the TS twin does the same).
    """
    if location.isascii():
        return location
    try:
        raw = location.encode("latin-1")
    except UnicodeEncodeError:  # not a Latin-1 decoding of header bytes: keep it as it is
        return location
    return raw.decode("utf-8", "replace")


def _redirect_limit(follow_redirects: Any) -> int:
    if isinstance(follow_redirects, bool) or not isinstance(follow_redirects, int):
        raise TypeError(f"follow_redirects must be an int, not {follow_redirects!r}")
    if not 0 <= follow_redirects <= _MAX_FOLLOW_REDIRECTS:
        raise ValueError(
            f"follow_redirects must be 0 to {_MAX_FOLLOW_REDIRECTS}, not {follow_redirects}"
        )
    return follow_redirects


def _origin(target: PinnedTarget) -> tuple[str, str, int]:
    return target.scheme, target.host, target.port


def pinned_urlopen(
    url: str,
    data: bytes | None = None,
    *,
    timeout: float | None = 30.0,
    headers: Mapping[str, str] | None = None,
    method: str | None = None,
    context: ssl.SSLContext | None = None,
    follow_redirects: int = 0,
) -> http.client.HTTPResponse:
    """Guard ``url``, resolve it once, and fetch it over a connection pinned to the result.

    ``timeout`` is the TOTAL budget in seconds, from the call to the last body read: the
    resolution, every connect attempt (each gets only what is left), TLS, sending, the
    response head, every read of the returned response, and every redirect hop. When it
    runs out, ``DeadlineExceededError`` (a ``TimeoutError`` and a ``URLError``) is raised.
    ``None`` means no deadline and blocking sockets.

    ``follow_redirects`` (default 0) is the number of redirect hops to follow. With 0 a
    301/302/303/307/308 raises ``SsrfBlockedError``. With N > 0 each hop is guarded and
    pinned afresh, https never redirects to http, Authorization/Cookie/Proxy-Authorization
    (and a caller-set Host) are dropped on a hop to another origin, 307/308 keep the
    method and body, and 301/302/303 become a GET (HEAD stays HEAD) without a body.

    Raises ``SsrfBlockedError`` on a guard refusal or a refused redirect,
    ``urllib.error.HTTPError`` on other 4xx/5xx/3xx statuses, ``urllib.error.URLError``
    when no pinned address accepts the connection.
    """
    deadline = _deadline_after(timeout)
    max_hops = _redirect_limit(follow_redirects)
    hop_headers = dict(headers or {})
    target = _resolve_within(url, deadline)
    hops = 0
    while True:
        handler = _NoRedirect() if max_hops == 0 else _HandBackRedirect()
        opener = _assemble_opener(target, context, deadline, handler)
        request = urllib.request.Request(
            target.canonical_url, data=data, headers=hop_headers, method=method
        )
        try:
            return opener.open(request, timeout=timeout)
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", None)
            wrapped = not isinstance(exc, DeadlineExceededError)
            if wrapped and isinstance(reason, DeadlineExceededError):
                raise reason from reason.__cause__  # urllib wrapped it while connecting
            raise
        except _RedirectReceivedError as redirect:
            if hops >= max_hops:
                raise SsrfBlockedError(
                    f"Redirect to {_redact_url(redirect.location)!r} blocked: "
                    f"more than {max_hops} redirects"
                ) from None
            hops += 1
            next_url = urljoin(target.canonical_url, _location_text(redirect.location))
            try:
                next_scheme = urlsplit(next_url).scheme.lower()
            except ValueError:
                next_scheme = ""  # malformed: resolve_and_validate refuses it below
            if target.scheme == "https" and next_scheme == "http":
                raise SsrfBlockedError(
                    f"Refusing redirect to {_redact_url(next_url)!r}: https to http downgrade"
                ) from None
            # The guard applies its character rule to the decoded URL, then percent-encodes
            # non-ASCII in the path, query and fragment, as it does for the caller's URL.
            # The rule runs here too, so a refusal does not wait for a resolver slot.
            _assert_unambiguous_chars(next_url)
            next_target = _resolve_within(next_url, deadline)
            if redirect.code in (301, 302, 303):
                method = "HEAD" if request.get_method() == "HEAD" else "GET"
                data = None
                hop_headers = {k: v for k, v in hop_headers.items()
                               if k.lower() not in _BODY_HEADERS}
            else:  # 307 / 308: same method, same body
                method = request.get_method()
                if data is not None and not isinstance(data, (bytes, bytearray, memoryview)):
                    raise TypeError("a 307/308 redirect can only replay a bytes body") from None
            if _origin(next_target) != _origin(target):
                hop_headers = {k: v for k, v in hop_headers.items()
                               if k.lower() not in _CREDENTIAL_HEADERS and k.lower() != "host"}
            target = next_target
