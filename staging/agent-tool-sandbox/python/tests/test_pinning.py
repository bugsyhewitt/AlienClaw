"""Connection pinning (DNS-rebinding protection): resolve once, dial only vetted IPs.

Network-free. ``wire`` replaces ``socket.socket`` with a fake that records the
address each socket connects to and every byte sent, and answers with a canned
HTTP response, so the REAL urllib + http.client stack runs end to end (request
serialisation, response parsing, redirect and error handlers). ``tls`` replaces
``ssl.SSLContext.wrap_socket`` and records the context and ``server_hostname``.
DNS is the conftest fake, or a rebinding resolver installed per test.
"""
from __future__ import annotations

import errno
import io
import ipaddress
import socket
import ssl
import urllib.error
import urllib.request
from types import SimpleNamespace

import pytest

import agent_tool_sandbox
from agent_tool_sandbox import (
    PinnedTarget,
    SsrfBlockedError,
    assert_safe_fetch_url,
    build_no_redirect_opener,
    build_pinned_opener,
    pinned_urlopen,
    resolve_and_validate,
)
from agent_tool_sandbox.pinning import PinnedHTTPConnection, PinnedHTTPSConnection

PUBLIC_V4 = "93.184.216.34"
PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946"
PROXY = "http://10.9.9.9:3128"
PROXY_VARS = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy",
              "all_proxy")


def _response(code: int = 200, headers: dict[str, str] | None = None, body: bytes = b"ok"):
    lines = [f"HTTP/1.1 {code} X", f"Content-Length: {len(body)}", "Connection: close"]
    lines += [f"{k}: {v}" for k, v in (headers or {}).items()]
    return ("\r\n".join(lines) + "\r\n\r\n").encode("latin-1") + body


class FakeSocket:
    """Stands in for socket.socket. ``wire`` is bound per test by the fixture."""

    wire: SimpleNamespace

    def __init__(self, family=-1, type=-1, proto=-1, fileno=None) -> None:
        self.family = family
        self.type = type
        self.connected_to = None
        self.timeout = "never set"
        self.bound = None
        self.sent = bytearray()
        self.closed = False
        self.wire.sockets.append(self)

    def settimeout(self, value) -> None:
        self.timeout = value

    def bind(self, addr) -> None:
        self.bound = addr

    def connect(self, addr) -> None:
        if addr[0] in self.wire.refuse:
            raise ConnectionRefusedError(errno.ECONNREFUSED, "Connection refused")
        self.connected_to = addr

    def setsockopt(self, *args) -> None:
        pass

    def sendall(self, data) -> None:
        self.sent += data

    def makefile(self, mode="rb", *args, **kwargs):
        return io.BytesIO(self.wire.response)

    def close(self) -> None:
        self.closed = True

    def request(self) -> tuple[str, dict[str, str]]:
        """(request line, {lower-case header name: value}) of what was sent."""
        head = bytes(self.sent).split(b"\r\n\r\n", 1)[0].decode("latin-1").split("\r\n")
        headers = {}
        for line in head[1:]:
            name, _, value = line.partition(":")
            headers[name.strip().lower()] = value.strip()
        return head[0], headers


@pytest.fixture
def wire(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    state = SimpleNamespace(sockets=[], refuse=set(), response=_response())
    monkeypatch.setattr(socket, "socket", type("BoundFakeSocket", (FakeSocket,), {"wire": state}))
    return state


@pytest.fixture
def tls(monkeypatch: pytest.MonkeyPatch) -> list[SimpleNamespace]:
    calls: list[SimpleNamespace] = []

    def wrap_socket(ctx, sock, *args, server_hostname=None, **kwargs):
        calls.append(SimpleNamespace(context=ctx, sock=sock, server_hostname=server_hostname))
        return sock

    monkeypatch.setattr(ssl.SSLContext, "wrap_socket", wrap_socket)
    return calls


@pytest.fixture(autouse=True)
def _no_proxy_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (*PROXY_VARS, "NO_PROXY", "no_proxy", "REQUEST_METHOD"):
        monkeypatch.delenv(name, raising=False)


def _entry(ip: str, port) -> tuple:
    if ipaddress.ip_address(ip).version == 4:
        return (socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port or 0))
    return (socket.AF_INET6, socket.SOCK_STREAM, 6, "", (ip, port or 0, 0, 0))


