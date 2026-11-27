#!/usr/bin/env python3
"""Fill the ``expected`` verdicts in ssrf-vectors.json by RUNNING both implementations.

    python3 generate.py              check: run both languages, report every verdict that
                                     differs from the file, exit 1 if any does
    python3 generate.py --write      also write the observed verdicts into the file
    python3 generate.py --explain    print each implementation's reason for every vector
                                     where python != ts (input to DIFFERENCES.md)

Python verdicts come from ``../python/src`` (imported in-process, no install needed). TS
verdicts come from ``generate-ts.mjs``, run with tsx: ``--tsx PATH``, ``$TSX``, or the nearest
``node_modules/.bin/tsx`` above this directory. Network-free: both harnesses replace the
resolver, and the TS harness replaces ``fetch``.

The harness semantics are documented in README.md and repeated verbatim in
``python/tests/test_shared_vectors.py`` and ``ts/test/shared-vectors.test.ts``. Change all four
together.
"""

from __future__ import annotations

import argparse
import datetime
import ipaddress
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
CORPUS = HERE / "ssrf-vectors.json"
PY_SRC = HERE.parent / "python" / "src"
TS_EXPORTER = HERE / "generate-ts.mjs"

SCHEMA_VERSION = 1
LEVELS = ("url", "ip")
VERDICTS = ("block", "allow")
ID_PATTERN = re.compile(r"[a-z0-9][a-z0-9.-]*[a-z0-9]")
VECTOR_KEYS = ("id", "category", "input", "level", "resolves_to", "expected", "rationale", "refs")
REQUIRED_KEYS = frozenset(VECTOR_KEYS) - {"resolves_to", "expected"}

# Host the "ip" level resolves; the resolver answers it with the vector's input only.
IP_LEVEL_URL = "http://ip-vector.test/"

_REAL_GETADDRINFO = socket.getaddrinfo


# --------------------------------------------------------------------------- schema


def validate(doc: dict[str, Any]) -> list[str]:
    """Return every schema problem in the corpus (empty list = valid)."""
    problems: list[str] = []
    if doc.get("schema_version") != SCHEMA_VERSION:
        problems.append(f"schema_version must be {SCHEMA_VERSION}")
    seen: set[str] = set()
    for n, v in enumerate(doc.get("vectors", [])):
        where = f"vector #{n} ({v.get('id', '?')})"
        missing = REQUIRED_KEYS - v.keys()
        extra = v.keys() - set(VECTOR_KEYS)
        if missing or extra:
            problems.append(f"{where}: missing {sorted(missing)} / unknown {sorted(extra)}")
            continue
        if not ID_PATTERN.fullmatch(v["id"]):
            problems.append(f"{where}: id must match {ID_PATTERN.pattern}")
        if v["id"] in seen:
            problems.append(f"{where}: duplicate id")
        seen.add(v["id"])
        if v["level"] not in LEVELS:
            problems.append(f"{where}: level must be one of {LEVELS}")
        if not isinstance(v["input"], str) or not v["input"]:
            problems.append(f"{where}: input must be a non-empty string")
        if not v["category"] or not v["rationale"].strip():
            problems.append(f"{where}: category and rationale must be non-empty")
        if not isinstance(v["refs"], list) or not v["refs"]:
            problems.append(f"{where}: refs must be a non-empty list")
        answers = v.get("resolves_to")
        if answers is not None:
            if v["level"] == "ip":
                problems.append(f"{where}: resolves_to is only meaningful at level 'url'")
            for a in answers if isinstance(answers, list) else [answers]:
                if not _is_ip(a):
                    problems.append(f"{where}: resolves_to entry {a!r} is not an IP address")
        if v["level"] == "ip" and not _is_ip(v["input"]):
            problems.append(f"{where}: level 'ip' input must be an IP address")
        expected = v.get("expected", {})
        for lang, verdict in expected.items():
            if lang not in ("python", "ts") or verdict not in VERDICTS:
                problems.append(f"{where}: bad expected entry {lang!r}: {verdict!r}")
    return problems


def _is_ip(value: object) -> bool:
    try:
        ipaddress.ip_address(value)  # accepts an IPv6 zone ID ("fe80::1%eth0")
    except ValueError:
        return False
    return True


# ---------------------------------------------------------------- python harness


def _addrinfo(address: str, port: object) -> tuple:
    p = port if isinstance(port, int) else 0
    if ipaddress.ip_address(address).version == 4:
        return (socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, p))
    return (socket.AF_INET6, socket.SOCK_STREAM, 6, "", (address, p, 0, 0))


def fake_getaddrinfo(answers: list[str] | None) -> Callable[..., list[tuple]]:
    """A getaddrinfo that never touches the network.

    IP literals go through the REAL libc parser with AI_NUMERICHOST (so 127.1, 0x7f.1 and
    2130706433 behave exactly as in production, and str hosts get the real IDNA encoding).
    Every other name is answered with ``answers``; ``None`` means NXDOMAIN.
    """

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


