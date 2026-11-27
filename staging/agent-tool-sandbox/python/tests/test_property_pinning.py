"""Property: a pinned fetch resolves each hop once and dials only what that resolution vetted.

For generated multi-answer DNS results (mixes of public and blocked IPv4 / IPv6, IPv4-mapped
answers, duplicates), generated connection refusals, 1-3 redirect hops, http or https, an
explicit port or not, and a total deadline or none, ``pinned_urlopen`` must:

  - refuse with ``SsrfBlockedError`` before creating any socket for a hop if ANY answer of
    that hop's resolution is blocked, with the guard's generic post-DNS message and the
    first blocked answer (in resolver order) as ``blocked_address``;
  - otherwise dial only that hop's vetted addresses (IPv4-mapped answers unwrapped,
    duplicates dropped), in resolver order, falling back only on a refused connect, on the
    hop's port, with ``Host`` (and TLS ``server_hostname``) naming the hop's host;
  - call the resolver exactly once per hop. The fake resolver REBINDS a name to 127.0.0.1
    on any second lookup, so a re-resolution would also show up as a dial outside the set.

"Blocked" is the guard's own classifier, ``_ip_is_blocked``; tests/test_property_blocklist.py
checks that classifier against policy/blocklist.v1.json. The socket and TLS seams are the
ones in tests/test_pinning.py (``FakeSocket``, ``_response``, ``_entry``), installed per
example instead of per test.
"""
from __future__ import annotations

import io
import ipaddress
import os
import socket
import ssl
import urllib.error
from types import SimpleNamespace
from unittest import mock

import pytest

hypothesis = pytest.importorskip("hypothesis")
from hypothesis import HealthCheck, event, example, given, settings  # noqa: E402
from hypothesis import strategies as st  # noqa: E402

from agent_tool_sandbox import SsrfBlockedError, pinned_urlopen  # noqa: E402
from agent_tool_sandbox.ssrf_guard import _ip_is_blocked  # noqa: E402
from test_pinning import FakeSocket, _entry, _response  # noqa: E402

_SCALE = max(1, int(os.environ.get("ATS_PROPERTY_SCALE", "1")))
REBOUND = "127.0.0.1"  # blocked, so a dial to it can only come from a second lookup
_TLS = ssl.create_default_context()  # shared: wrap_socket is faked, only SNI is recorded

PUBLIC = ["93.184.216.34", "93.184.216.35", "8.8.8.8", "2606:2800:220:1:248:1893:25c8:1946",
          "2001:4860:4860::8888", "::ffff:93.184.216.34", "::ffff:8.8.4.4"]
BLOCKED = ["10.0.0.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "168.63.129.16",
           "0.0.0.0", "192.168.1.1", "::1", "fd00:ec2::254", "fe80::1", "::ffff:10.0.0.1",
           "::ffff:100.64.0.1", "64:ff9b::808:808", "2002:7f00:1::1"]


def _unwrap(raw: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    ip = ipaddress.ip_address(raw)
    if ip.version == 6 and ip.ipv4_mapped is not None:
        return ip.ipv4_mapped
    return ip


def test_the_address_pools_are_classified_as_labelled() -> None:
    assert not any(_ip_is_blocked(_unwrap(a)) for a in PUBLIC)
    assert all(_ip_is_blocked(_unwrap(a)) for a in BLOCKED)


class _Resolver:
    """Each hop's name answers its list once; any later lookup rebinds it to 127.0.0.1."""

    def __init__(self, answers: dict[str, list[str]]) -> None:
        self.answers = answers
        self.calls: list[object] = []

    def __call__(self, host, port, family=0, type=0, proto=0, flags=0):
        first = host not in self.calls
        self.calls.append(host)
        if host not in self.answers:
            raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")
        return [_entry(a, port) for a in (self.answers[host] if first else [REBOUND])]


class _HopSocket(FakeSocket):
    """FakeSocket whose N-th successful connection is answered with the N-th reply."""

    def connect(self, addr) -> None:
        super().connect(addr)
        self.hop = self.wire.connected
        self.wire.connected += 1

    def makefile(self, mode="rb", *args, **kwargs):
        return io.BytesIO(self.wire.replies[self.hop])


@st.composite
def _scenarios(draw: st.DrawFn) -> SimpleNamespace:
    pool = st.sampled_from(PUBLIC * 3 + BLOCKED)  # ~60% of hops resolve clean
    n_hops = draw(st.integers(1, 3))
    hops = []
    for i in range(n_hops):
        answers = draw(st.lists(pool, min_size=1, max_size=5))
        hops.append(SimpleNamespace(host=f"hop{i}.example", answers=answers,
                                    port=draw(st.sampled_from([None, None, 8080, 1, 65535]))))
    dialled = sorted({str(_unwrap(a)) for hop in hops for a in hop.answers})
    return SimpleNamespace(
        scheme=draw(st.sampled_from(["http", "https"])),
        hops=hops,
        refuse=set(draw(st.lists(st.sampled_from(dialled), unique=True))) if dialled else set(),
        extra_redirects=draw(st.integers(0, 2)),
        code=draw(st.sampled_from([301, 302, 303, 307, 308])),
        timeout=draw(st.sampled_from([None, 5.0])),
    )


def _url(scheme: str, hop: SimpleNamespace, i: int) -> str:
    port = "" if hop.port is None else f":{hop.port}"
    return f"{scheme}://{hop.host}{port}/p{i}"


def _expected(sc: SimpleNamespace) -> SimpleNamespace:
    """Walk the hops as the documented contract says; returns the dials and the outcome."""
    default = 443 if sc.scheme == "https" else 80
    dials: list[tuple[int, str, int]] = []  # (hop, ip, port) of every connect attempt
    for i, hop in enumerate(sc.hops):
        vetted: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
        for raw in hop.answers:
            ip = _unwrap(raw)
            if ip not in vetted:
                vetted.append(ip)
        blocked = [ip for ip in vetted if _ip_is_blocked(ip)]
        if blocked:
            return SimpleNamespace(dials=dials, outcome="blocked", last_hop=i,
                                   host=hop.host, blocked=blocked[0])
        port = hop.port or default
        for ip in vetted:
            dials.append((i, str(ip), port))
            if str(ip) not in sc.refuse:
                break
        else:
            return SimpleNamespace(dials=dials, outcome="unreachable", last_hop=i)
    return SimpleNamespace(dials=dials, outcome="ok", last_hop=len(sc.hops) - 1)


def _settings(max_examples: int) -> settings:
    return settings(
        max_examples=max_examples * _SCALE,
        derandomize=True,
        database=None,
        deadline=None,
        suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow],
    )


