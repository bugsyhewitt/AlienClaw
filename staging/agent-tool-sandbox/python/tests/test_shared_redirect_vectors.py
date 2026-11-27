"""Shared redirect corpus: every vector's recorded Python behaviour (plan gate G5).

The corpus (``../../vectors/redirect-vectors.json``) is shared with the TypeScript package
and RECORDS current behaviour per language; ``vectors/REDIRECT-DIFFERENCES.md`` lists where
the two disagree. A failure here means Python's redirect behaviour changed: if that is
intended, re-record (below) and review the diff.

Harness (the TS twin, ``ts/test/shared-redirect-vectors.test.ts``, is the same; change both
together). Run it under ``staging/tools/offline.sh``, which leaves only loopback reachable.

- Each vector's ``servers`` are REAL listeners on 127.0.0.1, one per server, each serving
  its scripted ``routes`` (status, headers, body, delays, drip, stall) and logging every
  request it receives: method, target, the ``harness.tracked_headers`` it carried, body.
- ``{x}``, ``{host:x}`` and ``{port:x}`` in URLs, Locations and request headers become
  server x's origin, ``host:port`` and port. Server x is named ``x.redirect.test`` (RFC 6761
  reserves ``.test``) unless it sets ``host``.
- Test-only resolver: ``socket.getaddrinfo`` answers IP literals through libc
  (``AI_NUMERICHOST``) and every server name with ``harness.test_only_sentinel``, a PUBLIC
  address, so the guard's policy is untouched (127.0.0.1 stays refused, see
  ``test_the_harness_does_not_weaken_the_guard``). ``dns`` adds names (``@sentinel`` means
  that address); every other name is NXDOMAIN. Each name asked for is logged.
- Test-only wire: ``socket.socket.connect`` (this module's ``_no_network`` replaces
  conftest's) sends a connect to exactly (sentinel, a listener's port) to 127.0.0.1:port.
  Every other connect is refused and logged in ``stray_connects``, so "refused before
  connecting" is observable.
- The call: ``pinned_urlopen(url, body, timeout=timeout_ms / 1000, headers=..., method=...,
  context=<verifying context trusting a throwaway openssl CA>, follow_redirects=
  max_redirects)``, body read inside the deadline. HTTPS vectors skip without ``openssl``.

Observation: ``outcome`` ``ok`` (``status``, ``body``) or ``error`` (``error`` code:
``blocked`` for any guard refusal, ``downgrade``, ``hop_cap``, ``deadline``, ``http_status``
with ``status``, ``no_location``, ``multiple_location``, ``invalid_location``,
``network_error``, or
``crash:<Type>`` for an exception outside the documented ones), plus ``hops``, ``resolved``
and ``stray_connects``, with listener ports written back as ``{port:x}``.
``hops_deterministic: false`` vectors compare only the outcome and check ``elapsed_max_ms``.

Re-record: ``REDIRECT_VECTORS_RECORD=<dir>`` writes ``<dir>/<id>.python.json`` per vector
instead of asserting; merge those into ``expected.python`` and hand-review the diff.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import urllib.error
from collections.abc import Callable, Iterator
from http import HTTPStatus
from pathlib import Path
from typing import Any

import pytest

from agent_tool_sandbox import SsrfBlockedError, pinned_urlopen, resolve_and_validate
from agent_tool_sandbox.pinning import DeadlineExceededError

CORPUS = Path(__file__).resolve().parents[2] / "vectors" / "redirect-vectors.json"
DOC: dict[str, Any] = json.loads(CORPUS.read_text(encoding="utf-8"))
HARNESS: dict[str, Any] = DOC["harness"]
VECTORS: list[dict[str, Any]] = DOC["vectors"]
SENTINEL: str = HARNESS["test_only_sentinel"]
SUFFIX: str = HARNESS["hostname_suffix"]
TRACKED: list[str] = HARNESS["tracked_headers"]
RECORD_DIR = os.environ.get("REDIRECT_VECTORS_RECORD")

_REAL_GETADDRINFO = socket.getaddrinfo  # read at import, before any fixture patches it
_REAL_CONNECT = socket.socket.connect
_PLACEHOLDER = re.compile(r"\{(?:(host|port):)?([a-z0-9]+)\}")
_MAX_HEAD = 65536


# ── Test-only wire and resolver ─────────────────────────────────────────────


class _Wire:
    def __init__(self) -> None:
        self.allowed: set[tuple[str, int]] = set()
        self.strays: list[str] = []


@pytest.fixture(autouse=True)
def _no_network(monkeypatch: pytest.MonkeyPatch) -> _Wire:
    """Overrides conftest's: only (sentinel, listener port) connects, sent to 127.0.0.1."""
    wire = _Wire()

    def connect(sock: socket.socket, address: Any, *args: Any, **kwargs: Any) -> None:
        if (address[0], address[1]) in wire.allowed:
            return _REAL_CONNECT(sock, ("127.0.0.1", address[1]))
        wire.strays.append(f"{address[0]}:{address[1]}")
        raise ConnectionRefusedError(111, "test: only the vector's listeners are reachable")

    def refuse(sock: socket.socket, address: Any, *args: Any, **kwargs: Any) -> int:
        wire.strays.append(f"{address[0]}:{address[1]}")
        raise RuntimeError("test: connect_ex is not used by the library")

    monkeypatch.setattr(socket.socket, "connect", connect)
    monkeypatch.setattr(socket.socket, "connect_ex", refuse)
    return wire