class RebindingResolver:
    """A hostile DNS server: a public answer the first time, an internal one after."""

    def __init__(self, first: str = PUBLIC_V4, later: str = "127.0.0.1") -> None:
        self.first = first
        self.later = later
        self.calls: list[object] = []

    def __call__(self, host, port, family=0, type=0, proto=0, flags=0):
        self.calls.append(host)
        return [_entry(self.first if len(self.calls) == 1 else self.later, port)]


# ── The rebinding attack ─────────────────────────────────────────────────────


def test_control_unpinned_composition_is_rebindable(monkeypatch, wire) -> None:
    # The pre-pinning recipe (guard, then build_no_redirect_opener) under the same
    # hostile resolver: urllib resolves AGAIN at connect time and lands on 127.0.0.1.
    # This proves the harness detects a re-resolving client, so the pinned test below
    # would fail if pinning ever fell back to resolving at connect time.
    resolver = RebindingResolver()
    monkeypatch.setattr(socket, "getaddrinfo", resolver)
    url = assert_safe_fetch_url("http://rebind.example/x")
    with build_no_redirect_opener().open(url, timeout=5) as resp:
        assert resp.read() == b"ok"
    assert len(resolver.calls) == 2
    assert [s.connected_to for s in wire.sockets] == [("127.0.0.1", 80)]


def test_rebinding_cannot_move_a_pinned_connection(monkeypatch, wire) -> None:
    resolver = RebindingResolver()
    monkeypatch.setattr(socket, "getaddrinfo", resolver)
    with pinned_urlopen("http://rebind.example/x?y=1", timeout=5) as resp:
        assert resp.status == 200
        assert resp.read() == b"ok"
    assert resolver.calls == ["rebind.example"]  # exactly one resolution for the fetch
    assert [s.connected_to for s in wire.sockets] == [(PUBLIC_V4, 80)]
    line, headers = wire.sockets[0].request()
    assert line == "GET /x?y=1 HTTP/1.1"
    assert headers["host"] == "rebind.example"


def test_rebinding_cannot_move_a_pinned_tls_connection(monkeypatch, wire, tls) -> None:
    resolver = RebindingResolver()
    monkeypatch.setattr(socket, "getaddrinfo", resolver)
    with pinned_urlopen("https://rebind.example/x", timeout=5) as resp:
        assert resp.read() == b"ok"
    assert resolver.calls == ["rebind.example"]
    assert [s.connected_to for s in wire.sockets] == [(PUBLIC_V4, 443)]
    assert [c.server_hostname for c in tls] == ["rebind.example"]


def test_a_reused_target_never_resolves_again(monkeypatch, wire) -> None:
    resolver = RebindingResolver()
    monkeypatch.setattr(socket, "getaddrinfo", resolver)
    opener = build_pinned_opener(resolve_and_validate("http://rebind.example/"))
    for _ in range(3):
        with opener.open("http://rebind.example/again", timeout=5) as resp:
            resp.read()
    assert len(resolver.calls) == 1
    assert [s.connected_to for s in wire.sockets] == [(PUBLIC_V4, 80)] * 3


def test_fetch_resolves_exactly_once_with_the_default_resolver(fake_dns, wire) -> None:
    with pinned_urlopen("http://public.example/", timeout=5) as resp:
        resp.read()
    assert fake_dns.calls == ["public.example"]


# ── Blocked addresses: refused before any socket exists ─────────────────────


@pytest.mark.parametrize(
    "answers",
    [
        [PUBLIC_V4, "10.0.0.1"],
        [PUBLIC_V4, "127.0.0.1"],
        [PUBLIC_V4, "::1"],
        [PUBLIC_V4, "::ffff:169.254.169.254"],
        ["169.254.169.254", PUBLIC_V4],
        [PUBLIC_V6, "fd00::1"],
        [PUBLIC_V4, "100.64.0.1"],
    ],
)
def test_any_blocked_address_in_the_answer_refuses(answers, fake_dns, wire) -> None:
    fake_dns.raw["mixed-answer.example"] = [_entry(a, None) for a in answers]
    with pytest.raises(SsrfBlockedError, match="Refusing blocked IP"):
        resolve_and_validate("http://mixed-answer.example/")
    with pytest.raises(SsrfBlockedError, match="Refusing blocked IP"):
        pinned_urlopen("http://mixed-answer.example/", timeout=5)
    assert wire.sockets == []


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://localhost:8080/",
        "http://2130706433/",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://metadata.google.internal/computeMetadata/v1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://mixed.example/",
        "http://cgnat.example/",
        "http://nxdomain.example/",
        "file:///etc/passwd",
        "http://user@public.example/",
        "http://169.254.169.254\\@public.example/",
    ],
)
def test_guard_refusals_never_open_a_socket(url, wire) -> None:
    with pytest.raises(SsrfBlockedError):
        pinned_urlopen(url, timeout=5)
    assert wire.sockets == []


