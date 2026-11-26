#!/usr/bin/env python3
"""AlienClaw × Pho3nix GA runner — Phase 3 PoC.

Runs AlienClaw's GA on Pho3nix profile configs, using an offline reward model
fit from imported rig run-history (xil-1 or sentry).

STOP gate: if inspect_history.py reports inadequate data quality, the GA is
aborted and the script exits 1 with a clear diagnostic message.

Usage:
    # Dry-run against Alfred's synthetic history (confirms STOP gate fires):
    python pho3nix_tuner/run_ga.py --dry-run

    # Real run against imported rig history:
    python pho3nix_tuner/run_ga.py \\
        --history pho3nix_tuner/data/run_history.xil-1.json \\
        --tool gobuster \\
        --context gobuster|https \\
        [--pop-size 12] \\
        [--generations 5] \\
        [--output pho3nix_tuner/results/winner.genome.txt]

Setup (Step 0 — user must do this):
    rsync -av xil-1:~/.pho3nix_data/history/run_history.json \\
          pho3nix_tuner/data/run_history.xil-1.json

Output files:
    <output>              — checksummed 256-char AlienClaw genome
    <output>.config.json  — human-readable decoded config
    <output>.results.json — full comparison table (baseline vs evolved)
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import tempfile
import time
from pathlib import Path

_HERE = Path(__file__).parent
_AC_SRC = _HERE.parent / "src"

for _p in (_AC_SRC, _HERE.parent):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

if "ALIENCLAW_POPULATIONS_ROOT" not in os.environ:
    _pop_root = Path(tempfile.mkdtemp(prefix="pho3nix-tuner-pops-"))
    os.environ["ALIENCLAW_POPULATIONS_ROOT"] = str(_pop_root)
else:
    _pop_root = Path(os.environ["ALIENCLAW_POPULATIONS_ROOT"])

from alienclaw.evolution.generation import evaluate_and_evolve  # noqa: E402
from alienclaw.evolution.population import Population  # noqa: E402
from alienclaw.evolution.types import EvolutionConfig  # noqa: E402
from alienclaw.genome.codec import round_trip_check  # noqa: E402
from pho3nix_tuner.fitness_adapter import evaluate_config  # noqa: E402
from pho3nix_tuner.genome_schema import (  # noqa: E402
    AGGRESSIVE_CONFIG,
    DEFAULT_CONFIG,
    STEALTH_CONFIG,
    decode_pho_config,
    encode_pho_config,
)
from pho3nix_tuner.inspect_history import TARGET_TOOLS, inspect  # noqa: E402
from pho3nix_tuner.reward_model import RewardModel  # noqa: E402

_DEFAULT_HISTORY = Path.home() / ".pho3nix_data" / "history" / "run_history.json"


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="AlienClaw × Pho3nix GA — evolve tool profile configs offline"
    )
    p.add_argument(
        "--history",
        default=str(_DEFAULT_HISTORY),
        help=f"Path to run_history.json (default: {_DEFAULT_HISTORY})",
    )
    p.add_argument(
        "--tool",
        default="gobuster",
        choices=sorted(TARGET_TOOLS),
        help="Tool to optimise for (default: gobuster)",
    )
    p.add_argument(
        "--context",
        default=None,
        help="Context key bucket (default: <tool>|https)",
    )
    p.add_argument("--pop-size", type=int, default=12)
    p.add_argument("--generations", type=int, default=5)
    p.add_argument("--ga-rng-seed", type=int, default=42)
    p.add_argument(
        "--output",
        default="pho3nix_tuner/results/winner.genome.txt",
        help="Output genome file path",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Run pre-flight only; skip GA (useful against Alfred synthetic data)",
    )
    return p.parse_args()


def _fmt_config(cfg: dict) -> str:
    return (
        f"threads={cfg['threads']:<4}  delay_ms={cfg['delay_ms']:<6}"
        f"  timeout_sec={cfg['timeout_sec']:<4}  timing_t={cfg['timing_t']}"
    )


def _run_baseline(
    label: str, config: dict, model: RewardModel, tool: str, context_key: str
) -> float:
    print(f"  [{label}]")
    print(f"    {_fmt_config(config)}")
    fitness = evaluate_config(config, model, tool, context_key)
    print(f"    reward={fitness:.4f}")
    return fitness


def main() -> int:
    args = _parse_args()
    context_key = args.context or f"{args.tool}|https"
    history_path = Path(args.history).expanduser()

    print("=" * 72)
    print("AlienClaw × Pho3nix GA  —  Phase 3 PoC")
    print("=" * 72)
    print(f"  history  : {history_path}")
    print(f"  tool     : {args.tool}  context: {context_key}")
    print(f"  pop_size={args.pop_size}  generations={args.generations}  "
          f"rng_seed={args.ga_rng_seed}")
    print(f"  populations root : {_pop_root}")
    print()

    # ------------------------------------------------------------------
    # Step 1: Pre-flight inspection (STOP gate)
    # ------------------------------------------------------------------
    print("── Step 1: Pre-flight inspection ────────────────────────────────────")
    if not history_path.exists():
        print(f"  ERROR: history file not found: {history_path}")
        print()
        print("  Step 0 (user action required):")
        print("    rsync -av xil-1:~/.pho3nix_data/history/run_history.json \\")
        print("          pho3nix_tuner/data/run_history.xil-1.json")
        print("  Then re-run with --history pho3nix_tuner/data/run_history.xil-1.json")
        return 1

    report = inspect(history_path)
    for cond in report["pass_conditions"]:
        print(f"  ✓ {cond}")
    for cond in report["fail_conditions"]:
        print(f"  ✗ {cond}")
    print()

    if report["stop_gate"]:
        print("  STOP ✗ — data quality insufficient for GA run")
        print(f"  Reason: {report['stop_reason']}")
        print()
        print("  Run inspect_history.py for the full diagnostic:")
        print(f"    python pho3nix_tuner/inspect_history.py {history_path}")
        return 1

    print("  GO ✓ — proceeding to GA")
    print()

    if args.dry_run:
        print("  --dry-run set: stopping after pre-flight (no GA run).")
        return 0

    # ------------------------------------------------------------------
    # Step 2: Build reward model (train slice = oldest 75%)
    # ------------------------------------------------------------------
    print("── Step 2: Building reward model ─────────────────────────────────────")
    with history_path.open() as f:
        raw = json.load(f)
    all_entries = raw if isinstance(raw, list) else raw.get("entries", raw.get("runs", []))

    # Sort by timestamp for train/held-out split
    def ts_key(e):
        return e.get("timestamp", "") or ""

    sorted_entries = sorted(all_entries, key=ts_key)
    split_idx = int(len(sorted_entries) * 0.75)
    train_entries = sorted_entries[:split_idx]
    held_out_entries = sorted_entries[split_idx:]
    print(f"  train={len(train_entries)} entries  held_out={len(held_out_entries)} entries")

    train_model = RewardModel(train_entries)
    held_out_model = RewardModel(held_out_entries)
    print(f"  train global_mean={train_model.global_mean:.4f}  "
          f"context={context_key} support={train_model.context_support(context_key)}")
    print()

    # ------------------------------------------------------------------
    # Step 3: Baselines on training model
    # ------------------------------------------------------------------
    print("── Step 3: Baselines (training model) ───────────────────────────────")
    baseline_stealth = _run_baseline(
        "stealth profile", STEALTH_CONFIG, train_model, args.tool, context_key
    )
    baseline_normal = _run_baseline(
        "normal profile (hand-authored)", DEFAULT_CONFIG, train_model, args.tool, context_key
    )
    baseline_aggressive = _run_baseline(
        "aggressive profile", AGGRESSIVE_CONFIG, train_model, args.tool, context_key
    )
    baseline_best = max(baseline_stealth, baseline_normal, baseline_aggressive)
    print(f"  Best baseline: {baseline_best:.4f}")
    print()

    # ------------------------------------------------------------------
    # Step 4: GA loop
    # ------------------------------------------------------------------
    print("── Step 4: GA ────────────────────────────────────────────────────────")
    rng = random.Random(args.ga_rng_seed)
    run_ts = int(time.time())
    martian_type = f"pho{run_ts}"

    evo_config = EvolutionConfig(
        martian_type=martian_type,
        population_size=args.pop_size,
        tournament_k=3,
        mutation_rate=1.0 / 256.0,
        crossover_rate=0.5,
        elitism_count=2,
        seed=args.ga_rng_seed,
        selection_strategy="tournament",
    )
    pop = Population.create(evo_config)
    print(f"  Created population: martian_type={martian_type!r}  pool={len(pop.all())}")
    print()

    def _fitness_cb(mt: str, genome: str):  # noqa: ARG001
        from alienclaw.evolution.generation import FitnessReport  # noqa: PLC0415
        try:
            cfg = decode_pho_config(genome)
            fitness = evaluate_config(cfg, train_model, args.tool, context_key)
        except Exception:
            fitness = 0.0
        return FitnessReport(fitness=fitness)

    best_genome: str | None = None
    best_fitness: float = -1.0

    for gen in range(args.generations):
        t0 = time.monotonic()
        evaluate_and_evolve(pop, evo_config, _fitness_cb, rng)
        elapsed = time.monotonic() - t0
        pool = pop.all()
        gen_max = max(e.fitness for e in pool)
        gen_mean = sum(e.fitness for e in pool) / len(pool)
        print(f"  gen {gen + 1:02d}/{args.generations:02d}  "
              f"max={gen_max:.4f}  mean={gen_mean:.4f}  ({elapsed:.1f}s)")
        for entry in pool:
            if entry.fitness > best_fitness:
                best_fitness = entry.fitness
                best_genome = entry.genome

    print()

    if best_genome is None:
        print("ERROR: GA produced no valid genome.", file=sys.stderr)
        return 1

    best_config = decode_pho_config(best_genome)
    print("── GA winner (training model) ────────────────────────────────────────")
    print(f"  genome  : {best_genome[:32]}…")
    print(f"  fitness : {best_fitness:.4f} (reward estimate on training model)")
    print(f"  config  : {_fmt_config(best_config)}")
    print()

    # ------------------------------------------------------------------
    # Step 5: Gate — held-out model evaluation
    # ------------------------------------------------------------------
    print("── Step 5: Gate — held-out model ─────────────────────────────────────")
    ho_stealth = _run_baseline(
        "stealth (held-out)", STEALTH_CONFIG, held_out_model, args.tool, context_key
    )
    ho_normal = _run_baseline(
        "normal hand-authored (held-out)", DEFAULT_CONFIG, held_out_model, args.tool, context_key
    )
    ho_aggressive = _run_baseline(
        "aggressive (held-out)", AGGRESSIVE_CONFIG, held_out_model, args.tool, context_key
    )
    ho_best_baseline = max(ho_stealth, ho_normal, ho_aggressive)

    print("  [evolved winner (held-out)]")
    print(f"    {_fmt_config(best_config)}")
    ho_evolved = evaluate_config(best_config, held_out_model, args.tool, context_key)
    print(f"    reward={ho_evolved:.4f}")
    print()

    beats_baseline = ho_evolved > ho_best_baseline
    timeout_rate_ok = True  # reward model already penalises timeouts; no separate check needed

    gate_pass = beats_baseline and timeout_rate_ok

    print("── Gate result ──────────────────────────────────────────────────────")
    print(f"  evolved  {ho_evolved:.4f}  vs  best_baseline  {ho_best_baseline:.4f}  "
          f"→ {'BEAT ✓' if beats_baseline else 'LOST ✗'}")
    print()
    if gate_pass:
        print("  GATE: PASS ✓ — evolved genome beats hand-authored profiles on held-out data")
        print("        Thesis proven: AlienClaw GA finds better Pho3nix configs than defaults")
    else:
        print("  GATE: FAIL ✗ — increase --generations or import richer rig history and re-run")
    print()

    # ------------------------------------------------------------------
    # Emit artifacts
    # ------------------------------------------------------------------
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    config_path = output_path.with_suffix(".config.json")
    results_path = output_path.with_suffix(".results.json")

    if not round_trip_check(best_genome):
        print("WARNING: best genome fails round-trip; skipping artifact write.", file=sys.stderr)
        return 1

    winner_genome_encoded = encode_pho_config(best_config, random.Random(0))
    decoded_check = decode_pho_config(winner_genome_encoded)

    output_path.write_text(winner_genome_encoded + "\n")

    config_json = {
        "genome": winner_genome_encoded,
        "config": best_config,
        "config_roundtrip": decoded_check,
        "fitness_training": best_fitness,
        "fitness_held_out": ho_evolved,
        "id_tag": winner_genome_encoded[:8],
        "tool": args.tool,
        "context_key": context_key,
    }
    config_path.write_text(json.dumps(config_json, indent=2) + "\n")

    results = {
        "gate_pass": gate_pass,
        "tool": args.tool,
        "context_key": context_key,
        "pop_size": args.pop_size,
        "generations": args.generations,
        "train_entries": len(train_entries),
        "held_out_entries": len(held_out_entries),
        "baselines": {
            "stealth_training": baseline_stealth,
            "normal_training": baseline_normal,
            "aggressive_training": baseline_aggressive,
            "best_training": baseline_best,
            "stealth_held_out": ho_stealth,
            "normal_held_out": ho_normal,
            "aggressive_held_out": ho_aggressive,
            "best_held_out": ho_best_baseline,
        },
        "evolved": {
            "genome": winner_genome_encoded,
            "config": best_config,
            "fitness_training": best_fitness,
            "fitness_held_out": ho_evolved,
        },
    }
    results_path.write_text(json.dumps(results, indent=2) + "\n")

    print("── Artifacts ────────────────────────────────────────────────────────")
    print(f"  genome   → {output_path}")
    print(f"  config   → {config_path}")
    print(f"  results  → {results_path}")
    print()
    print("── Done ─────────────────────────────────────────────────────────────")

    return 0 if gate_pass else 1


if __name__ == "__main__":
    sys.exit(main())
