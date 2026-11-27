"""DNS pinning: http_get / url_fetch connect only to the addresses the guard vetted.

Staged divergence (no in-tree counterpart). The tools call agent_tool_sandbox's
``resolve_and_validate`` (the guard, with ONE resolution) and fetch through
``build_pinned_opener``, which dials the vetted IPs directly. Before, the guard
resolved the name and urllib resolved it again at connect time, so a resolver that
answered public-then-loopback got through (DNS rebinding);
``test_connection_goes_only_to_vetted_addresses`` was the strict xfail that showed it.

Most tests here run WITHOUT the in-process transport: the real pinned handler and
http.client run, and only ``socket.socket.connect`` is stubbed, so the recorded
address is the one the tool really dialed.
"""
from __future__ import annotations

import socket

import pytest

from conftest import PUBLIC_V4, PUBLIC_V6, Dial
from pho3nix_recon_http import http_get, url_fetch

TOOLS = pytest.mark.parametrize("tool", [http_get, url_fetch], ids=["http_get", "url_fetch"])


@pytest.fixture
def refused(monkeypatch: pytest.MonkeyPatch) -> list:
    """connect() records the address and refuses (an OSError, so fallback runs)."""
    attempts: list = []

    def connect(self, address, *args, **kwargs):
        attempts.append(address)
        raise ConnectionRefusedError(111, "Connection refused")

    monkeypatch.setattr(socket.socket, "connect", connect)
    return attempts


@pytest.fixture
def rebinding(monkeypatch: pytest.MonkeyPatch) -> list:
    """A resolver that answers public once, then loopback. Returns the hosts asked."""
    asked: list = []

    def resolve(host, port, family=0, type=0, proto=0, flags=0):
        asked.append(host)
        addr = PUBLIC_V4 if len(asked) == 1 else "127.0.0.1"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (addr, port or 0))]

    monkeypatch.setattr(socket, "getaddrinfo", resolve)
    return asked


@TOOLS
def test_connection_goes_only_to_vetted_addresses(tool, rebinding, refused) -> None:
    """Was the rebinding strict xfail (there with the conftest connect stub, whose
    RuntimeError leaves the dialed socket unclosed; ``refused`` raises an OSError)."""
    tool.run({"url": "http://rebind.example/"})
    assert refused, "the tool never tried to connect"
    assert all(addr[0] == PUBLIC_V4 for addr in refused), refused
    assert rebinding == ["rebind.example"], "the name was resolved again"


@TOOLS
def test_one_resolution_covers_every_retry(tool, rebinding, refused) -> None:
    r = tool.run({"url": "http://rebind.example/"}, {"max_attempts": 3})
    assert r.ok is False and r.tool_calls == 3
    assert "Connection refused" in r.error
    assert refused == [(PUBLIC_V4, 80)] * 3
    assert rebinding == ["rebind.example"]


@TOOLS
def test_fallback_tries_only_the_vetted_addresses_in_order(tool, refused, fake_dns) -> None:
    r = tool.run({"url": "http://dual.example:8080/"})
    assert r.ok is False
    assert refused == [(PUBLIC_V4, 8080), (PUBLIC_V6, 8080, 0, 0)]
    assert fake_dns.calls == ["dual.example"]


@TOOLS
def test_env_proxy_is_not_used(tool, refused, fake_dns, monkeypatch) -> None:
    """A proxy resolves the name itself, past the IP checks: the pinned opener has none."""
    for name in ("http_proxy", "HTTP_PROXY", "https_proxy", "all_proxy"):
        monkeypatch.setenv(name, "http://proxy.example:3128")
    fake_dns.records["proxy.example"] = [PUBLIC_V4]
    tool.run({"url": "http://public.example/"})
    assert refused == [(PUBLIC_V4, 80)]
    assert fake_dns.calls == ["public.example"]


@TOOLS
def test_https_dials_the_vetted_ip_and_names_the_host_for_tls(tool, transport) -> None:
    handler = transport()
    r = tool.run({"url": "https://bücher.example/x"})
    assert r.ok is True, r.error
    assert handler.dials == [
        Dial("https", "xn--bcher-kva.example", 443, (PUBLIC_V4,), "xn--bcher-kva.example")
    ]


@TOOLS
def test_http_dial_is_pinned_to_the_resolved_set(tool, transport) -> None:
    handler = transport()
    r = tool.run({"url": "http://dual.example/"})
    assert r.ok is True, r.error
    assert handler.dials == [Dial("http", "dual.example", 80, (PUBLIC_V4, PUBLIC_V6), None)]


# ── Host header: must name the URL's own authority ────────────────────────────


@TOOLS
@pytest.mark.parametrize("host_header", ["internal.vhost", "127.0.0.1", "public.example.evil"])
def test_foreign_host_header_is_refused_and_never_sent(tool, transport, host_header) -> None:
    """Divergence: the reference forwards any Host header (virtual-host probing). A
    shared front end at the vetted IP would route that to another, possibly internal,
    site, so the pinned opener refuses it."""
    handler = transport()
    r = tool.run({"url": "http://public.example/", "headers": {"Host": host_header}})
    assert r.ok is False
    assert r.error == (
        f"Refusing Host header {host_header!r}: the pinned request is for 'public.example'"
    )
    assert r.tool_calls == 1
    assert handler.requests == [] and handler.dials == []


@TOOLS
@pytest.mark.parametrize(("url", "host_header"), [
    ("http://public.example/", "PUBLIC.example"),
    ("http://public.example:8080/", "public.example:8080"),
])
def test_host_header_naming_the_target_is_sent_as_given(tool, transport, url, host_header):
    handler = transport()
    r = tool.run({"url": url, "headers": {"Host": host_header}})
    assert r.ok is True, r.error
    assert handler.requests[0].header("Host") == host_header
