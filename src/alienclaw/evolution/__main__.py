"""CLI entry: python3 -m alienclaw.evolution

Commands:
  run-experiment  Run N generations of evolution for a Martian type.

Requires Phase 6 bridge wiring (alienclaw.evolution.bridge_runner) for
production use. Without it, the CLI fails with an informative error.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(prog="python3 -m alienclaw.evolution")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser(
        "migrate-pre-packet-16",
        help="Migrate pre-Packet-16 per-tool populations to per-Martian (<tool>_alone) layout",
    )

    scale = sub.add_parser("run-scale-experiment", help="Run scale evolution experiment (multi-seed)")
    scale.add_argument("--martian-type", required=True, help="Martian type to evolve")
    scale.add_argument("--generations", type=int, default=500, help="Number of generations")
    scale.add_argument("--population-size", type=int, default=100, help="Genome population size")
    scale.add_argument(
        "--seeds", default="42,43,44,45,46",
        help="Comma-separated RNG seeds (default: 42,43,44,45,46)",
    )
    scale.add_argument("--output-dir", type=Path, required=True, help="Output directory for per-seed JSONs")
    scale.add_argument(
        "--inputs", type=json.loads, default={},
        help="JSON inputs forwarded to the Martian (e.g. '{\"input\": \"2+2\"}')",
    )

    run = sub.add_parser("run-experiment", help="Run an evolution experiment")
    run.add_argument("--martian-type", required=True, help="Martian type to evolve")
    run.add_argument("--generations", type=int, default=20, help="Number of generations")
    run.add_argument("--population-size", type=int, default=32, help="Genome population size")
    run.add_argument("--seed", type=int, default=None, help="RNG seed for reproducibility")
    run.add_argument("--output", type=Path, default=None, help="Write JSON results to file")
    run.add_argument(
        "--inputs", type=json.loads, default={},
        help="JSON inputs forwarded to the Martian (e.g. '{\"input\": \"2+2\"}')",
    )

    args = parser.parse_args()

    if args.cmd == "run-scale-experiment":
        try:
            from alienclaw.evolution.bridge_runner import make_bridge_runner
        except ImportError as exc:
            print(f"ERROR: bridge_runner not available — {exc}", file=sys.stderr)
            return 1

        from alienclaw.evolution.scale_experiment import run_scale_experiment
        from alienclaw.evolution.types import EvolutionConfig

        seeds = [int(s.strip()) for s in args.seeds.split(",")]
        config_base = EvolutionConfig(
            martian_type=args.martian_type,
            population_size=args.population_size,
        )
        run_martian = make_bridge_runner(args.martian_type, args.inputs)

        print(f"Scale experiment: {args.martian_type}, pop={args.population_size}, "
              f"gens={args.generations}, seeds={seeds}", file=sys.stderr)
        run_scale_experiment(
            martian_type=args.martian_type,
            config_base=config_base,
            run_martian_fn=run_martian,
            generations=args.generations,
            seeds=seeds,
            output_dir=args.output_dir,
        )
        print(f"Done. Results in {args.output_dir}/", file=sys.stderr)
        return 0

    if args.cmd == "migrate-pre-packet-16":
        from alienclaw.evolution.migrations.migrate_pre_packet_16 import migrate
        renamed = migrate()
        if renamed:
            for old, new in sorted(renamed.items()):
                print(f"  Renamed: {old} -> {new}")
            print(f"Migration complete: {len(renamed)} directories renamed.")
        else:
            print("Nothing to migrate (no pre-16 population directories found).")
        return 0

    if args.cmd == "run-experiment":
        try:
            from alienclaw.evolution.bridge_runner import make_bridge_runner
        except ImportError as exc:
            print(f"ERROR: bridge_runner not available — {exc}", file=sys.stderr)
            print("Ensure Phase 6 bridge wiring is complete.", file=sys.stderr)
            return 1

        from alienclaw.evolution.experiment import run_experiment
        from alienclaw.evolution.types import EvolutionConfig

        config = EvolutionConfig(
            martian_type=args.martian_type,
            population_size=args.population_size,
            seed=args.seed,
        )

        run_martian = make_bridge_runner(args.martian_type, args.inputs)
        results: list[dict] = []

        def on_gen(i: int, result: dict) -> None:
            s = result["stats"]
            row = {
                "generation": result["generation"],
                "next_generation": result["next_generation"],
                "mean_fitness": round(s.mean_fitness, 4),
                "max_fitness": round(s.max_fitness, 4),
                "min_fitness": round(s.min_fitness, 4),
                "stddev_fitness": round(s.stddev_fitness, 4),
                "distinct_genomes": s.distinct_genomes,
                "children_minted": result["children_minted"],
            }
            results.append(row)
            print(json.dumps(row))

        pop, _ = run_experiment(
            config=config,
            run_martian=run_martian,
            generations=args.generations,
            on_generation=on_gen,
        )
        snap = pop.snapshot()
        print(f"\nFinal: generation={snap['generation']}, "
              f"top_fitness={snap['top_fitness']:.4f}, "
              f"mean_fitness={snap['mean_fitness']:.4f}", file=sys.stderr)

        if args.output:
            args.output.write_text(json.dumps(results, indent=2))
            print(f"Results written to {args.output}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
