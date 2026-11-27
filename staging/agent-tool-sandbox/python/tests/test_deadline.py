"""PR-02 / G4: one total deadline for ``pinned_urlopen``.

``timeout`` is the budget for the whole call: the one resolution, every connect attempt
(each gets what is left), TLS, sending the request, the response head and the body. Per
socket timeouts alone do not bound a slow drip, so the reads check the deadline too.

Network-free. Connect and send behaviour come from a fake ``socket.socket``; the slow-drip
cases use a REAL listener on 127.0.0.1 (run the suite under ``staging/tools/offline.sh``),
which the guard normally refuses, so those tests allow loopback for themselves only.
"""
from __future__ import annotations

import io
import ipaddress
import socket
import threading
import time
import urllib.error
from types import SimpleNamespace

import pytest

from agent_tool_sandbox import pinned_urlopen, pinning, resolve_and_validate, ssrf_guard

_REAL_CONNECT = socket.socket.connect  # conftest's _no_network replaces it per test
_REAL_IS_BLOCKED = ssrf_guard._ip_is_blocked
LOOPBACK = ipaddress.ip_address("127.0.0.1")
BLACKHOLE = [f"45.33.32.{i}" for i in range(10, 22)]  # 12 public A records that never answer
SLACK = 0.4  # scheduling slack on a loaded machine; the old behaviour misses by seconds


def _ok(body: bytes = b"ok") -> bytes:
    return b"HTTP/1.1 200 OK\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s" % (
        len(body), body)


class _Fake:
    """socket.socket stand-in. ``plan`` (bound per test) decides connect and send behaviour."""

    plan: SimpleNamespace

    def __init__(self, family=-1, type=-1, proto=-1, fileno=None) -> None:
        self.family = family
        self.timeout: object = "never set"
        self.timeouts: list[object] = []
        self.connected_to = None
        self.sent = bytearray()
        self.plan.sockets.append(self)

    def settimeout(self, value) -> None:
        self.timeout = value
        self.timeouts.append(value)

    def setsockopt(self, *args) -> None:
        pass

    def connect(self, addr) -> None:
        delay = self.plan.connect_delay.get(addr[0])
        if delay is not None:  # a blackhole: nothing answers until the socket timeout
            wait = delay if self.timeout in (None, "never set") else min(delay, self.timeout)
            time.sleep(wait)
            if self.plan.refuse_after_delay:
                raise ConnectionRefusedError(111, "Connection refused")
            raise TimeoutError("timed out")
        self.connected_to = addr

    def sendall(self, data) -> None:
        # A slow reader: every started 16 KiB record takes send_delay to drain.
        records = max(1, -(-len(data) // 16384))
        time.sleep(self.plan.send_delay * records)
        self.sent += data

    def makefile(self, mode="rb", *args, **kwargs):
        return io.BytesIO(self.plan.response)

    def close(self) -> None:
        pass


@pytest.fixture
def plan(monkeypatch: pytest.MonkeyPatch, fake_dns) -> SimpleNamespace:
    state = SimpleNamespace(sockets=[], connect_delay={}, refuse_after_delay=False,
                            send_delay=0.0, response=_ok())
    monkeypatch.setattr(socket, "socket", type("PlannedSocket", (_Fake,), {"plan": state}))
    fake_dns.raw["many.example"] = [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 0)) for ip in BLACKHOLE
    ]
    return state


# ── The exception ────────────────────────────────────────────────────────────


def test_deadline_error_is_a_timeout_and_a_urlerror() -> None:
    exc = pinning.DeadlineExceededError("reading the response")
    assert isinstance(exc, TimeoutError) and isinstance(exc, urllib.error.URLError)
    assert "reading the response" in str(exc)
    assert exc.phase == "reading the response"


@pytest.mark.parametrize("bad", [0, -1, float("nan"), float("inf")])
def test_timeout_must_be_a_positive_finite_number(bad) -> None:
    with pytest.raises(ValueError, match="timeout"):
        pinned_urlopen("http://public.example/", timeout=bad)


@pytest.mark.parametrize("bad", ["5", True, [1]])
def test_timeout_must_be_a_number(bad) -> None:
    with pytest.raises(TypeError, match="timeout"):
        pinned_urlopen("http://public.example/", timeout=bad)


# ── Connect: the attacker chooses the number of A records ───────────────────