# ── resolve_and_validate: same decisions and messages as assert_safe_fetch_url ─


ACCEPTED = [
    "http://public.example/",
    "HTTP://Public.Example:8080/p;x?q=1#f",
    "https://public.example:443/",
    "https://bücher.example/",
    "http://[2606:2800:220:1:248:1893:25c8:1946]:8443/v6",
    "http://93.184.216.34/",
    "http://dual.example/",
    "http://public.example:/",
]


@pytest.mark.parametrize("url", ACCEPTED)
def test_canonical_url_is_what_assert_safe_fetch_url_returns(url) -> None:
    assert resolve_and_validate(url).canonical_url == assert_safe_fetch_url(url)


REFUSED = [
    "",
    "ftp://public.example/",
    "http:///nohost",
    "http://127.0.0.1/",
    "http://mixed.example/",
    "http://a.public.example:b.public.example:80/",
    "http://%31%32%37.0.0.1/",
    "http://public.example:99999/",
    "http://nxdomain.example/",
    "http://public .example/",
]


@pytest.mark.parametrize("url", REFUSED)
def test_refusal_messages_are_identical(url) -> None:
    with pytest.raises(SsrfBlockedError) as legacy:
        assert_safe_fetch_url(url)
    with pytest.raises(SsrfBlockedError) as pinned:
        resolve_and_validate(url)
    assert str(pinned.value) == str(legacy.value)


def test_target_fields() -> None:
    target = resolve_and_validate("HTTP://Public.Example:8080/p?q=1")
    assert target == PinnedTarget(
        scheme="http",
        host="public.example",
        port=8080,
        canonical_url="http://public.example:8080/p?q=1",
        addresses=(ipaddress.IPv4Address(PUBLIC_V4),),
    )
    assert resolve_and_validate("https://public.example/").port == 443


def test_target_addresses_keep_resolver_order_and_are_deduplicated(fake_dns) -> None:
    fake_dns.raw["multi.example"] = [
        _entry(PUBLIC_V6, None),
        (socket.AF_INET6, socket.SOCK_DGRAM, 17, "", (PUBLIC_V6, 0, 0, 0)),
        _entry(PUBLIC_V4, None),
        _entry("::ffff:" + PUBLIC_V4, None),  # IPv4-mapped: the same IPv4 host
    ]
    target = resolve_and_validate("http://multi.example/")
    assert target.addresses == (
        ipaddress.IPv6Address(PUBLIC_V6),
        ipaddress.IPv4Address(PUBLIC_V4),
    )


def test_ipv6_literal_target() -> None:
    target = resolve_and_validate(f"http://[{PUBLIC_V6}]:8443/v6")
    assert (target.host, target.port) == (PUBLIC_V6, 8443)
    assert target.addresses == (ipaddress.IPv6Address(PUBLIC_V6),)


# ── Dialing: IPv4/IPv6, port, fallback ───────────────────────────────────────


def test_ipv6_name_dials_af_inet6_and_keeps_the_port(wire) -> None:
    with pinned_urlopen("http://public6.example:8443/p", timeout=5) as resp:
        resp.read()
    (sock,) = wire.sockets
    assert sock.family == socket.AF_INET6
    assert sock.connected_to == (PUBLIC_V6, 8443, 0, 0)
    assert sock.request()[1]["host"] == "public6.example:8443"


def test_ipv6_literal_url_dials_the_literal_and_brackets_the_host_header(wire) -> None:
    with pinned_urlopen(f"http://[{PUBLIC_V6}]/", timeout=5) as resp:
        resp.read()
    (sock,) = wire.sockets
    assert sock.connected_to == (PUBLIC_V6, 80, 0, 0)
    assert sock.request()[1]["host"] == f"[{PUBLIC_V6}]"


