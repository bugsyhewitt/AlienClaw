"""Threshold-triggered live evolution step.

When a martian_type accumulates LIVE_EVO_THRESHOLD new online fitness
observations since the last evolution run, execute one generational step
using the bridge as the run_martian callback.

Watermark storage: ~/.alienclaw/live_evo_watermarks.json maps
martian_type → count of observations seen at last evolution.
"""
from __future__ import annotations

import json
import random
from pathlib import Path

LIVE_EVO_THRESHOLD = 10

_DEFAULT_WATERMARK_PATH = Path.home() / ".alienclaw" / "live_evo_watermarks.json"


def _read_watermark(martian_type: str, watermark_path: Path) -> int:
    if not watermark_path.exists():
        return 0
    data: dict = json.loads(watermark_path.read_text(encoding="utf-8"))
    return int(data.get(martian_type, 0))


def _write_watermark(martian_type: str, count: int, watermark_path: Path) -> None:
    data: dict = {}
    if watermark_path.exists():
        data = json.loads(watermark_path.read_text(encoding="utf-8"))
    data[martian_type] = count
    watermark_path.parent.mkdir(parents=True, exist_ok=True)
    watermark_path.write_text(json.dumps(data), encoding="utf-8")


def check_and_evolve(
    martian_type: str,
    threshold: int = LIVE_EVO_THRESHOLD,
    *,
    log_path: str | Path | None = None,
    watermark_path: str | Path | None = None,
) -> dict | None:
    """Check if enough new observations exist; evolve the population if so.

    Returns a result dict on evolution, None if below threshold.
    """
    from alienclaw.evolution.bridge_runner import bridge_run_martian
    from alienclaw.evolution.generation import evaluate_and_evolve
    from alienclaw.evolution.online_fitness import OnlineFitnessLog
    from alienclaw.evolution.population import Population
    from alienclaw.evolution.types import EvolutionConfig

    _wpath = Path(watermark_path) if watermark_path is not None else _DEFAULT_WATERMARK_PATH
    log = OnlineFitnessLog(path=log_path)
    all_entries = [e for e in log.read() if e["martian_type"] == martian_type]
    total = len(all_entries)
    watermark = _read_watermark(martian_type, _wpath)
    new_count = max(0, total - watermark)

    if new_count < threshold:
        return None

    config = EvolutionConfig(martian_type=martian_type)
    pop = Population.load_or_create(config)
    rng = random.Random()

    result = evaluate_and_evolve(pop, config, bridge_run_martian, rng)
    _write_watermark(martian_type, total, _wpath)

    return {
        "generation": result["generation"],
        "next_generation": result["next_generation"],
        "children_minted": result["children_minted"],
        "new_observations": new_count,
    }
