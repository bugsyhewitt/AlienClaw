#!/usr/bin/env python3
"""Packet 25 re-run under new formula (Packet 28 validation)."""
from __future__ import annotations
import json, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from alienclaw.diagnostics.stub_servers import StubServer
from alienclaw.evolution.bridge_runner import make_bridge_runner
from alienclaw.evolution.scale_experiment import run_scale_experiment
from alienclaw.evolution.types import EvolutionConfig

POPULATION_SIZE = 100
GENERATIONS = 500
SEEDS = [42, 43, 44, 45, 46]
OUTPUT_DIR = Path(__file__).parent.parent / ".packet-reports" / "packet-28-raw" / "packet25-rerun"

FOX_TEXT = "\n".join(f"The fox was spotted on line {i}" for i in range(1, 21))
CANNED_HTTP = {"/json": (200, json.dumps({"title": "test", "value": 42}).encode(), "application/json")}

def run_all():
    config_base = EvolutionConfig("placeholder", population_size=POPULATION_SIZE)
    experiments = [
        ("compute_alone", {"input": "2 + 2"}, None),
        ("search_text_alone", {"text": FOX_TEXT, "pattern": "fox"}, None),
        ("compute_then_validate", {"input": "7 / 3"}, None),
        ("search_then_count", {"text": FOX_TEXT, "pattern": "fox"}, None),
        ("fetch_then_parse", None, CANNED_HTTP),
    ]
    for martian_type, inputs, canned in experiments:
        out_dir = OUTPUT_DIR / martian_type
        print(f"\n{'='*60}\nMartian: {martian_type}", flush=True)
        t0 = time.monotonic()
        if canned:
            with StubServer(canned) as stub_url:
                actual_inputs = {"url": stub_url + "/json", "extract_path": "title"}
                run_martian_fn = make_bridge_runner(martian_type, actual_inputs)
                run_scale_experiment(
                    martian_type=martian_type, config_base=config_base,
                    run_martian_fn=run_martian_fn, generations=GENERATIONS,
                    seeds=SEEDS, output_dir=out_dir,
                )
        else:
            run_martian_fn = make_bridge_runner(martian_type, inputs)
            run_scale_experiment(
                martian_type=martian_type, config_base=config_base,
                run_martian_fn=run_martian_fn, generations=GENERATIONS,
                seeds=SEEDS, output_dir=out_dir,
            )
        elapsed = time.monotonic() - t0
        files = list(out_dir.glob("seed_*.json"))
        print(f"  -> {martian_type}: {len(files)} files in {elapsed/60:.1f}min", flush=True)

if __name__ == "__main__":
    t_total = time.monotonic()
    run_all()
    print(f"\nAll re-runs complete in {(time.monotonic()-t_total)/60:.1f} minutes")