def test_twelve_blackholed_records_share_one_deadline(plan) -> None:
    # PR-02 repro: 12 records x timeout=2 held a call for 24 s. Here 12 x 0.3 would be 3.6 s.
    for ip in BLACKHOLE:
        plan.connect_delay[ip] = 5.0
    start = time.monotonic()
    with pytest.raises(pinning.DeadlineExceededError) as excinfo:
        pinned_urlopen("http://many.example/", timeout=0.3)
    elapsed = time.monotonic() - start
    assert elapsed < 0.3 + SLACK, elapsed
    assert isinstance(excinfo.value, urllib.error.URLError)  # old `except URLError` still works
    assert excinfo.value.phase == "connecting"


def test_each_connect_attempt_gets_only_the_remaining_budget(plan, fake_dns) -> None:
    plan.refuse_after_delay = True
    plan.connect_delay[BLACKHOLE[0]] = 0.25  # refuses after 0.25 s; the next one answers
    fake_dns.records["two.example"] = [BLACKHOLE[0], "93.184.216.34"]
    with pinned_urlopen("http://two.example/", timeout=1.0) as resp:
        assert resp.read() == b"ok"
    first, second = plan.sockets
    assert 0.9 < first.timeouts[0] <= 1.0
    assert second.timeouts[0] <= first.timeouts[0] - 0.2  # the 0.25 s spent is gone
    assert second.connected_to == ("93.184.216.34", 80)


def test_an_opener_built_with_an_expired_deadline_never_connects(plan) -> None:
    opener = pinning.build_pinned_opener(
        resolve_and_validate("http://public.example/"), deadline=time.monotonic() - 1
    )
    with pytest.raises(urllib.error.URLError) as excinfo:
        opener.open("http://public.example/", timeout=5)
    assert isinstance(excinfo.value.reason, pinning.DeadlineExceededError)
    assert plan.sockets == []


def test_no_deadline_without_a_timeout(plan) -> None:
    with pinned_urlopen("http://public.example/", timeout=None) as resp:
        assert resp.read() == b"ok"
    assert plan.sockets[0].timeouts == [None]


# ── Send: a server that reads slowly cannot stretch the call ────────────────


def test_a_slow_reading_server_cannot_outlast_the_deadline(plan) -> None:
    plan.send_delay = 0.1  # 0.1 s per 16 KiB; the 128 KiB body alone would take 0.8 s
    start = time.monotonic()
    with pytest.raises(pinning.DeadlineExceededError) as excinfo:
        pinned_urlopen("http://public.example/up", b"x" * (128 * 1024), timeout=0.35)
    assert time.monotonic() - start < 0.35 + SLACK
    assert excinfo.value.phase == "sending the request"


# ── DNS: getaddrinfo cannot be interrupted, so it runs in a bounded worker ──


def _hanging_resolver(fake_dns, monkeypatch, release: threading.Event, hang: str):
    fake_dns.records[hang] = ["93.184.216.34"]
    inner = fake_dns.getaddrinfo

    def resolver(host, *args, **kwargs):
        if host == hang:
            release.wait(3)
        return inner(host, *args, **kwargs)

    monkeypatch.setattr(socket, "getaddrinfo", resolver)


def test_a_hung_resolver_is_abandoned_at_the_deadline(plan, fake_dns, monkeypatch) -> None:
    release = threading.Event()
    _hanging_resolver(fake_dns, monkeypatch, release, "slow-dns.example")
    try:
        start = time.monotonic()
        with pytest.raises(pinning.DeadlineExceededError) as excinfo:
            pinned_urlopen("http://slow-dns.example/", timeout=0.3)
        assert time.monotonic() - start < 0.3 + SLACK
        assert excinfo.value.phase == "resolving the host name"
        assert plan.sockets == []
    finally:
        release.set()


def test_resolver_workers_are_capped_and_fail_closed(plan, fake_dns, monkeypatch) -> None:
    monkeypatch.setattr(pinning, "_RESOLVER_SLOTS", threading.BoundedSemaphore(1))
    release = threading.Event()
    _hanging_resolver(fake_dns, monkeypatch, release, "slow-dns.example")
    try:
        with pytest.raises(pinning.DeadlineExceededError):
            pinned_urlopen("http://slow-dns.example/", timeout=0.2)
        # The abandoned lookup still holds the only slot: the next call times out without
        # starting another thread or calling the resolver.
        calls_before = len(fake_dns.calls)
        with pytest.raises(pinning.DeadlineExceededError) as excinfo:
            pinned_urlopen("http://public.example/", timeout=0.2)
        assert excinfo.value.phase == "waiting for a resolver thread"
        assert len(fake_dns.calls) == calls_before
    finally:
        release.set()
    deadline = time.monotonic() + 3
    while pinning._RESOLVER_SLOTS._value == 0 and time.monotonic() < deadline:
        time.sleep(0.01)
    with pinned_urlopen("http://public.example/", timeout=2) as resp:  # slot is free again
        assert resp.read() == b"ok"