def _run(sc: SimpleNamespace) -> None:
    want = _expected(sc)
    event(want.outcome)
    replies = [_response(sc.code, {"Location": _url(sc.scheme, nxt, i + 1)})
               for i, nxt in enumerate(sc.hops[1:])] + [_response(200, body=b"final")]
    wire = SimpleNamespace(sockets=[], refuse=sc.refuse, replies=replies, connected=0)
    resolver = _Resolver({hop.host: hop.answers for hop in sc.hops})
    sni: list[str | None] = []

    def wrap_socket(ctx, sock, *args, server_hostname=None, **kwargs):
        sni.append(server_hostname)
        return sock

    bound = type("BoundHopSocket", (_HopSocket,), {"wire": wire})
    with mock.patch.object(socket, "socket", bound), \
            mock.patch.object(socket, "getaddrinfo", resolver), \
            mock.patch.object(ssl.SSLContext, "wrap_socket", wrap_socket):
        follow = len(sc.hops) - 1 + sc.extra_redirects
        try:
            with pinned_urlopen(_url(sc.scheme, sc.hops[0], 0), timeout=sc.timeout,
                                follow_redirects=follow, context=_TLS) as resp:
                body = resp.read()
            got = "ok"
        except SsrfBlockedError as exc:
            got = "blocked"
            refusal = exc
        except urllib.error.URLError as exc:
            assert isinstance(exc.reason, ConnectionRefusedError), exc
            got = "unreachable"

    assert got == want.outcome
    if got == "ok":
        assert body == b"final"
    if got == "blocked":
        # The guard's post-DNS refusal (PR-03): generic text, the first blocked answer on
        # the exception. A refusal from anywhere else (the pin re-check) would name it.
        assert str(refusal) == f"Refusing hostname {want.host!r}: not an allowed destination"
        assert (refusal.hostname, refusal.blocked_address) == (want.host, want.blocked)
    # Exactly one resolution per hop reached, in order: never a second lookup.
    assert resolver.calls == [hop.host for hop in sc.hops[: want.last_hop + 1]]
    # Every socket ever created dialled a vetted address of its hop, in the expected order.
    assert len(wire.sockets) == len(want.dials)
    for (hop_index, ip, port), sock in zip(want.dials, wire.sockets):
        family = socket.AF_INET if ipaddress.ip_address(ip).version == 4 else socket.AF_INET6
        assert sock.family == family
        if ip in sc.refuse:
            assert sock.connected_to is None and sock.closed
            continue
        assert sock.connected_to[:2] == (ip, port)
        hop = sc.hops[hop_index]
        line, headers = sock.request()
        assert line.split(" ")[1] == f"/p{hop_index}"
        assert headers["host"] == hop.host + ("" if hop.port is None else f":{hop.port}")
    if sc.scheme == "https":
        connected = [s for s in wire.sockets if s.connected_to]
        assert sni == [sc.hops[s.hop].host for s in connected]


@_settings(400)
@given(sc=_scenarios())
@example(sc=SimpleNamespace(  # one public answer: the plain case
    scheme="http", hops=[SimpleNamespace(host="hop0.example", answers=[PUBLIC[0]], port=None)],
    refuse=set(), extra_redirects=0, code=302, timeout=5.0))
@example(sc=SimpleNamespace(  # public first, blocked later in the SAME answer: refused
    scheme="https",
    hops=[SimpleNamespace(host="hop0.example", answers=[PUBLIC[0], "10.0.0.1"], port=None)],
    refuse=set(), extra_redirects=0, code=302, timeout=None))
@example(sc=SimpleNamespace(  # mapped duplicate of the first answer, first refuses
    scheme="http",
    hops=[SimpleNamespace(host="hop0.example",
                          answers=[PUBLIC[0], "::ffff:93.184.216.34", PUBLIC[3]], port=8080)],
    refuse={PUBLIC[0]}, extra_redirects=0, code=302, timeout=5.0))
@example(sc=SimpleNamespace(  # second hop resolves blocked: refused after one fetch
    scheme="http",
    hops=[SimpleNamespace(host="hop0.example", answers=[PUBLIC[0]], port=None),
          SimpleNamespace(host="hop1.example", answers=[PUBLIC[1], "::1"], port=None)],
    refuse=set(), extra_redirects=1, code=307, timeout=5.0))
def test_pinned_fetch_dials_only_vetted_addresses_and_resolves_once_per_hop(sc) -> None:
    _run(sc)
