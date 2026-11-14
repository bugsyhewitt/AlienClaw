#!/usr/bin/env python3
"""AlienClaw × ouija GA runner — Phase 2 PoC.

Runs AlienClaw's GA on ouija payload configs, using real external fitness:
mean system-prompt leak-ASR against a local Ollama model (loopback, no ToS exposure).

Gate: the evolved winner must beat BOTH the plain-default baseline AND the
best-known fixed baseline on a held-out Ollama seed (eval_seed + 7).

Usage:
    python ouija_tuner/run_ga.py \\
        --model qwen2.5:3b \\
        [--pop-size 12] \\
        [--generations 5] \\
        [--eval-repeats 5] \\
        [--eval-seed 0] \\
        [--output winner.genome.txt]

Setup:
    ollama serve &
    ollama pull qwen2.5:3b

Output files:
    <output>              — checksummed 256-char AlienClaw genome string
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
_NMC_OUIJA = Path.home() / "dev" / "necromancer" / "projects" / "ouija"

for _p in (_AC_SRC, _NMC_OUIJA, _HERE.parent):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

if "ALIENCLAW_POPULATIONS_ROOT" not in os.environ:
    _pop_root = Path(tempfile.mkdtemp(prefix="ouija-tuner-pops-"))
    os.environ["ALIENCLAW_POPULATIONS_ROOT"] = str(_pop_root)
    _pop_root_owned = True
else:
    _pop_root = Path(os.environ["ALIENCLAW_POPULATIONS_ROOT"])
    _pop_root_owned = False

from alienclaw.evolution.generation import evaluate_and_evolve  # noqa: E402
from alienclaw.evolution.population import Population  # noqa: E402
from alienclaw.evolution.types import EvolutionConfig  # noqa: E402
from alienclaw.genome.codec import round_trip_check  # noqa: E402

from ouija_tuner.genome_schema import (  # noqa: E402
    DEFAULT_CONFIG,
    PLAIN_BASELINE_CONFIG,
    decode_ouija_config,
    encode_ouija_config,
    CARRIERS,
    FRAMINGS,
)
from ouija_tuner.fitness_adapter import (  # noqa: E402
    _ollama_health_check,
    evaluate_config,
    make_fitness_callback,
)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="AlienClaw × ouija GA — evolve payload configs for maximum leak-ASR"
    )
    p.add_argument("--model", default="qwen2.5:3b",
                   help="Ollama model name (default: qwen2.5:3b)")
    p.add_argument("--pop-size", type=int, default=12, help="GA population size (default 12)")
    p.add_argument("--generations", type=int, default=5, help="GA generations (default 5)")
    p.add_argument("--eval-repeats", type=int, default=5,
                   help="ASR repeat count per probe seed per eval (default 5)")
    p.add_argument("--eval-seed", type=int, default=0,
                   help="Ollama seed for training evals (default 0)")
    p.add_argument("--held-out-eval-seed", type=int, default=None,
                   help="Ollama seed for held-out gate (default: eval-seed + 7)")
    p.add_argument("--ga-rng-seed", type=int, default=42,
                   help="RNG seed for the GA itself (default 42)")
    p.add_argument("--output", default="winner.genome.txt",
                   help="Output path for winner genome (default: winner.genome.txt)")
    p.add_argument("--skip-health-check", action="store_true",
                   help="Skip Ollama health check (useful when server just started)")
    return p.parse_args()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fmt_config(cfg: dict) -> str:
    return (
        f"carrier={cfg['carrier']:<10}  framing={cfg['framing']:<12}  "
        f"repeats={cfg['repeats']}  temp={cfg['temperature']:.2f}"
    )


def _run_baseline(label: str, config: dict, model: str, ollama_seed: int) -> float:
    print(f"  [{label}]")
    print(f"    {_fmt_config(config)}")
    t0 = time.monotonic()
    fitness = evaluate_config(config, model, ollama_seed)
    elapsed = time.monotonic() - t0
    print(f"    mean_leak_asr={fitness:.4f}  ({elapsed:.1f}s)")
    return fitness


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    args = _parse_args()
    held_out_seed = (
        args.held_out_eval_seed
        if args.held_out_eval_seed is not None
        else args.eval_seed + 7
    )

    print("=" * 72)
    print("AlienClaw × ouija GA  —  Phase 2 PoC")
    print("=" * 72)
    print(f"  model         : {args.model}")
    print(f"  pop_size={args.pop_size}  generations={args.generations}  "
          f"eval_repeats={args.eval_repeats}  train_seed={args.eval_seed}  "
          f"held_out_seed={held_out_seed}")
    print(f"  populations root : {_pop_root}")
    print()

    # Health check
    if not args.skip_health_check:
        print(f"  Checking Ollama... ", end="", flush=True)
        ok = _ollama_health_check(args.model)
        if not ok:
            print("FAIL")
            print(
                f"\n  ERROR: Ollama not reachable or model {args.model!r} not pulled.\n"
                f"  Run:  ollama serve &\n"
                f"        ollama pull {args.model}\n"
                f"  Then re-run this script.",
                file=sys.stderr,
            )
            return 1
        print("OK")
    print()

    # Build training config (repeats comes from CLI, not from genome, for baselines)
    training_config_base = dict(DEFAULT_CONFIG)
    training_config_base["repeats"] = args.eval_repeats
    plain_config = dict(PLAIN_BASELINE_CONFIG)
    plain_config["repeats"] = args.eval_repeats

    rng = random.Random(args.ga_rng_seed)

    # ------------------------------------------------------------------
    # 1. Baseline evaluation on training seed
    # ------------------------------------------------------------------
    print("── Baseline (training seed) ─────────────────────────────────────")
    baseline_plain = _run_baseline(
        "plain+none default", plain_config, args.model, args.eval_seed
    )
    # Best fixed single-carrier (b64 is often effective as a second baseline)
    b64_config = dict(plain_config, carrier="b64")
    baseline_b64 = _run_baseline(
        "b64+none baseline", b64_config, args.model, args.eval_seed
    )
    baseline_best = max(baseline_plain, baseline_b64)
    print(f"  Best fixed baseline: {baseline_best:.4f}")
    print()

    # ------------------------------------------------------------------
    # 2. Initialise population
    # ------------------------------------------------------------------
    print("── Initialising population ──────────────────────────────────────")

    run_ts = int(time.time())
    martian_type = f"oui{run_ts}"

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
    print(f"  Created population: martian_type={martian_type!r}")
    print(f"  Pool size: {len(pop.all())}")
    print()

    # ------------------------------------------------------------------
    # 3. GA loop — genome's repeats gene is used; eval_seed from CLI
    # ------------------------------------------------------------------
    print("── GA loop ──────────────────────────────────────────────────────")

    def _fitness_callback_with_seed(martian_type: str, genome: str):
        from alienclaw.evolution.generation import FitnessReport
        try:
            cfg = decode_ouija_config(genome)
            # Override repeats from CLI so early gens don't waste on tiny budgets
            cfg["repeats"] = max(cfg["repeats"], args.eval_repeats)
            fitness = evaluate_config(cfg, args.model, args.eval_seed)
        except Exception:
            fitness = 0.0
        return FitnessReport(fitness=fitness)

    best_genome: str | None = None
    best_fitness: float = -1.0

    for gen in range(args.generations):
        t0 = time.monotonic()
        evaluate_and_evolve(pop, evo_config, _fitness_callback_with_seed, rng)
        elapsed = time.monotonic() - t0

        current_pool = pop.all()
        gen_max  = max(e.fitness for e in current_pool)
        gen_mean = sum(e.fitness for e in current_pool) / len(current_pool)
        print(f"  gen {gen + 1:02d}/{args.generations:02d}  "
              f"max={gen_max:.4f}  mean={gen_mean:.4f}  ({elapsed:.1f}s)")

        for entry in current_pool:
            if entry.fitness > best_fitness:
                best_fitness = entry.fitness
                best_genome = entry.genome

    print()

    if best_genome is None:
        print("ERROR: GA produced no valid genome.", file=sys.stderr)
        return 1

    best_config = decode_ouija_config(best_genome)
    print("── GA winner (training seed) ─────────────────────────────────────")
    print(f"  genome  : {best_genome[:32]}…")
    print(f"  fitness : {best_fitness:.4f} (mean_leak_asr on training seed)")
    print(f"  config  : {_fmt_config(best_config)}")
    print()

    # ------------------------------------------------------------------
    # 4. Gate: held-out Ollama seed evaluation
    # ------------------------------------------------------------------
    print("── Gate: held-out seed evaluation ───────────────────────────────")
    ho_plain = _run_baseline(
        "plain+none default (held-out)", plain_config, args.model, held_out_seed
    )
    ho_b64 = _run_baseline(
        "b64+none baseline (held-out)", b64_config, args.model, held_out_seed
    )
    ho_best_baseline = max(ho_plain, ho_b64)

    print(f"  [evolved winner (held-out)]")
    print(f"    {_fmt_config(best_config)}")
    t0 = time.monotonic()
    ho_evolved = evaluate_config(best_config, args.model, held_out_seed)
    elapsed = time.monotonic() - t0
    print(f"    mean_leak_asr={ho_evolved:.4f}  ({elapsed:.1f}s)")
    print()

    beats_plain    = ho_evolved > ho_plain
    beats_best     = ho_evolved > ho_best_baseline
    gate_pass = beats_plain and beats_best

    print("── Gate result ──────────────────────────────────────────────────")
    print(f"  evolved  {ho_evolved:.4f}  vs  plain    {ho_plain:.4f}  "
          f"→ {'BEAT ✓' if beats_plain else 'LOST ✗'}")
    print(f"  evolved  {ho_evolved:.4f}  vs  best     {ho_best_baseline:.4f}  "
          f"→ {'BEAT ✓' if beats_best else 'LOST ✗'}")
    print()
    if gate_pass:
        print("  GATE: PASS ✓ — evolved genome beats both baselines on held-out seed")
        print("        Thesis proven: AlienClaw GA finds better ouija configs than defaults")
    else:
        print("  GATE: FAIL ✗ — increase --generations or --pop-size and re-run")
    print()

    # ------------------------------------------------------------------
    # 5. Emit artifacts
    # ------------------------------------------------------------------
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    config_path = output_path.with_suffix(".config.json")
    results_path = output_path.with_suffix(".results.json")

    if not round_trip_check(best_genome):
        print("WARNING: best genome fails round-trip; skipping artifact write.", file=sys.stderr)
        return 1

    winner_genome_encoded = encode_ouija_config(best_config, random.Random(0))
    decoded_check = decode_ouija_config(winner_genome_encoded)

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
        "model": args.model,
        "eval_seed": args.eval_seed,
        "held_out_seed": held_out_seed,
        "eval_repeats": args.eval_repeats,
        "pop_size": args.pop_size,
        "generations": args.generations,
        "baselines": {
            "plain_training": baseline_plain,
            "b64_training": baseline_b64,
            "best_training": baseline_best,
            "plain_held_out": ho_plain,
            "b64_held_out": ho_b64,
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

    print("── Artifacts ────────────────────────────────────────────────────")
    print(f"  genome   → {output_path}")
    print(f"  config   → {config_path}")
    print(f"  results  → {results_path}")
    print()
    print("── Done ─────────────────────────────────────────────────────────")

    return 0 if gate_pass else 1


if __name__ == "__main__":
    sys.exit(main())