def _addrinfo(address: str, port: object) -> tuple:
    p = port if isinstance(port, int) else 0
    if ":" in address:
        return (socket.AF_INET6, socket.SOCK_STREAM, 6, "", (address, p, 0, 0))
    return (socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, p))


def _resolver(table: dict[str, list[str]], asked: list[str]) -> Callable[..., list]:
    def getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        try:
            return _REAL_GETADDRINFO(host, port, family, type, proto, flags | socket.AI_NUMERICHOST)
        except socket.gaierror:
            pass
        name = (host.decode("ascii") if isinstance(host, bytes) else host).lower().rstrip(".")
        asked.append(name)
        answers = table.get(name)
        if not answers:
            raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")
        return [_addrinfo(a, port) for a in answers]

    return getaddrinfo


# ── TLS material (throwaway, test-only trust) ───────────────────────────────


@pytest.fixture(scope="module")
def tls_files() -> Iterator[tuple[str, str] | None]:
    if shutil.which("openssl") is None:
        yield None
        return
    tmp = tempfile.mkdtemp(prefix="redirect-vectors-")
    cert, key = os.path.join(tmp, "cert.pem"), os.path.join(tmp, "key.pem")
    try:
        subprocess.run(
            ["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt",
             "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", key, "-out", cert,
             "-days", "2", "-subj", "/CN=redirect.test",
             "-addext", f"subjectAltName=DNS:*{SUFFIX}"],
            check=True, capture_output=True, timeout=60,
        )
        yield cert, key
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ── Scripted listeners ──────────────────────────────────────────────────────


def _read_request(conn: socket.socket) -> tuple[str, str, dict[str, str], bytes]:
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = conn.recv(4096)
        if not chunk or len(buf) > _MAX_HEAD:
            raise ConnectionError("incomplete request head")
        buf += chunk
    head, _, rest = buf.partition(b"\r\n\r\n")
    lines = head.decode("latin-1").split("\r\n")
    method, target, _version = lines[0].split(" ", 2)
    headers: dict[str, str] = {}
    for line in lines[1:]:
        name, _, value = line.partition(":")
        name, value = name.strip().lower(), value.strip()
        headers[name] = f"{headers[name]}, {value}" if name in headers else value
    length = int(headers.get("content-length", "0") or "0")
    while len(rest) < length:
        chunk = conn.recv(4096)
        if not chunk:
            break
        rest += chunk
    return method, target, headers, rest[:length]


class _Listener:
    def __init__(self, name: str, spec: dict[str, Any], tls: ssl.SSLContext | None) -> None:
        self.name = name
        self.spec = spec
        self.host = spec.get("host", f"{name}{SUFFIX}")
        self.tls = tls if spec["scheme"] == "https" else None
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(32)
        self.port: int = self.sock.getsockname()[1]
        self.threads: list[threading.Thread] = []