def python_verdict(vector: dict[str, Any]) -> tuple[str, str]:
    """(verdict, reason) for one vector. Exceptions other than SsrfBlockedError propagate."""
    from agent_tool_sandbox import SsrfBlockedError, assert_safe_fetch_url

    if vector["level"] == "ip":
        target, answers = IP_LEVEL_URL, [vector["input"]]
    else:
        target, answers = vector["input"], vector.get("resolves_to")
    saved = socket.getaddrinfo
    socket.getaddrinfo = fake_getaddrinfo(answers)
    try:
        canonical = assert_safe_fetch_url(target)
    except SsrfBlockedError as exc:
        return "block", str(exc)
    finally:
        socket.getaddrinfo = saved
    return "allow", f"accepted as {canonical}"


def _refuse_connect(self: socket.socket, *args: object, **kwargs: object) -> None:
    raise RuntimeError("connect blocked by the vector harness")


def run_python(vectors: list[dict[str, Any]]) -> dict[str, tuple[str, str]]:
    sys.path.insert(0, str(PY_SRC))
    out: dict[str, tuple[str, str]] = {}
    saved_connect = socket.socket.connect
    socket.socket.connect = _refuse_connect  # tripwire: the guard must never dial
    try:
        for v in vectors:
            try:
                out[v["id"]] = python_verdict(v)
            except Exception as exc:  # a crash is a finding, never a verdict
                out[v["id"]] = ("error", f"{type(exc).__name__}: {exc}")
    finally:
        socket.socket.connect = saved_connect
    return out


# -------------------------------------------------------------------- ts harness


def find_tsx(explicit: str | None) -> str:
    if explicit:
        return explicit
    if os.environ.get("TSX"):
        return os.environ["TSX"]
    for parent in [HERE, *HERE.parents]:
        candidate = parent / "node_modules" / ".bin" / "tsx"
        if candidate.exists():
            return str(candidate)
    found = shutil.which("tsx")
    if found:
        return found
    sys.exit("tsx not found: pass --tsx PATH or set $TSX")


def run_ts(tsx: str) -> tuple[dict[str, tuple[str, str]], str]:
    proc = subprocess.run(
        [tsx, str(TS_EXPORTER), str(CORPUS)],
        capture_output=True,
        text=True,
        cwd=HERE,
        check=False,
    )
    if proc.returncode != 0:
        sys.exit(f"generate-ts.mjs failed (exit {proc.returncode}):\n{proc.stderr}")
    report = json.loads(proc.stdout)
    verdicts = {k: (r["verdict"], r["reason"]) for k, r in report["verdicts"].items()}
    return verdicts, report["node"]


# ----------------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--write", action="store_true", help="write observed verdicts to the file")
    ap.add_argument("--explain", action="store_true", help="print reasons where python != ts")
    ap.add_argument("--tsx", help="path to the tsx binary")
    args = ap.parse_args()

    doc = json.loads(CORPUS.read_text(encoding="utf-8"))
    problems = validate(doc)
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 2
    vectors = doc["vectors"]

    py = run_python(vectors)
    ts, node_version = run_ts(find_tsx(args.tsx))

    errors = [
        f"{lang} {vid}: {reason}"
        for lang, table in (("python", py), ("ts", ts))
        for vid, (verdict, reason) in table.items()
        if verdict not in VERDICTS
    ]
    missing = [v["id"] for v in vectors if v["id"] not in ts]
    if errors or missing:
        print("harness errors (fix the harness or report the crash):", file=sys.stderr)
        print("\n".join(errors + [f"ts {m}: no verdict" for m in missing]), file=sys.stderr)
        return 3

    changed = 0
    for v in vectors:
        observed = {"python": py[v["id"]][0], "ts": ts[v["id"]][0]}
        if v.get("expected") != observed:
            changed += 1
            print(f"CHANGED {v['id']}: {v.get('expected')} -> {observed}")
        if args.explain and observed["python"] != observed["ts"]:
            print(f"  {v['id']} [{v['category']}] {v['input']!r}")
            print(f"    python {observed['python']}: {py[v['id']][1]}")
            print(f"    ts     {observed['ts']}: {ts[v['id']][1]}")
        v["expected"] = observed

    diffs = sum(1 for v in vectors if v["expected"]["python"] != v["expected"]["ts"])
    print(f"{len(vectors)} vectors, {diffs} with python != ts, {changed} changed vs the file")

    generated_with = {
        "python": platform.python_version(),
        "node": node_version.lstrip("v"),
        "platform": sys.platform,
    }
    if not args.write:
        return 1 if changed else 0
    if changed or doc.get("generated_with") != generated_with:
        doc["generated_at"] = datetime.date.today().isoformat()
        doc["generated_with"] = generated_with
    doc["vectors"] = [{k: v[k] for k in VECTOR_KEYS if k in v} for v in vectors]
    CORPUS.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {CORPUS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