def test_ipv4_mapped_literal_dials_ipv4(wire) -> None:
    with pinned_urlopen(f"http://[::ffff:{PUBLIC_V4}]/", timeout=5) as resp:
        resp.read()
    (sock,) = wire.sockets
    assert (sock.family, sock.connected_to) == (socket.AF_INET, (PUBLIC_V4, 80))


def test_falls_back_to_the_next_pinned_address_only(wire) -> None:
    wire.refuse = {PUBLIC_V4}
    with pinned_urlopen("http://dual.example/", timeout=5) as resp:
        assert resp.read() == b"ok"
    assert [(s.connected_to, s.closed) for s in wire.sockets] == [
        (None, True),
        ((PUBLIC_V6, 80, 0, 0), True),
    ]


def test_all_pinned_addresses_refusing_is_a_urlerror(wire, fake_dns) -> None:
    wire.refuse = {PUBLIC_V4, PUBLIC_V6}
    with pytest.raises(urllib.error.URLError) as excinfo:
        pinned_urlopen("http://dual.example/", timeout=5)
    assert isinstance(excinfo.value.reason, ConnectionRefusedError)
    assert len(wire.sockets) == 2 and all(s.closed for s in wire.sockets)
    assert fake_dns.calls == ["dual.example"]


@pytest.mark.parametrize("timeout", [7.5, None])
def test_timeout_reaches_the_socket(timeout, wire) -> None:
    with pinned_urlopen("http://public.example/", timeout=timeout) as resp:
        resp.read()
    assert wire.sockets[0].timeout == timeout


def test_default_timeout_is_bounded(wire) -> None:
    with pinned_urlopen("http://public.example/") as resp:
        resp.read()
    assert wire.sockets[0].timeout == 30.0


def test_post_body_and_method(wire) -> None:
    with pinned_urlopen(
        "http://public.example/api", b'{"a":1}', method="PUT",
        headers={"Content-Type": "application/json"}, timeout=5,
    ) as resp:
        resp.read()
    sent = bytes(wire.sockets[0].sent)
    line, headers = wire.sockets[0].request()
    assert line == "PUT /api HTTP/1.1"
    assert headers["content-length"] == "7" and sent.endswith(b'{"a":1}')


# ── Host header and TLS: the original name, never the IP ─────────────────────


def test_tls_uses_original_host_for_sni_and_verification(wire, tls) -> None:
    with pinned_urlopen("https://public.example:8443/s", timeout=5) as resp:
        resp.read()
    (call,) = tls
    assert call.server_hostname == "public.example"
    assert call.context.check_hostname is True
    assert call.context.verify_mode == ssl.CERT_REQUIRED
    assert wire.sockets[0].connected_to == (PUBLIC_V4, 8443)
    assert wire.sockets[0].request()[1]["host"] == "public.example:8443"


def test_tls_idna_host_is_sent_as_its_ascii_form(wire, tls) -> None:
    with pinned_urlopen("https://bücher.example/", timeout=5) as resp:
        resp.read()
    assert tls[0].server_hostname == "xn--bcher-kva.example"
    assert wire.sockets[0].request()[1]["host"] == "xn--bcher-kva.example"
    assert wire.sockets[0].connected_to == (PUBLIC_V4, 443)


def test_tls_ignores_a_process_wide_unverified_default(monkeypatch, wire, tls) -> None:
    monkeypatch.setattr(ssl, "_create_default_https_context", ssl._create_unverified_context)
    with pinned_urlopen("https://public.example/", timeout=5) as resp:
        resp.read()
    assert tls[0].context.verify_mode == ssl.CERT_REQUIRED
    assert tls[0].context.check_hostname is True


def test_caller_tls_context_is_used(wire, tls) -> None:
    ctx = ssl.create_default_context()
    with pinned_urlopen("https://public.example/", timeout=5, context=ctx) as resp:
        resp.read()
    assert tls[0].context is ctx


@pytest.mark.parametrize("name", ["Host", "host", "HOST"])
def test_host_header_override_is_refused(name, wire) -> None:
    with pytest.raises(SsrfBlockedError, match="Refusing Host header"):
        pinned_urlopen("http://public.example/", headers={name: "internal.corp"}, timeout=5)
    assert wire.sockets == []


def test_host_header_naming_the_same_authority_is_allowed(wire) -> None:
    with pinned_urlopen(
        "http://public.example:8080/", headers={"Host": "PUBLIC.example:8080"}, timeout=5
    ) as resp:
        resp.read()
    assert wire.sockets[0].connected_to == (PUBLIC_V4, 8080)


