#!/usr/bin/env python3
"""Pho3nix tuner — in-scope tool param bounds documentation.

Documents and validates the min/max/direction metadata for Pho3nix tool
parameters that the Phase 3 tuner can evolve. These are the numeric params
that lie in the intersection of:
  - Pho3nix optimization_profiles (parameter_optimizer.py)
  - rebuild_command_with_params applicable params (command_params.py)

By default: prints the bounds table.
With --tooltime-dir: also writes min/max/direction into the matching
tooltime tool.yaml files (non-breaking — every consumer uses .get()).

Scope (3 tools, 8 params total):
  gobuster: threads, delay_ms, timeout_sec
  nmap:     timing_t
  sqlmap:   level, risk   (documented only — rebuild can't apply these)

Usage:
    python pho3nix_tuner/tooltime_bounds.py
    python pho3nix_tuner/tooltime_bounds.py --tooltime-dir ~/dev/tooltime/tools
    python pho3nix_tuner/tooltime_bounds.py --json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Bounds table — the authoritative source for Phase 3 gene space
# ---------------------------------------------------------------------------

BOUNDS: list[dict] = [
    # gobuster (all 3 applicable via rebuild_command_with_params)
    {
        "tool": "gobuster",
        "param": "threads",
        "type": "int",
        "min": 5,
        "max": 50,
        "direction": "maximize",  # more threads = faster (up to rate-limit)
        "unit": "threads",
        "in_rebuild": True,
        "in_profiles": True,
        "note": "stealth=5, normal=20, aggressive=50 in optimization_profiles",
    },
    {
        "tool": "gobuster",
        "param": "delay_ms",
        "type": "int",
        "min": 0,
        "max": 1000,
        "direction": "minimize",  # lower delay = faster (stealth needs higher)
        "unit": "ms",
        "in_rebuild": True,
        "in_profiles": True,
        "note": "profiles use '0s'/'1s' strings; genome uses ms int; stealth=1000ms",
    },
    {
        "tool": "gobuster",
        "param": "timeout_sec",
        "type": "int",
        "min": 5,
        "max": 30,
        "direction": "context",  # stealth needs longer timeout; aggressive shorter
        "unit": "seconds",
        "in_rebuild": True,
        "in_profiles": True,
        "note": "stealth=30s, normal=10s, aggressive=5s in optimization_profiles",
    },
    # nmap (timing via rebuild)
    {
        "tool": "nmap",
        "param": "timing_t",
        "type": "int",
        "min": 2,
        "max": 5,
        "direction": "context",  # T2=stealth, T4=normal, T5=aggressive
        "unit": "nmap-T-value",
        "in_rebuild": True,
        "in_profiles": True,
        "note": "maps to '-T{n}' flag; stealth=-T2, normal=-T4, aggressive=-T5",
    },
    # sqlmap (documented only — rebuild_command_with_params does NOT apply these)
    {
        "tool": "sqlmap",
        "param": "level",
        "type": "int",
        "min": 1,
        "max": 3,
        "direction": "maximize",
        "unit": "level",
        "in_rebuild": False,
        "in_profiles": True,
        "note": "DOCUMENTED ONLY — rebuild_command_with_params does not apply sqlmap level",
    },
    {
        "tool": "sqlmap",
        "param": "risk",
        "type": "int",
        "min": 1,
        "max": 3,
        "direction": "maximize",
        "unit": "risk",
        "in_rebuild": False,
        "in_profiles": True,
        "note": "DOCUMENTED ONLY — rebuild_command_with_params does not apply sqlmap risk",
    },
    {
        "tool": "sqlmap",
        "param": "threads",
        "type": "int",
        "min": 1,
        "max": 10,
        "direction": "maximize",
        "unit": "threads",
        "in_rebuild": False,
        "in_profiles": True,
        "note": "DOCUMENTED ONLY — rebuild only handles gobuster/feroxbuster/ffuf threads",
    },
    {
        "tool": "sqlmap",
        "param": "delay",
        "type": "int",
        "min": 0,
        "max": 5,
        "direction": "minimize",
        "unit": "seconds",
        "in_rebuild": False,
        "in_profiles": True,
        "note": "DOCUMENTED ONLY — rebuild only handles gobuster/feroxbuster delay",
    },
]

# Params actually evolvable by the Phase 3 GA (in_rebuild=True ∩ in_profiles=True)
EVOLVABLE_BOUNDS = [b for b in BOUNDS if b["in_rebuild"] and b["in_profiles"]]


def _print_table(bounds: list[dict]) -> None:
    header = (
        f"{'tool':<12} {'param':<14} {'type':<6} {'min':>6} {'max':>6}"
        f" {'direction':<12} {'unit':<14} {'in_rebuild'}"
    )
    print(header)
    print("-" * 90)
    for b in bounds:
        rebuild_marker = "✓" if b["in_rebuild"] else "— (doc only)"
        print(
            f"{b['tool']:<12} {b['param']:<14} {b['type']:<6} {b['min']:>6} {b['max']:>6}"
            f"  {b['direction']:<12} {b['unit']:<14} {rebuild_marker}"
        )


def _write_to_tooltime(tooltime_dir: Path, bounds: list[dict]) -> None:
    """Write min/max/direction into tooltime tool.yaml files.

    Only writes for tools that have a matching .yaml in tooltime_dir.
    Non-breaking: Pho3nix's yaml loader uses .get() for all params fields.
    """
    import yaml  # type: ignore[import-untyped]

    written = 0
    for b in bounds:
        tool_yaml = tooltime_dir / b["tool"] / "tool.yaml"
        if not tool_yaml.exists():
            print(f"  SKIP {b['tool']}/{b['param']}: {tool_yaml} not found")
            continue
        with tool_yaml.open() as f:
            doc = yaml.safe_load(f)
        params = doc.setdefault("params", [])
        # Find matching param entry by name
        matched = next((p for p in params if p.get("name") == b["param"]), None)
        if matched is None:
            # Append a new param entry
            params.append({
                "name": b["param"],
                "type": b["type"],
                "min": b["min"],
                "max": b["max"],
                "direction": b["direction"],
                "unit": b.get("unit"),
            })
        else:
            matched["min"] = b["min"]
            matched["max"] = b["max"]
            matched["direction"] = b["direction"]
            if "unit" not in matched:
                matched["unit"] = b.get("unit")
        with tool_yaml.open("w") as f:
            yaml.dump(doc, f, sort_keys=False, allow_unicode=True)
        print(
            f"  WROTE {b['tool']}/{b['param']}: "
            f"min={b['min']}, max={b['max']}, direction={b['direction']}"
        )
        written += 1

    print(f"\n  Wrote {written} param bounds to {tooltime_dir}")


def main() -> int:
    p = argparse.ArgumentParser(
        description="Pho3nix tuner — in-scope tool param bounds"
    )
    p.add_argument(
        "--tooltime-dir",
        help="Path to tooltime tools/ dir; if given, write min/max/direction into tool.yaml files",
    )
    p.add_argument(
        "--json",
        action="store_true",
        help="Output machine-readable JSON",
    )
    p.add_argument(
        "--all",
        action="store_true",
        help="Include documented-only params (sqlmap, not in rebuild)",
    )
    args = p.parse_args()

    bounds = BOUNDS if args.all else EVOLVABLE_BOUNDS

    if args.json:
        print(json.dumps(bounds, indent=2))
        return 0

    print("=" * 72)
    print("Pho3nix Tuner — In-scope Tool Param Bounds")
    print("=" * 72)
    print()
    print("Evolvable params (in_rebuild=True ∩ in_profiles=True):")
    print()
    _print_table(EVOLVABLE_BOUNDS)
    if args.all:
        print()
        print("Documented-only params (in_rebuild=False — rebuild can't apply):")
        print()
        _print_table([b for b in BOUNDS if not b["in_rebuild"]])
    print()
    print("Notes:")
    for b in bounds:
        print(f"  {b['tool']}/{b['param']}: {b['note']}")

    if args.tooltime_dir:
        print()
        print(f"Writing to tooltime dir: {args.tooltime_dir}")
        try:
            _write_to_tooltime(Path(args.tooltime_dir).expanduser(), bounds)
        except ImportError:
            print("  ERROR: PyYAML not installed; run: pip install pyyaml", file=sys.stderr)
            return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
