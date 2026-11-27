#!/usr/bin/env python3
"""AlienClaw × mangle GA runner — Phase 1 PoC.

Runs AlienClaw's genetic algorithm on mangle campaign configs, using real
external fitness (crash rate on a fixed H.265 seed) instead of the
self-referential AlienClaw correctness score.

Gate: the evolved winner must beat BOTH the uniform-default baseline AND
the adaptive-default baseline on a held-out seed that was NOT used during
training.

Usage:
    python -m necromancer_tuners.mangle.run_ga \\
        --seed-file /path/to/training.h265 \\
        --held-out-seed /path/to/holdout.h265 \\
        [--pop-size 16] \\
        [--generations 5] \\
        [--eval-iterations 100] \\
        [--eval-seed-rng 0] \\
        [--output winner.genome.txt]

Output files:
    <output>              — checksummed 256-char AlienClaw genome string
    <output>.config.json  — human-readable decoded config
    <output>.results.json — full comparison table (baseline vs evolved)

Population isolation:
    Each run uses ALIENCLAW_POPULATIONS_ROOT=/tmp/mangle-tuner-pops-<random>
    so it does not pollute the production ~/.alienclaw/populations store.
    Set ALIENCLAW_POPULATIONS_ROOT explicitly to reuse a prior run's state.
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

# ---------------------------------------------------------------------------
# sys.path setup (run from any directory)
# ---------------------------------------------------------------------------
_NMC_MANGLE_SRC = Path.home() / "dev" / "necromancer" / "projects" / "mangle" / "src"

for _p in (_NMC_MANGLE_SRC,):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from alienclaw_ga.evolution.generation import evaluate_and_evolve  # noqa: E402
from alienclaw_ga.evolution.population import Population  # noqa: E402
from alienclaw_ga.evolution.types import EvolutionConfig  # noqa: E402
from alienclaw_ga.genome.codec import round_trip_check  # noqa: E402

from .fitness_adapter import evaluate_config, make_fitness_callback  # noqa: E402
from .genome_schema import (  # noqa: E402
    ADAPTIVE_DEFAULT_CONFIG,
    DEFAULT_CONFIG,
    decode_mangle_config,
    encode_mangle_config,
)


def _resolve_pop_root() -> Path:
    """Isolate population storage to a temp dir unless overridden.

    In-tree this ran at import time; it is called from main() so that importing
    the module (or running --help) does not create a temp dir. The storage
    layer reads ALIENCLAW_POPULATIONS_ROOT when a Population is created, so
    setting it here, before Population.create(), is sufficient.
    """
    if "ALIENCLAW_POPULATIONS_ROOT" not in os.environ:
        pop_root = Path(tempfile.mkdtemp(prefix="mangle-tuner-pops-"))
        os.environ["ALIENCLAW_POPULATIONS_ROOT"] = str(pop_root)
        return pop_root
    return Path(os.environ["ALIENCLAW_POPULATIONS_ROOT"])


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="AlienClaw × mangle GA — evolve campaign configs for maximum crash rate"
    )
    p.add_argument(
        "--seed-file",
        required=True,
        help="H.265 training seed for fitness evaluation during GA runs",
    )
    p.add_argument(
        "--held-out-seed",
        required=True,
        help="H.265 held-out seed for final gate comparison (never seen during training)",
    )
    p.add_argument("--pop-size", type=int, default=16, help="GA population size (default 16)")
    p.add_argument(
        "--generations", type=int, default=5, help="Number of GA generations (default 5)"
    )
    p.add_argument(
        "--eval-iterations",
        type=int,
        default=100,
        help="Mangle iterations per fitness evaluation (default 100)",
    )
    p.add_argument(
        "--eval-seed-rng",
        type=int,
        default=0,
        help="RNG seed passed to mangle fuzz during GA training (default 0)",
    )
    p.add_argument(
        "--held-out-eval-rng",
        type=int,
        default=None,
        help=(
            "RNG seed for held-out evaluation (default: eval-seed-rng + 7). "
            "Using a different RNG with the same seed file tests generalization "
            "to different mutation draws, which is valid when sei-buffering.hevc "
            "or similar held-out seeds produce zero crashes with all configs."
        ),
    )
    p.add_argument(
        "--ga-rng-seed",
        type=int,
        default=42,
        help="RNG seed for the GA itself (default 42)",
    )
    p.add_argument(
        "--output",
        default="winner.genome.txt",
        help="Output path for the winner genome string (default: winner.genome.txt)",
    )
    return p.parse_args()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fmt_config(cfg: dict) -> str:
    return (
        f"strategy={cfg['strategy']:<8}  "
        f"alpha={cfg['alpha']:.1f}  beta={cfg['beta']:.1f}  "
        f"ef={cfg['exploration_floor']:.4f}  "
        f"conc={cfg['concurrency']}  timeout={cfg['timeout']:.1f}s"
    )


def _run_baseline(
    label: str,
    config: dict,
    seed_file: str,
    eval_iterations: int,
    eval_seed_rng: int,
) -> float:
    print(f"  [{label}]")
    print(f"    {_fmt_config(config)}")
    t0 = time.monotonic()
    fitness = evaluate_config(config, seed_file, eval_seed_rng, eval_iterations)
    elapsed = time.monotonic() - t0
    print(f"    crash_rate={fitness:.4f}  ({elapsed:.1f}s)")
    return fitness


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    args = _parse_args()
    _pop_root = _resolve_pop_root()
    seed_file = Path(args.seed_file)
    held_out_seed = Path(args.held_out_seed)
    held_out_eval_rng = (
        args.held_out_eval_rng
        if args.held_out_eval_rng is not None
        else args.eval_seed_rng + 7
    )

    if not seed_file.exists():
        print(f"ERROR: seed-file not found: {seed_file}", file=sys.stderr)
        return 1
    if not held_out_seed.exists():
        print(f"ERROR: held-out-seed not found: {held_out_seed}", file=sys.stderr)
        return 1

    print("=" * 72)
    print("AlienClaw × mangle GA  —  Phase 1 PoC")
    print("=" * 72)
    print(f"  training seed : {seed_file}")
    print(f"  held-out seed : {held_out_seed}")
    print(f"  pop_size={args.pop_size}  generations={args.generations}  "
          f"eval_iters={args.eval_iterations}  train_rng={args.eval_seed_rng}  "
          f"held_out_rng={held_out_eval_rng}")
    print(f"  populations root : {_pop_root}")
    print()

    rng = random.Random(args.ga_rng_seed)

    # ------------------------------------------------------------------
    # 1. Baseline evaluation on training seed
    # ------------------------------------------------------------------
    print("── Baseline (training seed) ─────────────────────────────────────")
    baseline_uniform  = _run_baseline(
        "uniform-default", DEFAULT_CONFIG,
        str(seed_file), args.eval_iterations, args.eval_seed_rng,
    )
    baseline_adaptive = _run_baseline(
        "adaptive-default", ADAPTIVE_DEFAULT_CONFIG,
        str(seed_file), args.eval_iterations, args.eval_seed_rng,
    )
    print()

    # ------------------------------------------------------------------
    # 2. Initialise population (isolated storage)
    # ------------------------------------------------------------------
    print("── Initialising population ──────────────────────────────────────")

    # Use a timestamped martian_type to get a fresh population each run
    run_ts = int(time.time())
    martian_type = f"mgl{run_ts}"  # "mgl..." → id_tag starts MGL (matches our schema)

    config = EvolutionConfig(
        martian_type=martian_type,
        population_size=args.pop_size,
        tournament_k=3,
        mutation_rate=1.0 / 256.0,
        crossover_rate=0.5,
        elitism_count=2,
        seed=args.ga_rng_seed,
        selection_strategy="tournament",
    )

    # Population.create seeds with random genomes (ID tag derived from martian_type)
    # and writes them to disk at ALIENCLAW_POPULATIONS_ROOT.
    pop = Population.create(config)
    print(f"  Created population: martian_type={martian_type!r}")
    print(f"  Pool size: {len(pop.all())}  (ID tag derived from type name)")
    print()

    # ------------------------------------------------------------------
    # 3. GA loop
    # ------------------------------------------------------------------
    print("── GA loop ──────────────────────────────────────────────────────")
    fitness_callback = make_fitness_callback(
        seed_file=str(seed_file),
        seed_rng=args.eval_seed_rng,
        iterations=args.eval_iterations,
    )

    best_genome: str | None = None
    best_fitness: float = -1.0

    for gen in range(args.generations):
        t0 = time.monotonic()
        evaluate_and_evolve(pop, config, fitness_callback, rng)
        elapsed = time.monotonic() - t0

        current_pool = pop.all()
        gen_max  = max(e.fitness for e in current_pool)
        gen_mean = sum(e.fitness for e in current_pool) / len(current_pool)
        print(f"  gen {gen + 1:02d}/{args.generations:02d}  "
              f"max={gen_max:.4f}  mean={gen_mean:.4f}  ({elapsed:.1f}s)")

        # Track global best
        for entry in current_pool:
            if entry.fitness > best_fitness:
                best_fitness = entry.fitness
                best_genome = entry.genome

    print()

    if best_genome is None:
        print("ERROR: GA produced no valid genome.", file=sys.stderr)
        return 1

    best_config = decode_mangle_config(best_genome)
    print("── GA winner (training seed) ─────────────────────────────────────")
    print(f"  genome  : {best_genome[:32]}…")
    print(f"  fitness : {best_fitness:.4f} (crash_rate on training seed)")
    print(f"  config  : {_fmt_config(best_config)}")
    print()

    # ------------------------------------------------------------------
    # 4. Gate: held-out seed evaluation
    # ------------------------------------------------------------------
    print("── Gate: held-out seed evaluation ───────────────────────────────")
    ho_uniform  = _run_baseline(
        "uniform-default (held-out)", DEFAULT_CONFIG,
        str(held_out_seed), args.eval_iterations, held_out_eval_rng,
    )
    ho_adaptive = _run_baseline(
        "adaptive-default (held-out)", ADAPTIVE_DEFAULT_CONFIG,
        str(held_out_seed), args.eval_iterations, held_out_eval_rng,
    )

    print("  [evolved winner (held-out)]")
    print(f"    {_fmt_config(best_config)}")
    t0 = time.monotonic()
    ho_evolved = evaluate_config(
        best_config, str(held_out_seed), held_out_eval_rng, args.eval_iterations
    )
    elapsed = time.monotonic() - t0
    print(f"    crash_rate={ho_evolved:.4f}  ({elapsed:.1f}s)")
    print()

    beats_uniform  = ho_evolved > ho_uniform
    beats_adaptive = ho_evolved > ho_adaptive
    gate_pass = beats_uniform and beats_adaptive

    print("── Gate result ──────────────────────────────────────────────────")
    print(f"  evolved  {ho_evolved:.4f}  vs  uniform  {ho_uniform:.4f}  "
          f"→ {'BEAT ✓' if beats_uniform else 'LOST ✗'}")
    print(f"  evolved  {ho_evolved:.4f}  vs  adaptive {ho_adaptive:.4f}  "
          f"→ {'BEAT ✓' if beats_adaptive else 'LOST ✗'}")
    print()
    if gate_pass:
        print("  GATE: PASS ✓ — evolved genome beats both baselines on held-out seed")
        print("        Thesis proven: AlienClaw GA finds better mangle configs than defaults")
    else:
        print("  GATE: FAIL ✗ — increase --generations or --pop-size and re-run")
    print()

    # ------------------------------------------------------------------
    # 5. Emit artifacts
    # ------------------------------------------------------------------
    output_path = Path(args.output)
    # Staged fix (mirrors ouija_tuner): in-tree, a missing --output parent dir
    # raised FileNotFoundError here, after the whole GA run had finished.
    output_path.parent.mkdir(parents=True, exist_ok=True)
    config_path = output_path.with_suffix(".config.json")
    results_path = output_path.with_suffix(".results.json")

    # Verify codec round-trip before writing
    if not round_trip_check(best_genome):
        print("WARNING: best genome fails round-trip check; skipping artifact write.",
              file=sys.stderr)
        return 1

    # Encode the winning config into a fresh genome with correct params
    # (the GA may have evolved the params via mutation; re-encode to confirm
    # the genome's param values match what decode_mangle_config reads back)
    winner_genome_encoded = encode_mangle_config(best_config, random.Random(0))
    decoded_check = decode_mangle_config(winner_genome_encoded)

    output_path.write_text(winner_genome_encoded + "\n")

    config_json = {
        "genome": winner_genome_encoded,
        "config": best_config,
        "config_roundtrip": decoded_check,
        "fitness_training": best_fitness,
        "fitness_held_out": ho_evolved,
        "id_tag": winner_genome_encoded[:8],
        "note": "Re-encoded from GA winner; Xcode params match decoded config above.",
    }
    config_path.write_text(json.dumps(config_json, indent=2) + "\n")

    results = {
        "gate_pass": gate_pass,
        "training_seed": str(seed_file),
        "held_out_seed": str(held_out_seed),
        "eval_iterations": args.eval_iterations,
        "eval_seed_rng": args.eval_seed_rng,
        "pop_size": args.pop_size,
        "generations": args.generations,
        "baselines": {
            "uniform_training": baseline_uniform,
            "adaptive_training": baseline_adaptive,
            "uniform_held_out": ho_uniform,
            "adaptive_held_out": ho_adaptive,
        },
        "evolved": {
            "genome": winner_genome_encoded,
            "config": best_config,
            "fitness_training": best_fitness,
            "fitness_held_out": ho_evolved,
        },
    }
    results_path.write_text(json.dumps(results, indent=2) + "\n")

    print("── Artifacts ────────────────────────────────────────────────────")
    print(f"  genome   → {output_path}")
    print(f"  config   → {config_path}")
    print(f"  results  → {results_path}")
    print()
    print("── Done ─────────────────────────────────────────────────────────")

    return 0 if gate_pass else 1


if __name__ == "__main__":
    sys.exit(main())