# ── Proxies and redirects ────────────────────────────────────────────────────


@pytest.mark.parametrize("scheme,port", [("http", 80), ("https", 443)])
def test_proxy_environment_is_ignored(scheme, port, monkeypatch, wire, tls) -> None:
    for name in PROXY_VARS:
        monkeypatch.setenv(name, PROXY)
    # The environment really is set: the stock opener would route through the proxy.
    assert urllib.request.getproxies()[scheme] == PROXY
    stock = [h for h in build_no_redirect_opener().handlers
             if isinstance(h, urllib.request.ProxyHandler)]
    assert stock and stock[0].proxies[scheme] == PROXY

    with pinned_urlopen(f"{scheme}://public.example/x", timeout=5) as resp:
        resp.read()
    (sock,) = wire.sockets
    assert sock.connected_to == (PUBLIC_V4, port)
    line, headers = sock.request()
    assert line == "GET /x HTTP/1.1"  # origin-form: not proxied, no CONNECT tunnel
    assert headers["host"] == "public.example"


def test_pinned_opener_holds_no_proxy_handler() -> None:
    opener = build_pinned_opener(resolve_and_validate("http://public.example/"))
    assert not [h for h in opener.handlers if isinstance(h, urllib.request.ProxyHandler)]


@pytest.mark.parametrize("scheme", ["http", "https"])
def test_a_proxy_handler_added_later_is_refused(scheme, monkeypatch, wire, tls) -> None:
    for name in PROXY_VARS:
        monkeypatch.setenv(name, PROXY)
    opener = build_pinned_opener(resolve_and_validate(f"{scheme}://public.example/"))
    opener.add_handler(urllib.request.ProxyHandler())  # reads the env proxies
    with pytest.raises(SsrfBlockedError):
        opener.open(f"{scheme}://public.example/", timeout=5)
    assert wire.sockets == []


@pytest.mark.parametrize("cls", [PinnedHTTPConnection, PinnedHTTPSConnection])
def test_connections_refuse_tunnels(cls) -> None:
    conn = cls("public.example", addresses=[PUBLIC_V4])
    with pytest.raises(SsrfBlockedError, match="tunnel"):
        conn.set_tunnel("internal.corp", 443)


@pytest.mark.parametrize("code", [301, 302, 303, 307, 308])
def test_redirects_are_not_followed(code, monkeypatch, wire) -> None:
    resolver = RebindingResolver()
    monkeypatch.setattr(socket, "getaddrinfo", resolver)
    wire.response = _response(code, {"Location": "http://127.0.0.1/admin"})
    with pytest.raises(SsrfBlockedError, match="Redirect to 'http://127.0.0.1/admin' blocked"):
        pinned_urlopen("http://rebind.example/", timeout=5)
    assert len(wire.sockets) == 1 and len(resolver.calls) == 1


@pytest.mark.parametrize("code", [300, 304, 404, 500])
def test_other_statuses_are_http_errors(code, wire) -> None:
    wire.response = _response(code, {"Location": "http://127.0.0.1/"})
    with pytest.raises(urllib.error.HTTPError) as excinfo:
        pinned_urlopen("http://public.example/", timeout=5)
    assert excinfo.value.code == code
    assert len(wire.sockets) == 1


# ── The opener serves its own target only ───────────────────────────────────


@pytest.mark.parametrize(
    "url",
    [
        "http://other.example/",
        "http://public.example:8080/",
        "https://public.example/",
        "http://dual.example/",
    ],
)
def test_opener_refuses_other_targets(url, wire) -> None:
    opener = build_pinned_opener(resolve_and_validate("http://public.example/"))
    with pytest.raises(SsrfBlockedError, match="pinned to"):
        opener.open(url, timeout=5)
    assert wire.sockets == []


@pytest.mark.parametrize("url", ["file:///etc/passwd", "data:,x", "ftp://public.example/"])
def test_opener_has_no_non_http_handlers(url, wire) -> None:
    opener = build_pinned_opener(resolve_and_validate("http://public.example/"))
    with pytest.raises(urllib.error.URLError, match="unknown url type"):
        opener.open(url, timeout=5)
    assert wire.sockets == []