class _Scene:
    """One vector's listeners, request log and placeholder substitution."""

    def __init__(self, vector: dict[str, Any], tls_files: tuple[str, str] | None) -> None:
        tls = None
        if tls_files is not None:
            tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            tls.load_cert_chain(*tls_files)
        self.stop = threading.Event()
        self.hops: list[dict[str, Any]] = []
        self.lock = threading.Lock()
        self.listeners = {n: _Listener(n, s, tls) for n, s in vector["servers"].items()}
        self.ports = {str(lst.port): n for n, lst in self.listeners.items()}

    def subst(self, text: str) -> str:
        def one(m: re.Match[str]) -> str:
            kind, name = m.group(1), m.group(2)
            lst = self.listeners[name]
            if kind == "port":
                return str(lst.port)
            if kind == "host":
                return f"{lst.host}:{lst.port}"
            return f"{lst.spec['scheme']}://{lst.host}:{lst.port}"

        return _PLACEHOLDER.sub(one, text)

    def norm(self, text: str) -> str:
        return re.sub(r"(?<!\d)\d{2,5}(?!\d)",
                      lambda m: f"{{port:{self.ports[m.group(0)]}}}"
                      if m.group(0) in self.ports else m.group(0), text)

    def start(self) -> None:
        for lst in self.listeners.values():
            t = threading.Thread(target=self._accept, args=(lst,), daemon=True)
            lst.threads.append(t)
            t.start()

    def close(self) -> None:
        self.stop.set()
        for lst in self.listeners.values():
            lst.sock.close()
        for lst in self.listeners.values():
            for t in lst.threads:
                t.join(timeout=5)

    def _accept(self, lst: _Listener) -> None:
        lst.sock.settimeout(0.05)  # close() does not wake a blocked accept(); poll the stop flag
        while not self.stop.is_set():
            try:
                conn, _ = lst.sock.accept()
            except TimeoutError:
                continue
            except OSError:
                return
            t = threading.Thread(target=self._serve, args=(lst, conn), daemon=True)
            lst.threads.append(t)
            t.start()

    def _serve(self, lst: _Listener, conn: socket.socket) -> None:
        conn.settimeout(10)
        try:
            if lst.tls is not None:
                conn = lst.tls.wrap_socket(conn, server_side=True)
            method, target, headers, body = _read_request(conn)
            with self.lock:
                self.hops.append({
                    "server": lst.name,
                    "method": method,
                    "target": self.norm(target),
                    "headers": {h: self.norm(headers[h]) for h in TRACKED if h in headers},
                    "body": body.decode("latin-1"),
                })
            routes = lst.spec["routes"]
            route = routes.get(target) or routes.get("*") or {"status": 404, "body": "no route"}
            self._respond(conn, method, route)
        except (OSError, ValueError, ssl.SSLError):
            pass
        finally:
            conn.close()

    def _respond(self, conn: socket.socket, method: str, route: dict[str, Any]) -> None:
        if route.get("stall"):
            self.stop.wait()
            return
        if route.get("delay_ms") and self.stop.wait(route["delay_ms"] / 1000):
            return
        status = route.get("status", 200)
        payload = (self.subst(route.get("body", "")) * route.get("body_repeat", 1)).encode()
        try:
            reason = HTTPStatus(status).phrase
        except ValueError:
            reason = "Unassigned"
        lines = [f"HTTP/1.1 {status} {reason}"]
        lines += [f"{k}: {self.subst(v)}" for k, v in route.get("headers", [])]
        lines += [f"Content-Length: {len(payload)}", "Connection: close"]
        conn.sendall(("\r\n".join(lines) + "\r\n\r\n").encode("utf-8"))
        if method == "HEAD" or not payload:
            return
        drip = route.get("drip_ms")
        if not drip:
            conn.sendall(payload)
            return
        for i in range(len(payload)):
            if self.stop.wait(drip / 1000):
                return
            conn.sendall(payload[i:i + 1])


# ── Running one vector ──────────────────────────────────────────────────────


def _classify(exc: BaseException) -> dict[str, Any]:
    if isinstance(exc, DeadlineExceededError):
        return {"error": "deadline"}
    if isinstance(exc, SsrfBlockedError):
        msg = str(exc)
        if re.search(r"more than \d+ redirects$", msg) or re.fullmatch(r"Redirect to .* blocked",
                                                                       msg):
            return {"error": "hop_cap"}
        if "https to http downgrade" in msg:
            return {"error": "downgrade"}
        if re.fullmatch(r"Refusing redirect \(status \d+\): \d+ Location headers", msg):
            return {"error": "multiple_location"}
        return {"error": "blocked"}  # a guard refusal; ``resolved`` shows whether DNS ran
    if isinstance(exc, urllib.error.HTTPError):
        exc.close()
        return {"error": "http_status", "status": exc.code}
    if isinstance(exc, urllib.error.URLError):
        return {"error": "network_error"}
    return {"error": f"crash:{type(exc).__name__}"}