def test_guard_errors_from_the_worker_are_re_raised(plan) -> None:
    with pytest.raises(ssrf_guard.SsrfBlockedError):
        pinned_urlopen("http://mixed.example/", timeout=2)
    with pytest.raises(ssrf_guard.SsrfBlockedError):
        pinned_urlopen(123, timeout=2)  # type: ignore[arg-type]
    assert plan.sockets == []


# ── Response head and body: a slow drip over a real loopback socket ─────────


@pytest.fixture
def loopback(monkeypatch: pytest.MonkeyPatch, fake_dns):
    """Let THIS test's pinned client reach 127.0.0.1, which the guard normally refuses."""

    def allow_loopback(ip):
        return False if ip == LOOPBACK else _REAL_IS_BLOCKED(ip)

    monkeypatch.setattr(socket.socket, "connect", _REAL_CONNECT)
    monkeypatch.setattr(ssrf_guard, "_ip_is_blocked", allow_loopback)
    monkeypatch.setattr(pinning, "_ip_is_blocked", allow_loopback)
    fake_dns.records["drip.example"] = ["127.0.0.1"]
    servers: list[_DripServer] = []

    def start(head: bytes, body: bytes, *, interval: float, drip: str) -> _DripServer:
        server = _DripServer(head, body, interval, drip)
        servers.append(server)
        server.start()
        return server

    yield start
    for server in servers:
        server.stop()


class _DripServer(threading.Thread):
    """Answers one request, sending the head and/or body one byte per ``interval``.

    Gives up after 3 s, so the pre-deadline behaviour fails in seconds, not minutes.
    """

    def __init__(self, head: bytes, body: bytes, interval: float, drip: str) -> None:
        super().__init__(daemon=True)
        self.head, self.body, self.interval, self.drip = head, body, interval, drip
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(1)
        self.listener.settimeout(5)
        self.port = self.listener.getsockname()[1]
        self.halt = threading.Event()

    def run(self) -> None:
        try:
            conn, _ = self.listener.accept()
        except OSError:
            return
        with conn:
            conn.settimeout(5)
            try:
                request = b""
                while b"\r\n\r\n" not in request:
                    chunk = conn.recv(4096)
                    if not chunk:
                        return
                    request += chunk
                give_up = time.monotonic() + 3
                for part, slow in ((self.head, self.drip in ("head", "both")),
                                   (self.body, self.drip in ("body", "both"))):
                    if not slow:
                        conn.sendall(part)
                        continue
                    for i in range(len(part)):
                        if self.halt.is_set() or time.monotonic() > give_up:
                            return
                        conn.sendall(part[i:i + 1])
                        time.sleep(self.interval)
            except OSError:
                return

    def stop(self) -> None:
        self.halt.set()
        self.listener.close()
        self.join(5)


HEAD_1000 = b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n"


def test_control_a_prompt_loopback_server_is_fetched(loopback) -> None:
    server = loopback(HEAD_1000, b"y" * 1000, interval=0, drip="none")
    with pinned_urlopen(f"http://drip.example:{server.port}/", timeout=2) as resp:
        assert resp.read() == b"y" * 1000


def test_slow_drip_body_ends_at_the_deadline(loopback) -> None:
    # One byte every 50 ms never trips a 0.6 s socket timeout; only the deadline stops it.
    server = loopback(HEAD_1000, b"x" * 1000, interval=0.05, drip="body")
    start = time.monotonic()
    with pinned_urlopen(f"http://drip.example:{server.port}/", timeout=0.6) as resp:
        with pytest.raises(pinning.DeadlineExceededError) as excinfo:
            resp.read()
    assert time.monotonic() - start < 0.6 + SLACK
    assert excinfo.value.phase == "reading the response"


def test_slow_drip_head_ends_at_the_deadline(loopback) -> None:
    server = loopback(HEAD_1000, b"x" * 1000, interval=0.05, drip="head")
    start = time.monotonic()
    with pytest.raises(pinning.DeadlineExceededError):
        pinned_urlopen(f"http://drip.example:{server.port}/", timeout=0.6)
    assert time.monotonic() - start < 0.6 + SLACK


def test_reads_after_the_deadline_fail_even_when_the_body_is_buffered(loopback) -> None:
    # The whole body most likely arrived with the head; the deadline still applies to
    # every read, as it does for the TS twin's body stream.
    server = loopback(HEAD_1000, b"z" * 1000, interval=0, drip="none")
    with pinned_urlopen(f"http://drip.example:{server.port}/", timeout=0.4) as resp:
        time.sleep(0.5)
        with pytest.raises(pinning.DeadlineExceededError):
            resp.read(64)
