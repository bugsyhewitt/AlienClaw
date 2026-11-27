"""Known gaps, pinned as strict xfails so a fix shows up as XPASS (and fails the run).

Each test asserts the behavior a consumer would want; each currently fails for the
reason given. They are shared with the in-tree tools (identical code), so they are
not staging regressions. See README.md, "Known gaps".
"""
from __future__ import annotations

import socket
import threading

import pytest

from conftest import PUBLIC_V4, reply_with
from pho3nix_recon_http import http_get, search_text, url_fetch
from pho3nix_recon_http.types import RunResult


@pytest.mark.xfail(
    strict=True,
    reason="no DNS pinning: the guard resolves once, urllib resolves again at connect time",
)
@pytest.mark.parametrize("tool", [http_get, url_fetch], ids=["http_get", "url_fetch"])
def test_connection_goes_only_to_vetted_addresses(tool, monkeypatch, network_attempts) -> None:
    """A rebinding resolver answers public for the check and loopback for the connect.

    No transport is installed: the stock HTTPHandler runs, and the conftest's connect
    stub records the address instead of opening a socket.
    """
    answers = iter([PUBLIC_V4])

    def rebinding(host, port, family=0, type=0, proto=0, flags=0):
        addr = next(answers, "127.0.0.1")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (addr, port or 0))]

    monkeypatch.setattr(socket, "getaddrinfo", rebinding)
    tool.run({"url": "http://rebind.example/"})
    assert network_attempts, "the tool never tried to connect"
    assert all(addr[0] == PUBLIC_V4 for addr in network_attempts), network_attempts


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="search_text installs a SIGALRM handler; signal.signal() raises ValueError "
    "off the main thread (Flask request threads, Qt workers)",
)
def test_search_text_returns_a_result_from_a_worker_thread() -> None:
    out: dict = {}

    def work() -> None:
        try:
            out["result"] = search_text.run({"text": "hello", "pattern": "hello"})
        except Exception as exc:  # recorded, asserted below
            out["error"] = exc

    t = threading.Thread(target=work)
    t.start()
    t.join(timeout=30)
    assert isinstance(out.get("result"), RunResult), out.get("error")


@pytest.mark.parametrize("tool", [http_get, url_fetch], ids=["http_get", "url_fetch"])
def test_caller_host_header_is_sent_as_is(tool, transport) -> None:
    """Not a bug, documented: a caller-supplied Host header is forwarded verbatim
    (virtual-host probing works). The connection still goes to the vetted host."""
    handler = transport(reply_with(b"ok"))
    r = tool.run({"url": "http://public.example/", "headers": {"Host": "internal.vhost"}})
    assert r.ok is True
    assert handler.requests[0].host == "public.example"
    assert handler.requests[0].header("Host") == "internal.vhost"
