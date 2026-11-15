#!/usr/bin/env python3
"""Step-1 pre-flight data inspection for the Pho3nix offline tuner.

This is the HARD GATE before any GA run. It loads a Pho3nix run_history JSON
dump and reports:
  - Total rows and rows-per-tool
  - Distinct param-signatures per (tool, context_key)
  - Reward distribution (success/timed_out/partial_results rates)
  - Timestamp span and coverage
  - Per-context support counts

STOP gate fires (exit 1) when:
  1. No rows for any target tool (nmap/gobuster/sqlmap)
  2. No timestamps present in the data (can't do train/held-out split)
  3. Param variation is below threshold for all target tools
     (rig always ran defaults → no counterfactual to learn from)

Rationale: a GA run on data without counterfactuals would chase noise.
Check the data quality before spending compute.

Usage:
    python pho3nix_tuner/inspect_history.py path/to/run_history.json
    python pho3nix_tuner/inspect_history.py --json path/to/run_history.json
    python pho3nix_tuner/inspect_history.py --history-path ~/.pho3nix_data/history/run_history.json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

# Target tools — only these have profiles in parameter_optimizer + applicable genes
TARGET_TOOLS = {"nmap", "gobuster", "sqlmap"}

# Minimum number of distinct param signatures per (tool, context_key) to proceed
MIN_PARAM_SIGNATURES = 2

# Minimum number of rows for target tools to proceed
MIN_TARGET_ROWS = 20

# Minimum number of distinct context keys for a tool (at least some variation)
MIN_CONTEXT_KEYS = 1


def _load_history(path: Path) -> list[dict]:
    """Load run history JSON; handle list or dict-with-entries."""
    with path.open() as f:
        data = json.load(f)
    if isinstance(data, list):
        return data
    # Pho3nix RunHistoryStore wraps in {"entries": [...]} or similar
    for key in ("entries", "runs", "history"):
        if key in data and isinstance(data[key], list):
            return data[key]
    return []


def _context_key(entry: dict) -> str:
    """Derive a context key from an endpoint (mirrors ToolStatsStore bucketing)."""
    endpoint = entry.get("endpoint") or ""
    tool = entry.get("tool", "?")
    # Simple scheme-based context: http, https, ftp, or ip-only
    if endpoint.startswith("https://"):
        scheme = "https"
    elif endpoint.startswith("http://"):
        scheme = "http"
    elif endpoint.startswith("ftp://"):
        scheme = "ftp"
    elif endpoint:
        scheme = "raw"
    else:
        scheme = "unknown"
    return f"{tool}|{scheme}"


def inspect(history_path: Path) -> dict:
    """Inspect a run_history JSON file and return a report dict.

    The report always has:
        total_rows (int)
        tools (dict): {tool: row_count}
        target_tool_rows (int): rows for TARGET_TOOLS
        timestamps_present (bool)
        timestamp_span_days (float | None)
        per_context (dict): {context_key: {count, success_rate, param_signatures}}
        stop_gate (bool): True if any STOP condition triggered
        stop_reason (str | None): human-readable reason if stop_gate=True
        pass_conditions (list[str]): conditions that passed
        fail_conditions (list[str]): conditions that failed (non-empty → stop_gate=True)
    """
    entries = _load_history(history_path)
    total = len(entries)

    # --- Tool counts ---
    tool_counts: Counter[str] = Counter(e.get("tool", "?") for e in entries)
    target_rows = sum(tool_counts.get(t, 0) for t in TARGET_TOOLS)

    # --- Timestamps ---
    timestamps = [e.get("timestamp", "") for e in entries if e.get("timestamp")]
    timestamps_present = len(timestamps) > 0
    timestamp_span_days: float | None = None
    if timestamps_present:
        try:
            from datetime import datetime
            parsed = [datetime.fromisoformat(ts.replace("Z", "+00:00")) for ts in timestamps]
            span = (max(parsed) - min(parsed)).total_seconds() / 86400.0
            timestamp_span_days = round(span, 2)
        except Exception:
            timestamps_present = False  # unparseable counts as absent

    # --- Per-context param signatures ---
    per_context: dict[str, dict] = defaultdict(lambda: {
        "count": 0,
        "success": 0,
        "timed_out": 0,
        "partial": 0,
        "param_sigs": set(),
    })
    for entry in entries:
        tool = entry.get("tool", "?")
        if tool not in TARGET_TOOLS:
            continue
        ctx = _context_key(entry)
        per_context[ctx]["count"] += 1
        if entry.get("success"):
            per_context[ctx]["success"] += 1
        if entry.get("timed_out"):
            per_context[ctx]["timed_out"] += 1
        if entry.get("partial_results"):
            per_context[ctx]["partial"] += 1
        params = entry.get("params", {})
        per_context[ctx]["param_sigs"].add(json.dumps(sorted((params or {}).items())))

    # Serialise param_sigs sets to counts
    per_context_out = {}
    for ctx, info in per_context.items():
        n = info["count"]
        per_context_out[ctx] = {
            "count": n,
            "success_rate": round(info["success"] / n, 4) if n > 0 else 0.0,
            "timeout_rate": round(info["timed_out"] / n, 4) if n > 0 else 0.0,
            "partial_rate": round(info["partial"] / n, 4) if n > 0 else 0.0,
            "param_signatures": len(info["param_sigs"]),
        }

    max_param_sigs = max(
        (v["param_signatures"] for v in per_context_out.values()),
        default=0,
    )
    adequate_variation = max_param_sigs >= MIN_PARAM_SIGNATURES

    # --- STOP gate evaluation ---
    fail_conditions: list[str] = []
    pass_conditions: list[str] = []

    if target_rows < MIN_TARGET_ROWS:
        fail_conditions.append(
            f"no-target-data: {target_rows} rows for {sorted(TARGET_TOOLS)} "
            f"(need {MIN_TARGET_ROWS}); found tools: {dict(tool_counts.most_common(5))}"
        )
    else:
        pass_conditions.append(f"target-data: {target_rows} rows for target tools")

    if not timestamps_present:
        fail_conditions.append(
            "no-timestamps: cannot split train/held-out without timestamps"
        )
    else:
        pass_conditions.append(f"timestamps: span={timestamp_span_days}d")

    if not adequate_variation:
        fail_conditions.append(
            f"no-param-variation: max distinct param sigs per context = {max_param_sigs} "
            f"(need {MIN_PARAM_SIGNATURES}); rig ran defaults only — "
            f"no counterfactual to learn from"
        )
    else:
        pass_conditions.append(f"param-variation: {max_param_sigs} distinct param sigs")

    stop_gate = len(fail_conditions) > 0
    stop_reason = "; ".join(fail_conditions) if fail_conditions else None

    return {
        "history_path": str(history_path),
        "total_rows": total,
        "tools": dict(tool_counts.most_common()),
        "target_tool_rows": target_rows,
        "timestamps_present": timestamps_present,
        "timestamp_span_days": timestamp_span_days,
        "per_context": per_context_out,
        "stop_gate": stop_gate,
        "stop_reason": stop_reason,
        "pass_conditions": pass_conditions,
        "fail_conditions": fail_conditions,
    }


def main() -> int:
    p = argparse.ArgumentParser(
        description="Pho3nix tuner — Step-1 pre-flight data inspection"
    )
    p.add_argument(
        "history_path",
        nargs="?",
        help="Path to run_history.json (or use --history-path)",
    )
    p.add_argument(
        "--history-path",
        dest="history_path_flag",
        help="Path to run_history.json",
    )
    p.add_argument(
        "--json",
        action="store_true",
        help="Output machine-readable JSON report",
    )
    args = p.parse_args()

    path_str = args.history_path or args.history_path_flag
    if not path_str:
        # Default: Alfred's local history
        path_str = Path.home() / ".pho3nix_data" / "history" / "run_history.json"
    history_path = Path(path_str).expanduser()

    if not history_path.exists():
        msg = f"ERROR: history file not found: {history_path}"
        if args.json:
            print(json.dumps({"stop_gate": True, "stop_reason": msg}))
        else:
            print(msg, file=sys.stderr)
        return 1

    report = inspect(history_path)

    if args.json:
        print(json.dumps(report, indent=2))
        return 1 if report["stop_gate"] else 0

    # Human-readable output
    print("=" * 70)
    print("Pho3nix Tuner — Step-1 Pre-Flight Data Inspection")
    print("=" * 70)
    print(f"  history  : {history_path}")
    print(f"  total rows : {report['total_rows']}")
    print()
    print("── Tool breakdown ───────────────────────────────────────────────────")
    for tool, count in report["tools"].items():
        marker = " ★" if tool in TARGET_TOOLS else ""
        print(f"  {tool:<35} {count:>5}{marker}")
    print(f"\n  Target tool rows ({sorted(TARGET_TOOLS)}): {report['target_tool_rows']}")
    print()
    print("── Timestamps ───────────────────────────────────────────────────────")
    if report["timestamps_present"]:
        print(f"  present=True  span={report['timestamp_span_days']}d")
    else:
        print("  present=False")
    print()
    if report["per_context"]:
        print("── Per-context (target tools only) ──────────────────────────────────")
        for ctx, info in report["per_context"].items():
            print(
                f"  {ctx:<35}  count={info['count']}  "
                f"success={info['success_rate']:.2%}  "
                f"param_sigs={info['param_signatures']}"
            )
        print()

    print("── STOP gate ────────────────────────────────────────────────────────")
    for cond in report["pass_conditions"]:
        print(f"  ✓ {cond}")
    for cond in report["fail_conditions"]:
        print(f"  ✗ {cond}")
    print()
    if report["stop_gate"]:
        print("  STOP ✗ — data does not meet minimum quality for GA run")
        print()
        print("  Next step (Step 0): import real rig history:")
        print("    rsync -av xil-1:~/.pho3nix_data/history/run_history.json \\")
        print("          pho3nix_tuner/data/run_history.xil-1.json")
        print("  Then re-run this script against the imported file.")
        return 1
    else:
        print("  GO ✓ — data meets minimum quality; proceed to run_ga.py")
        return 0


if __name__ == "__main__":
    sys.exit(main())
