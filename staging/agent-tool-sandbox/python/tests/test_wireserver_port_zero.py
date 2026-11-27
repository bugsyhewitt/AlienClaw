"""Gaps the shared SSRF vector corpus exposed (vectors/DIFFERENCES.md, 2026-11-26).

1. Azure WireServer 168.63.129.16 (``meta-azure-wireserver``). It is a PUBLIC address that
   the Azure host fabric answers inside every VM: DNS, health probes, and the VM agent's
   goal state and extension configuration (``/machine?comp=goalstate``). No range rule
   catches it, so it is blocked by name, next to the metadata ranges.
2. Port 0 (``port-zero``). The guard returned ``http://public.example:0/`` unchanged; a
   client that treats 0 as "use the default" (Node's http module does) dials port 80. Every
   port outside 1-65535 is refused now.

Both are declared decision differences from the reference (in-tree) guard, which allows
them (tests/test_parity_in_tree.py, PROVENANCE.json). The 6to4, Teredo and fec0::/10
checks at the end were already blocked here; they pin the behaviour the TS package now
matches.
"""
from __future__ import annotations

import ipaddress

import pytest

from agent_tool_sandbox import SsrfBlockedError, assert_safe_fetch_url, resolve_and_validate
from agent_tool_sandbox.pinning import PinnedHTTPConnection
from agent_tool_sandbox.ssrf_guard import _ip_is_blocked

WIRESERVER = "168.63.129.16"


@pytest.fixture(autouse=True)
def _records(fake_dns):
    fake_dns.records["wireserver.example"] = [WIRESERVER]
    fake_dns.records["mapped-wireserver.example"] = [f"::ffff:{WIRESERVER}"]
    fake_dns.records["dual-wireserver.example"] = ["93.184.216.34", WIRESERVER]
    fake_dns.records["sixtofour-wireserver.example"] = ["2002:a83f:8110::1"]
    fake_dns.records["teredo.example"] = ["2001:0:4136:e378:8000:63bf:80ff:fffe"]
    fake_dns.records["sitelocal.example"] = ["fec0::1"]
    return fake_dns


# ── 1. Azure WireServer ─────────────────────────────────────────────────────

@pytest.mark.parametrize("url", [
    "http://168.63.129.16/machine?comp=goalstate",   # VM agent goal state
    "http://168.63.129.16:32526/vmSettings",          # host GA plugin port
    "https://168.63.129.16/",
    "http://2822734096/",                             # decimal
    "http://0xa83f8110/",                             # hex
    "http://168.63.33040/",                           # short form (a.b.<16-bit c>)
    "http://[::ffff:168.63.129.16]/",                 # IPv4-mapped literal, unwrapped
    "http://wireserver.example/",                     # DNS answer
    "http://mapped-wireserver.example/",              # mapped DNS answer, unwrapped
    "http://dual-wireserver.example/",                # one bad answer poisons the set
])
def test_guard_blocks_azure_wireserver(url: str) -> None:
    with pytest.raises(SsrfBlockedError, match=r"^Refusing blocked IP 168\.63\.129\.16 "):
        assert_safe_fetch_url(url)


@pytest.mark.parametrize(("ip", "blocked"), [
    ("168.63.129.15", False),
    ("168.63.129.16", True),
    ("168.63.129.17", False),
    ("168.63.128.16", False),
])
def test_ip_is_blocked_wireserver_is_one_address(ip: str, blocked: bool) -> None:
    assert _ip_is_blocked(ipaddress.IPv4Address(ip)) is blocked


@pytest.mark.parametrize("url", ["http://168.63.129.15/", "http://168.63.129.17/"])
def test_wireserver_neighbours_are_public(url: str) -> None:
    assert assert_safe_fetch_url(url) == url


def test_pinning_refuses_wireserver() -> None:
    with pytest.raises(SsrfBlockedError, match="168.63.129.16"):
        resolve_and_validate("http://wireserver.example/")
    with pytest.raises(SsrfBlockedError, match=r"Refusing blocked IP 168\.63\.129\.16 \(pinned"):
        PinnedHTTPConnection("public.example", addresses=["93.184.216.34", WIRESERVER])


# ── 2. Port 0 ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("url", [
    "http://public.example:0/",
    "https://public.example:0/",
    "http://public.example:00/",
    "http://public.example:0000/x?y=1",
    "http://93.184.216.34:0/",
    "http://[2606:4700:4700::1111]:0/",
])
def test_guard_refuses_port_zero(url: str) -> None:
    with pytest.raises(SsrfBlockedError, match=r"^Refusing URL with port 0: "):
        assert_safe_fetch_url(url)


def test_pinning_refuses_port_zero() -> None:
    with pytest.raises(SsrfBlockedError, match="port 0"):
        resolve_and_validate("http://public.example:0/")


@pytest.mark.parametrize("url", ["http://public.example:65536/", "http://public.example:99999/"])
def test_guard_still_refuses_ports_above_65535(url: str) -> None:
    with pytest.raises(SsrfBlockedError, match="Port out of range"):
        assert_safe_fetch_url(url)


@pytest.mark.parametrize(("url", "canonical"), [
    ("http://public.example:1/", "http://public.example:1/"),
    ("http://public.example:65535/", "http://public.example:65535/"),
    ("http://public.example:00080/", "http://public.example:80/"),
    ("http://public.example:/", "http://public.example/"),
])
def test_ports_1_to_65535_still_pass(url: str, canonical: str) -> None:
    assert assert_safe_fetch_url(url) == canonical


# ── already blocked here, now matched by the TS package ─────────────────────

@pytest.mark.parametrize("url", [
    "http://[2002:a9fe:a9fe::]/latest/meta-data/",          # 6to4 embedding metadata
    "http://[2002:808:808::1]/",                            # 6to4 with a public embed
    "http://sixtofour-wireserver.example/",                 # 6to4 embedding WireServer
    "http://[2001:0:4136:e378:8000:63bf:80ff:fffe]/",       # Teredo, loopback client
    "http://teredo.example/",
    "http://[fec0::1]/",                                    # deprecated site-local
    "http://[feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]/",
    "http://sitelocal.example/",
    "http://[64:ff9b::a83f:8110]/",                         # NAT64 embedding WireServer
])
def test_transition_prefixes_and_site_local_stay_blocked(url: str) -> None:
    with pytest.raises(SsrfBlockedError, match="^Refusing blocked IP "):
        assert_safe_fetch_url(url)
