"""Hand-built synthetic Pho3nix run histories for the tuner tests.

Rows mirror the record shape Pho3nix's RunHistoryStore writes (a JSON list of
dicts with id, tool, endpoint, params, session_id, stdout, stderr, return_code,
success, timed_out, partial_results, execution_time, timestamp). Every value is
invented here; nothing is copied from real rig history.

Timestamps are relative to "now" so the reward model's recency weights (absolute
exponential decay) stay in range no matter when the suite runs.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


def row(
    i: int,
    *,
    tool: str = "gobuster",
    endpoint: str = "https://example.test/",
    params: dict[str, Any] | None = None,
    success: bool = False,
    timed_out: bool = False,
    partial_results: bool = False,
    timestamp: str | None = "auto",
) -> dict[str, Any]:
    if timestamp == "auto":
        ts = (datetime.now(timezone.utc) - timedelta(hours=200 - i)).isoformat()
    else:
        ts = timestamp or ""
    return {
        "id": i + 1,
        "tool": tool,
        "endpoint": endpoint,
        "params": params if params is not None else {},
        "session_id": "synthetic",
        "stdout": "",
        "stderr": "",
        "return_code": 0 if success else 1,
        "success": success,
        "timed_out": timed_out,
        "partial_results": partial_results,
        "execution_time": 1.0,
        "timestamp": ts,
    }


# Four gobuster param signatures. Only the mid-range one (D) succeeds; the three
# hand-authored baselines (normal == A, aggressive == B, stealth == C) all lose.
SIG_A = {"threads": 20, "delay_ms": 0, "timeout_sec": 10}      # == DEFAULT_CONFIG
SIG_B = {"threads": 50, "delay_ms": 0, "timeout_sec": 5}       # == AGGRESSIVE_CONFIG
SIG_C = {"threads": 5, "delay_ms": 1000, "timeout_sec": 30}    # == STEALTH_CONFIG
SIG_D = {"threads": 30, "delay_ms": 500, "timeout_sec": 20}    # the winner
_OUTCOMES = [
    (SIG_A, {"timed_out": True}),
    (SIG_B, {"timed_out": True}),
    (SIG_C, {"partial_results": True}),
    (SIG_D, {"success": True}),
]


def sufficient(n: int = 48) -> list[dict]:
    """GO: n gobuster|https rows, timestamps, 4 param signatures interleaved in time."""
    out = []
    for i in range(n):
        params, outcome = _OUTCOMES[i % len(_OUTCOMES)]
        out.append(row(i, params=dict(params), **outcome))
    return out


def empty() -> list[dict]:
    return []


def no_target_tools(n: int = 30) -> list[dict]:
    """Plenty of rows, timestamps and param variation, but none for nmap/gobuster/sqlmap."""
    return [
        row(i, tool=("nuclei" if i % 2 else "wafw00f"), params={"rate": i})
        for i in range(n)
    ]


def no_timestamps(n: int = 30) -> list[dict]:
    rows = sufficient(n)
    for r in rows:
        r["timestamp"] = ""
    return rows


def single_signature(n: int = 30) -> list[dict]:
    """Rig ran defaults only: one param signature per context."""
    return [row(i, params=dict(SIG_A), success=bool(i % 2)) for i in range(n)]


HISTORIES = {
    "empty": empty,
    "no_target_tools": no_target_tools,
    "no_timestamps": no_timestamps,
    "single_signature": single_signature,
    "sufficient": sufficient,
}

# Expected fail-condition prefixes per history (empty list == GO).
EXPECTED_FAILS = {
    "empty": ["no-target-data", "no-timestamps", "no-param-variation"],
    "no_target_tools": ["no-target-data", "no-param-variation"],
    "no_timestamps": ["no-timestamps"],
    "single_signature": ["no-param-variation"],
    "sufficient": [],
}


def write(path: Path, rows: Any) -> Path:
    path.write_text(json.dumps(rows), encoding="utf-8")
    return path
