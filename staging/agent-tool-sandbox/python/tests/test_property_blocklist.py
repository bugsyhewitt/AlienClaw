"""Property: the guard's IP and name decisions are exactly what policy/blocklist.v1.json says.

The reference classifier below is built straight from the JSON with ``ipaddress.ip_network``
membership and the matching rules of policy/README.md, without the generator and without
``_blocklist_data``:

  1. names (after IDNA, lower case, trailing dots removed): refused when equal to a ``name``
     entry or ending in a ``name_suffix`` entry;
  2. IPv4: blocked when inside a ``block`` entry and inside no ``exempt`` entry;
  3. IPv6 inside an embedded-IPv4 matcher prefix (``ipv4-mapped`` ``::ffff:0:0/96``,
     ``nat64-embedded`` ``64:ff9b::/96``): blocked if a ``block`` entry with exactly that
     prefix is on; else, if the matcher's ``decode`` entry is on, the low 32 bits decide as
     an IPv4 address (rule 2 without the entry's ``decode_excludes``); else rule 4;
  4. other IPv6: blocked when inside a ``block`` entry and inside no ``exempt`` entry; zone
     IDs ignored.

An entry is on when its ``applies.python`` column is true (profile ``per-language``) or as
the README's ``strictest-wins`` definition says. Through the guard (DNS answers and URL
literals), an IPv4-mapped answer is judged as its IPv4 while the mapped matcher is a decode
(README, "Recorded behaviour quirks").

Inputs are biased toward every CIDR's first and last address and their neighbours, and
toward the IPv4 boundaries in every embedded form (mapped, NAT64, compatible, translated,
local-use NAT64, 6to4, Teredo), plus uniformly random addresses and zone IDs.
"""
from __future__ import annotations

import ipaddress
import json
import os
import socket
from pathlib import Path
from unittest import mock

import pytest

hypothesis = pytest.importorskip("hypothesis")
from hypothesis import HealthCheck, example, given, settings  # noqa: E402
from hypothesis import strategies as st  # noqa: E402

from agent_tool_sandbox import SsrfBlockedError, resolve_and_validate  # noqa: E402
from agent_tool_sandbox.ssrf_guard import _ip_is_blocked, _is_loopback_name  # noqa: E402

POLICY = Path(__file__).resolve().parents[2] / "policy" / "blocklist.v1.json"
if not POLICY.is_file():  # the package lifted on its own
    pytest.skip("policy/ is not next to this package", allow_module_level=True)
DOC = json.loads(POLICY.read_text(encoding="utf-8"))
COLUMN = "python"
_REAL_GETADDRINFO = socket.getaddrinfo
_SCALE = max(1, int(os.environ.get("ATS_PROPERTY_SCALE", "1")))
IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address


def _settings(max_examples: int) -> settings:
    return settings(
        max_examples=max_examples * _SCALE,
        derandomize=True,
        database=None,
        deadline=None,
        suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow],
    )


# ── Reference classifier, from the JSON alone ────────────────────────────────

MATCHER_PREFIXES = {  # policy/README.md, schema table ("matcher")
    "ipv4-mapped": ipaddress.ip_network("::ffff:0:0/96"),
    "nat64-embedded": ipaddress.ip_network("64:ff9b::/96"),
}


def _on(entry: dict) -> bool:
    applies = entry["applies"]
    if DOC["profile"] == "per-language":
        return bool(applies[COLUMN])
    assert DOC["profile"] == "strictest-wins", DOC["profile"]
    if entry["effect"] == "exempt":
        return all(applies.values())
    return any(applies.values())


def _decode_excludes(entry: dict) -> set[str]:
    excludes = entry.get("decode_excludes", {})
    if DOC["profile"] == "per-language":
        return set(excludes.get(COLUMN, []))
    lists = [set(excludes.get(lang, [])) for lang in entry["applies"]]
    return set.intersection(*lists) if lists else set()


_ON = [e for e in DOC["entries"] if _on(e)]


def _nets(family: str, effect: str) -> list[tuple[str, ipaddress._BaseNetwork]]:
    return [(e["id"], ipaddress.ip_network(e["cidr"]))
            for e in _ON if e["family"] == family and e["effect"] == effect]


V4_BLOCK, V4_EXEMPT = _nets("ipv4", "block"), _nets("ipv4", "exempt")
V6_BLOCK, V6_EXEMPT = _nets("ipv6", "block"), _nets("ipv6", "exempt")
DECODES = {e["matcher"]: e for e in _ON if e["effect"] == "decode"}
NAMES = {e["name"] for e in _ON if e["family"] == "name" and "name" in e}
SUFFIXES = tuple(e["name_suffix"] for e in _ON if e["family"] == "name" and "name_suffix" in e)


