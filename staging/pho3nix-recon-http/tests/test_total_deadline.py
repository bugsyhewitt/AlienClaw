"""One total deadline per run: http_get / url_fetch end within their timeout.

Staged divergence (no in-tree counterpart). The tools build their own pinned opener, and
``build_pinned_opener(target)`` without ``deadline=`` keeps urllib's per-operation
timeout: each connect attempt and each read gets the full ``_TIMEOUT_S``, so a name with
N blackholed A records costs N timeouts and a server that drips one byte at a time is
never cut off. The tools now pass ``deadline=time.monotonic() + _TIMEOUT_S`` (taken when
``run()`` starts), so the whole run, retries and ``request_count`` included, ends at the
budget, and a spent budget fails at once instead of being retried.

Network-free. The blackhole cases replace ``socket.socket`` with a fake whose connects
never answer; the slow-drip case uses a REAL listener on 127.0.0.1 (run the suite under
``staging/tools/offline.sh``). The guard refuses 127.0.0.1, so the name resolves to a
public address and a test-only connect shim sends that one address to the listener.
"""
from __future__ import annotations

import socket
import threading
import time
from collections.abc import Iterator
from types import SimpleNamespace

import pytest

from conftest import PUBLIC_V4
from pho3nix_recon_http import http_get, url_fetch

TOOLS = pytest.mark.parametrize("tool", [http_get, url_fetch], ids=["http_get", "url_fetch"])
PREFIX = {http_get: "Request failed: ", url_fetch: "Fetch failed: "}
BUDGET = 0.6
SLACK = 0.6  # scheduling slack on a loaded machine; the old behaviour misses by seconds
BLACKHOLE = [f"45.33.32.{i}" for i in range(10, 22)]  # 12 public A records that never answer

_REAL_SOCKET = socket.socket
_REAL_CONNECT = socket.socket.connect  # conftest's network_attempts replaces it per test


class _Blackholed:
    """socket.socket stand-in: every connect waits out the socket timeout, then times out."""

    attempts: list

    def __init__(self, *args, **kwargs) -> None:
        self.timeout = None

    def settimeout(self, value) -> None:
        self.timeout = value

    def setsockopt(self, *args) -> None:
        pass

    def connect(self, addr) -> None:
        self.attempts.append(addr)
        time.sleep(30.0 if self.timeout is None else min(self.timeout, 30.0))
        raise TimeoutError("timed out")

    def close(self) -> None:
        pass


@pytest.fixture
def blackhole(monkeypatch: pytest.MonkeyPatch, fake_dns) -> list:
    attempts: list = []
    fake_socket = type("Blackholed", (_Blackholed,), {"attempts": attempts})
    monkeypatch.setattr(socket, "socket", fake_socket)
    fake_dns.records["many.example"] = list(BLACKHOLE)
    return attempts


@pytest.fixture
def budget(monkeypatch: pytest.MonkeyPatch) -> float:
    for tool in (http_get, url_fetch):
        monkeypatch.setattr(tool, "_TIMEOUT_S", BUDGET)
    return BUDGET


@TOOLS
def test_twelve_blackholed_records_end_within_the_budget(tool, blackhole, budget) -> None:
    # Before: 12 records x a 0.6 s per-attempt timeout held the run for 7.2 s.
    start = time.monotonic()
    result = tool.run({"url": "http://many.example/"})
    elapsed = time.monotonic() - start
    assert elapsed < budget + SLACK, elapsed
    assert not result.ok
    assert result.error == f"{PREFIX[tool]}total timeout exceeded while connecting"
    assert result.tool_calls == 1
    assert 1 <= len(blackhole) < len(BLACKHOLE)


@TOOLS
def test_retries_share_the_budget_and_stop_once_it_is_spent(tool, blackhole, budget) -> None:
    # Before: every attempt got a fresh 12 x 0.6 s; 3 attempts held the run for 21.6 s.
    start = time.monotonic()
    result = tool.run({"url": "http://many.example/"}, {"max_attempts": 3, "request_count": 2})
    elapsed = time.monotonic() - start
    assert elapsed < budget + SLACK, elapsed
    assert not result.ok
    assert result.error == f"{PREFIX[tool]}total timeout exceeded while connecting"
    assert result.tool_calls == 1  # a spent budget is not retried


