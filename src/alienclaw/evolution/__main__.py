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
