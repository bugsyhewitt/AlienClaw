#!/usr/bin/env python3
"""Run all Packet 25 scale experiments.

5 Martians × 5 seeds × 500 generations × population 100.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from alienclaw.diagnostics.stub_servers import StubServer
from alienclaw.evolution.bridge_runner import make_bridge_runner
from alienclaw.evolution.scale_experiment import run_scale_experiment
from alienclaw.evolution.types import EvolutionConfig

POPULATION_SIZE = 100
GENERATIONS = 500
SEEDS = [42, 43, 44, 45, 46]
OUTPUT_DIR = Path(__file__).parent.parent / ".packet-reports" / "packet-25-raw"

FOX_TEXT = "\n".join(f"The fox was spotted on line {i}" for i in range(1, 21))
CANNED_HTTP = {
    "/json": (200, json.dumps({"title": "test", "value": 42}).encode(), "application/json"),
}


def run_all() -> None:
    config_base = EvolutionConfig(
        martian_type="placeholder",
        population_size=POPULATION_SIZE,
    )

    experiments = [
        ("compute_alone",        {"input": "2 + 2"},    None),
        ("search_text_alone",    {"text": FOX_TEXT, "pattern": "fox"}, None),
        ("compute_then_validate",{"input": "7 / 3"},    None),
        ("search_then_count",    {"text": FOX_TEXT, "pattern": "fox"}, None),
        ("fetch_then_parse",     None,                   CANNED_HTTP),  # needs StubServer
    ]

    for martian_type, inputs, canned in experiments:
        out_dir = OUTPUT_DIR / martian_type
        print(f"\n{'='*60}", flush=True)
        print(f"Martian: {martian_type}", flush=True)
        print(f"Inputs: {inputs}", flush=True)
        print(f"Output: {out_dir}", flush=True)
        t0 = time.monotonic()

        if canned is not None:
            # HTTP-dependent: run inside StubServer context
            with StubServer(canned) as stub_url:
                actual_inputs = {"url": stub_url + "/json", "extract_path": "title"}
                run_martian_fn = make_bridge_runner(martian_type, actual_inputs)
                run_scale_experiment(
                    martian_type=martian_type,
                    config_base=config_base,
                    run_martian_fn=run_martian_fn,
                    generations=GENERATIONS,
                    seeds=SEEDS,
                    output_dir=out_dir,
                )
        else:
            run_martian_fn = make_bridge_runner(martian_type, inputs)
            run_scale_experiment(
                martian_type=martian_type,
                config_base=config_base,
                run_martian_fn=run_martian_fn,
                generations=GENERATIONS,
                seeds=SEEDS,
                output_dir=out_dir,
            )

        elapsed = time.monotonic() - t0
        print(f"  -> {martian_type} complete in {elapsed:.1f}s", flush=True)
        files = list(out_dir.glob("seed_*.json"))
        print(f"  -> {len(files)} seed files produced", flush=True)


if __name__ == "__main__":
    t_total = time.monotonic()
    run_all()
    print(f"\nAll experiments complete in {(time.monotonic()-t_total)/60:.1f} minutes", flush=True)