def test_same_target_spelled_with_explicit_default_port_is_served(wire) -> None:
    opener = build_pinned_opener(resolve_and_validate("http://public.example/"))
    with opener.open("http://public.example:80/p", timeout=5) as resp:
        resp.read()
    assert wire.sockets[0].connected_to == (PUBLIC_V4, 80)
    assert wire.sockets[0].request()[1]["host"] == "public.example:80"


# ── Hand-built targets and direct http.client use get the same policy ────────


def _target(**overrides) -> PinnedTarget:
    fields = dict(scheme="http", host="public.example", port=80,
                  canonical_url="http://public.example/",
                  addresses=(ipaddress.IPv4Address(PUBLIC_V4),))
    fields.update(overrides)
    return PinnedTarget(**fields)


@pytest.mark.parametrize(
    "overrides,match",
    [
        ({"addresses": (ipaddress.ip_address("127.0.0.1"),)}, "Refusing blocked IP"),
        ({"addresses": (ipaddress.ip_address("::ffff:10.0.0.1"),)}, "Refusing blocked IP"),
        ({"addresses": ()}, "empty address list"),
        ({"addresses": ("public.example",)}, "non-IP address"),
        ({"addresses": PUBLIC_V4}, "not a string"),
        ({"scheme": "file"}, "non-http"),
        ({"host": "internal.corp"}, "inconsistent PinnedTarget"),
        ({"port": 8080}, "inconsistent PinnedTarget"),
    ],
)
def test_hand_built_targets_are_rechecked(overrides, match) -> None:
    with pytest.raises(SsrfBlockedError, match=match):
        build_pinned_opener(_target(**overrides))


def test_build_pinned_opener_requires_a_target() -> None:
    with pytest.raises(TypeError):
        build_pinned_opener("http://public.example/")  # type: ignore[arg-type]


def test_hand_built_target_with_string_addresses(wire) -> None:
    opener = build_pinned_opener(_target(addresses=(PUBLIC_V4,)))
    with opener.open("http://public.example/", timeout=5) as resp:
        resp.read()
    assert wire.sockets[0].connected_to == (PUBLIC_V4, 80)


@pytest.mark.parametrize("cls", [PinnedHTTPConnection, PinnedHTTPSConnection])
@pytest.mark.parametrize("addr", ["10.0.0.1", "::1", "169.254.169.254", "fe80::1"])
def test_connection_classes_refuse_blocked_addresses(cls, addr) -> None:
    with pytest.raises(SsrfBlockedError, match="Refusing blocked IP"):
        cls("public.example", addresses=[addr])


def test_direct_http_client_use(wire, fake_dns) -> None:
    target = resolve_and_validate("http://public.example/")
    conn = PinnedHTTPConnection(target.host, target.port, addresses=target.addresses, timeout=3)
    conn.request("GET", "/direct")
    assert conn.getresponse().read() == b"ok"
    conn.close()
    (sock,) = wire.sockets
    assert (sock.connected_to, sock.timeout) == ((PUBLIC_V4, 80), 3)
    assert sock.request() == ("GET /direct HTTP/1.1", {
        "host": "public.example", "accept-encoding": "identity"})
    assert fake_dns.calls == ["public.example"]


def test_direct_https_client_use(wire, tls) -> None:
    conn = PinnedHTTPSConnection("public.example", addresses=[PUBLIC_V4], timeout=3)
    conn.request("GET", "/")
    conn.getresponse().read()
    assert wire.sockets[0].connected_to == (PUBLIC_V4, 443)
    assert tls[0].server_hostname == "public.example"


# ── Backward compatibility ───────────────────────────────────────────────────


def test_existing_public_names_are_unchanged() -> None:
    from agent_tool_sandbox import boundary, ssrf_guard

    for name in ("SsrfBlockedError", "assert_safe_fetch_url", "build_no_redirect_opener"):
        assert getattr(agent_tool_sandbox, name) is getattr(ssrf_guard, name)
    for name in ("assert_inside_boundary", "assert_no_symlink"):
        assert getattr(agent_tool_sandbox, name) is getattr(boundary, name)
    assert set(agent_tool_sandbox.__all__) >= {
        "SsrfBlockedError", "assert_safe_fetch_url", "build_no_redirect_opener",
        "assert_inside_boundary", "assert_no_symlink", "PinnedTarget",
        "resolve_and_validate", "build_pinned_opener", "pinned_urlopen",
    }
    assert isinstance(assert_safe_fetch_url("http://public.example/"), str)
