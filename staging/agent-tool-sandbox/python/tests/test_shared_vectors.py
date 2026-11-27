"""Shared SSRF vector corpus: every vector's recorded Python verdict.

The corpus (``../../vectors/ssrf-vectors.json``) is shared with the TypeScript package and
RECORDS current behaviour per language; ``vectors/DIFFERENCES.md`` lists where they disagree.
A failure here means Python's verdict changed: if that is intended, regenerate the corpus
with ``python3 vectors/generate.py --write`` and review the diff (see vectors/README.md).

Harness (identical to vectors/generate.py; change both together):
  level "url": ``assert_safe_fetch_url(input)``. ``socket.getaddrinfo`` answers IP literals
    through the real libc parser (``AI_NUMERICHOST``, so ``127.1`` and ``0x7f.1`` behave as
    in production) and every other name with ``resolves_to`` (NXDOMAIN when absent).
  level "ip": ``assert_safe_fetch_url("http://ip-vector.test/")`` with the resolver
    answering only ``input``: the post-DNS address check, IPv4-mapped unwrap included.
  "block" = SsrfBlockedError; "allow" = the guard returned a URL. Any other exception fails.
"""

from __future__ import annotations

import ipaddress
import json
import socket
from pathlib import Path
from typing import Any

import pytest

from agent_tool_sandbox import SsrfBlockedError, assert_safe_fetch_url

CORPUS = Path(__file__).resolve().parents[2] / "vectors" / "ssrf-vectors.json"
DOC: dict[str, Any] = json.loads(CORPUS.read_text(encoding="utf-8"))
VECTORS: list[dict[str, Any]] = DOC["vectors"]
IP_LEVEL_URL = "http://ip-vector.test/"

_REAL_GETADDRINFO = socket.getaddrinfo


def _addrinfo(address: str, port: object) -> tuple:
    p = port if isinstance(port, int) else 0
    if ipaddress.ip_address(address).version == 4:
        return (socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, p))
    return (socket.AF_INET6, socket.SOCK_STREAM, 6, "", (address, p, 0, 0))


def _fake_getaddrinfo(answers: list[str] | None):
    def getaddrinfo(host, port, family=0, socktype=0, proto=0, flags=0):
        try:
            return _REAL_GETADDRINFO(
                host, port, family, socktype, proto, flags | socket.AI_NUMERICHOST
            )
        except socket.gaierror:
            pass
        if answers is None:
            raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")
        return [_addrinfo(a, port) for a in answers]

    return getaddrinfo


def test_corpus_is_loaded() -> None:
    assert DOC["schema_version"] == 1
    assert len(VECTORS) >= 150
    assert len({v["id"] for v in VECTORS}) == len(VECTORS)


@pytest.mark.parametrize("vector", VECTORS, ids=[v["id"] for v in VECTORS])
def test_shared_vector(vector: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    if vector["level"] == "ip":
        target, answers = IP_LEVEL_URL, [vector["input"]]
    else:
        target, answers = vector["input"], vector.get("resolves_to")
    # Overrides conftest's autouse fake_dns for this test only.
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo(answers))
    try:
        assert_safe_fetch_url(target)
        verdict, reason = "allow", "accepted"
    except SsrfBlockedError as exc:
        verdict, reason = "block", str(exc)
    assert verdict == vector["expected"]["python"], (
        f"{vector['id']} {vector['input']!r}: got {verdict} ({reason}); "
        f"corpus records {vector['expected']['python']}. {vector['rationale']}"
    )