def _observe(vector: dict[str, Any], scene: _Scene, wire: _Wire, asked: list[str],
             context: ssl.SSLContext | None) -> tuple[dict[str, Any], float, str]:
    request, policy = vector["request"], vector["policy"]
    headers = {k: scene.subst(v) for k, v in request["headers"].items()}
    data = None if request["body"] is None else scene.subst(request["body"]).encode()
    detail = "ok"
    start = time.monotonic()
    try:
        with pinned_urlopen(
            scene.subst(request["url"]), data, timeout=policy["timeout_ms"] / 1000,
            headers=headers, method=request["method"], context=context,
            follow_redirects=policy["max_redirects"],
        ) as resp:
            body = resp.read()
            outcome: dict[str, Any] = {
                "outcome": "ok", "status": resp.status, "body": body.decode("utf-8", "replace"),
            }
    except Exception as exc:  # classified; an unknown type is recorded as crash:<Type>
        outcome = {"outcome": "error", **_classify(exc)}
        detail = f"{type(exc).__name__}: {exc}"
    elapsed_ms = (time.monotonic() - start) * 1000
    time.sleep(0.05)  # let a listener finish logging a hop the client already abandoned
    with scene.lock:
        hops = list(scene.hops)
    observed = {
        **outcome,
        "hops": hops,
        "resolved": list(asked),
        "stray_connects": [scene.norm(s) for s in wire.strays],
    }
    return observed, elapsed_ms, detail


def _comparable(observed: dict[str, Any], vector: dict[str, Any]) -> dict[str, Any]:
    if vector.get("hops_deterministic", True):
        return observed
    return {k: v for k, v in observed.items() if k not in ("hops", "resolved")}


# ── Tests ───────────────────────────────────────────────────────────────────


def test_corpus_is_loaded() -> None:
    assert DOC["schema_version"] == 1
    assert len(VECTORS) >= 60
    assert len({v["id"] for v in VECTORS}) == len(VECTORS)
    if RECORD_DIR is None:
        assert all({"python", "ts"} <= set(v["expected"]) for v in VECTORS)


def test_the_harness_does_not_weaken_the_guard(fake_dns) -> None:
    """The listeners' real address stays refused; the sentinel is an ordinary public IP."""
    with pytest.raises(SsrfBlockedError):
        resolve_and_validate("http://127.0.0.1/")
    fake_dns.records["sentinel.example"] = [SENTINEL]
    assert [str(ip) for ip in resolve_and_validate("http://sentinel.example/").addresses] == [
        SENTINEL
    ]


@pytest.mark.parametrize("vector", VECTORS, ids=[v["id"] for v in VECTORS])
def test_shared_redirect_vector(vector: dict[str, Any], monkeypatch: pytest.MonkeyPatch,
                                _no_network: _Wire, tls_files) -> None:
    needs_tls = any(s["scheme"] == "https" for s in vector["servers"].values())
    if needs_tls and tls_files is None:
        pytest.skip("openssl is needed for the https listeners")
    context = None
    if tls_files is not None:
        context = ssl.create_default_context(cafile=tls_files[0])  # test-only trust anchor
        context.set_alpn_protocols(["http/1.1"])
    scene = _Scene(vector, tls_files)
    table = {lst.host.lower(): [SENTINEL] for lst in scene.listeners.values()}
    for name, answers in vector["dns"].items():
        table[name.lower().rstrip(".")] = [SENTINEL if a == "@sentinel" else a for a in answers]
    asked: list[str] = []
    monkeypatch.setattr(socket, "getaddrinfo", _resolver(table, asked))
    _no_network.allowed = {(SENTINEL, lst.port) for lst in scene.listeners.values()}
    scene.start()
    try:
        observed, elapsed_ms, detail = _observe(vector, scene, _no_network, asked, context)
    finally:
        scene.close()
    if RECORD_DIR is not None:
        Path(RECORD_DIR).mkdir(parents=True, exist_ok=True)
        record = {"observed": _comparable(observed, vector), "full": observed,
                  "elapsed_ms": round(elapsed_ms), "detail": detail}
        Path(RECORD_DIR, f"{vector['id']}.python.json").write_text(
            json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
        return
    expected = vector["expected"]["python"]
    assert _comparable(observed, vector) == expected, (
        f"{vector['id']}: observed {json.dumps(observed, ensure_ascii=False)} ({detail}); "
        f"corpus records {json.dumps(expected, ensure_ascii=False)}. {vector['rationale']}"
    )
    if "elapsed_max_ms" in vector:
        assert elapsed_ms <= vector["elapsed_max_ms"], (vector["id"], elapsed_ms)