def _ref_ipv4(ip: ipaddress.IPv4Address, skip: set[str] = frozenset()) -> bool:
    blocked = any(ip in net for eid, net in V4_BLOCK if eid not in skip)
    return blocked and not any(ip in net for _, net in V4_EXEMPT)


def reference_blocked(ip: IPAddress) -> bool:
    """Rules 2-4 of policy/README.md for an address handed straight to the classifier."""
    if ip.version == 4:
        return _ref_ipv4(ip)
    bare = ipaddress.IPv6Address(int(ip))  # rule 4: zone IDs are ignored
    for matcher, prefix in MATCHER_PREFIXES.items():
        if bare not in prefix:
            continue
        if any(net == prefix for _, net in V6_BLOCK):
            return True
        if matcher in DECODES:
            embedded = ipaddress.IPv4Address(int(bare) & 0xFFFFFFFF)
            return _ref_ipv4(embedded, _decode_excludes(DECODES[matcher]))
        break
    return any(bare in net for _, net in V6_BLOCK) and not any(
        bare in net for _, net in V6_EXEMPT
    )


_MAPPED_IS_DECODED = "ipv4-mapped" in DECODES and not any(
    net == MATCHER_PREFIXES["ipv4-mapped"] for _, net in V6_BLOCK
)


def reference_guard_blocked(ip: IPAddress) -> bool:
    """What the guard must decide for ``ip`` as a DNS answer or a URL literal."""
    if ip.version == 6 and _MAPPED_IS_DECODED and ip.ipv4_mapped is not None:
        return reference_blocked(ip.ipv4_mapped)
    return reference_blocked(ip)


def reference_name_blocked(ascii_host: str) -> bool:
    name = ascii_host.lower().rstrip(".")
    return name in NAMES or name.endswith(SUFFIXES)


def test_reference_reads_a_non_trivial_table() -> None:
    assert DOC["schema_version"] == 1
    assert len(V4_BLOCK) >= 10 and len(V6_BLOCK) >= 10 and V4_EXEMPT and V6_EXEMPT
    for matcher, entry in DECODES.items():
        assert ipaddress.ip_network(entry["cidr"]) == MATCHER_PREFIXES[matcher]
    assert "localhost" in NAMES and ".localhost" in SUFFIXES


# ── Inputs biased toward the table's boundaries ──────────────────────────────

_ALL_NETS = sorted(
    {ipaddress.ip_network(e["cidr"]) for e in DOC["entries"] if "cidr" in e},
    key=lambda n: (n.version, int(n.network_address), n.prefixlen),
)
_V4_MAX, _V6_MAX = 2**32 - 1, 2**128 - 1


def _boundary_points(net: ipaddress._BaseNetwork) -> list[IPAddress]:
    cls = type(net.network_address)
    top = _V4_MAX if net.version == 4 else _V6_MAX
    first, last = int(net.network_address), int(net.broadcast_address)
    return [cls(v) for v in (first - 1, first, first + 1, last - 1, last, last + 1)
            if 0 <= v <= top]


BOUNDARIES: list[IPAddress] = sorted(
    {p for net in _ALL_NETS for p in _boundary_points(net)}, key=lambda a: (a.version, int(a))
)
V4_BOUNDARIES = [p for p in BOUNDARIES if p.version == 4] + [
    ipaddress.IPv4Address(a) for a in ("93.184.216.34", "8.8.8.8", "255.255.255.255")
]


def _embed(kind: str, v4: ipaddress.IPv4Address) -> ipaddress.IPv6Address:
    v = int(v4)
    base = {
        "mapped": 0xFFFF << 32,                                  # ::ffff:a.b.c.d
        "nat64": int(ipaddress.IPv6Address("64:ff9b::")),        # 64:ff9b::a.b.c.d
        "compatible": 0,                                         # ::a.b.c.d
        "translated": 0xFFFF << 48,                              # ::ffff:0:a.b.c.d
        "nat64-local": int(ipaddress.IPv6Address("64:ff9b:1::")),
    }
    if kind == "6to4":                                           # 2002:AABB:CCDD::1
        return ipaddress.IPv6Address((0x2002 << 112) | (v << 80) | 1)
    if kind == "teredo":                                         # 2001:0:srv::~client
        return ipaddress.IPv6Address((0x20010000 << 96) | (v << 64) | (v ^ 0xFFFFFFFF))
    return ipaddress.IPv6Address(base[kind] | v)


EMBEDDINGS = ("mapped", "nat64", "compatible", "translated", "nat64-local", "6to4", "teredo")
EMBEDDED: list[ipaddress.IPv6Address] = [_embed(k, v) for k in EMBEDDINGS for v in V4_BOUNDARIES]