# ── Slow drip: a real loopback listener ─────────────────────────────────────


@pytest.fixture
def drip_server() -> Iterator[SimpleNamespace]:
    """Serves a 200 whose 100-byte body arrives one byte every 50 ms (5 s in total)."""
    listener = _REAL_SOCKET(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(8)
    stop = threading.Event()
    state = SimpleNamespace(port=listener.getsockname()[1], requests=0)

    def serve(conn: socket.socket) -> None:
        with conn:
            try:
                conn.recv(65536)
                state.requests += 1
                conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n"
                             b"Content-Length: 100\r\nConnection: close\r\n\r\n")
                for _ in range(100):
                    if stop.wait(0.05):
                        return
                    conn.sendall(b"x")
            except OSError:
                return  # the client gave up and closed

    def accept() -> None:
        while not stop.is_set():
            try:
                conn, _ = listener.accept()
            except OSError:
                return
            threading.Thread(target=serve, args=(conn,), daemon=True).start()

    thread = threading.Thread(target=accept, daemon=True)
    thread.start()
    try:
        yield state
    finally:
        stop.set()
        listener.close()
        thread.join(timeout=5)


@pytest.fixture
def via_loopback(monkeypatch: pytest.MonkeyPatch, fake_dns, drip_server) -> list:
    """Test-only: ``drip.example`` resolves to PUBLIC_V4, and a connect to exactly
    (PUBLIC_V4, listener port) is sent to the 127.0.0.1 listener. Anything else is refused."""
    fake_dns.records["drip.example"] = [PUBLIC_V4]
    dialed: list = []

    def connect(self, address, *args, **kwargs):
        dialed.append(address)
        if tuple(address[:2]) != (PUBLIC_V4, drip_server.port):
            raise ConnectionRefusedError(111, "test: only the drip listener is reachable")
        return _REAL_CONNECT(self, ("127.0.0.1", drip_server.port))

    monkeypatch.setattr(socket.socket, "connect", connect)
    return dialed


@TOOLS
def test_a_slow_drip_body_ends_within_the_budget(tool, budget, drip_server, via_loopback) -> None:
    # Before: every byte arrived well inside the 0.6 s per-read timeout, so the 5 s drip
    # held the run to the end.
    start = time.monotonic()
    result = tool.run({"url": f"http://drip.example:{drip_server.port}/"}, {"max_attempts": 3})
    elapsed = time.monotonic() - start
    assert elapsed < budget + SLACK, elapsed
    assert not result.ok
    assert result.error == f"{PREFIX[tool]}total timeout exceeded while reading the response"
    assert result.tool_calls == 1
    assert drip_server.requests == 1
    assert via_loopback == [(PUBLIC_V4, drip_server.port)]


@TOOLS
def test_a_fast_answer_is_unaffected(tool, monkeypatch, fake_dns) -> None:
    """Control: within the budget, the listener's answer comes back as before."""
    listener = _REAL_SOCKET(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    port = listener.getsockname()[1]

    def serve() -> None:
        conn, _ = listener.accept()
        with conn:
            conn.recv(65536)
            conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n"
                         b"Content-Length: 4\r\nConnection: close\r\n\r\nfast")

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    fake_dns.records["fast.example"] = [PUBLIC_V4]

    def connect(self, address, *args, **kwargs):
        if tuple(address[:2]) != (PUBLIC_V4, port):
            raise ConnectionRefusedError(111, "test: only the listener is reachable")
        return _REAL_CONNECT(self, ("127.0.0.1", port))

    monkeypatch.setattr(socket.socket, "connect", connect)
    try:
        result = tool.run({"url": f"http://fast.example:{port}/"})
    finally:
        thread.join(timeout=5)
        listener.close()
    assert result.ok, result.error
    assert result.output["content"] == "fast"
    assert result.output["statusCode"] == 200