def _with_zone(ip: IPAddress, zone: str | None) -> IPAddress:
    return ip if zone is None or ip.version == 4 else ipaddress.IPv6Address(f"{ip}%{zone}")


_ADDRESSES = st.one_of(
    st.sampled_from(BOUNDARIES),
    st.sampled_from(_ALL_NETS).flatmap(lambda net: st.ip_addresses(network=net)),
    st.builds(_embed, st.sampled_from(EMBEDDINGS),
              st.one_of(st.sampled_from(V4_BOUNDARIES), st.ip_addresses(v=4))),
    st.ip_addresses(v=4),
    st.ip_addresses(v=6),
)
_IPS = st.builds(_with_zone, _ADDRESSES,
                 st.sampled_from([None, None, None, None, "eth0", "1"]))


# ── The guard, fed one address ───────────────────────────────────────────────


def _answering(ip: IPAddress):
    def getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        if host != "probe.example":
            return _REAL_GETADDRINFO(host, port, family, type, proto,
                                     flags | socket.AI_NUMERICHOST)
        if ip.version == 4:
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (str(ip), port or 0))]
        return [(socket.AF_INET6, socket.SOCK_STREAM, 6, "", (str(ip), port or 0, 0, 0))]

    return mock.patch.object(socket, "getaddrinfo", getaddrinfo)


def _guard_blocks(url: str, ip: IPAddress) -> bool:
    with _answering(ip):
        try:
            resolve_and_validate(url)
        except SsrfBlockedError as exc:
            assert exc.blocked_address is not None, exc.detail  # refused for its address
            return True
    return False


def _literal_url(ip: IPAddress) -> str:
    return f"http://{ip}/" if ip.version == 4 else f"http://[{ip}]/"


def _assert_agrees(ip: IPAddress) -> None:
    assert _ip_is_blocked(ip) == reference_blocked(ip), ip
    want = reference_guard_blocked(ip)
    assert _guard_blocks("http://probe.example/", ip) == want, ip
    if getattr(ip, "scope_id", None) is None:  # a zone needs '%' in the URL: refused as such
        assert _guard_blocks(_literal_url(ip), ip) == want, ip


# ── Properties ───────────────────────────────────────────────────────────────


@_settings(1000)
@given(ip=_IPS)
@example(ip=ipaddress.ip_address("100.64.0.0"))
@example(ip=ipaddress.ip_address("100.63.255.255"))
@example(ip=ipaddress.ip_address("192.0.0.9"))
@example(ip=ipaddress.ip_address("168.63.129.16"))
@example(ip=ipaddress.ip_address("::ffff:100.64.0.1"))     # raw: decode_excludes CGNAT
@example(ip=ipaddress.ip_address("::ffff:168.63.129.16"))  # raw: decode_excludes WireServer
@example(ip=ipaddress.ip_address("64:ff9b::808:808"))      # NAT64 public: blocked whole
@example(ip=ipaddress.ip_address("2001:1::1"))
@example(ip=ipaddress.ip_address("fe80::1%eth0"))
def test_ip_decisions_match_the_policy_table(ip: IPAddress) -> None:
    _assert_agrees(ip)


def test_every_boundary_and_embedding_matches_the_policy_table() -> None:
    """Exhaustive over the biased set: every CIDR edge +-1, and each IPv4 edge embedded."""
    for ip in (*BOUNDARIES, *EMBEDDED):
        _assert_agrees(ip)
    assert len(BOUNDARIES) > 200 and len(EMBEDDED) > 500


_LABELS = st.sampled_from(["localhost", "LocalHost", "ip6-localhost", "ip6-loopback",
                           "localhost6", "localdomain", "a", "x-1", "local", "host",
                           "\uff4c\uff4f\uff43\uff41\uff4c\uff48\uff4f\uff53\uff54"])
_NAMES = st.builds(lambda labels, dot: ".".join(labels) + dot,
                   st.lists(_LABELS, min_size=1, max_size=3), st.sampled_from(["", "."]))


@_settings(300)
@given(name=_NAMES)
@example(name="localhost.")
@example(name="foo.LOCALHOST")
@example(name="localhost.localdomain")
@example(name="ip6-loopback.")
def test_name_decisions_match_the_policy_table(name: str) -> None:
    ascii_host = name.encode("idna").decode("ascii").lower()
    want = reference_name_blocked(ascii_host)
    assert _is_loopback_name(ascii_host) == want
    # Through the guard: every name resolves publicly, so only the name rule can refuse.
    public = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0))]
    with mock.patch.object(socket, "getaddrinfo", lambda *args, **kwargs: public):
        try:
            resolve_and_validate(f"http://{name}/")
        except SsrfBlockedError as exc:
            assert want, exc.detail
            assert "reserved loopback name" in str(exc)
        else:
            assert not want
