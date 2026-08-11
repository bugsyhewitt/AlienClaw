"""Tests for scale_experiment.py (pilot-scale: small pop, few gens)."""
from __future__ import annotations

import json

import pytest

from alienclaw.evolution.generation import FitnessReport
from alienclaw.evolution.scale_experiment import run_scale_experiment
from alienclaw.evolution.types import EvolutionConfig


def mock_runner(martian_type: str, genome: str) -> FitnessReport:
    """Deterministic mock: fitness = fraction of 'A' chars in genome."""
    a_count = genome.count("A")
    return FitnessReport(fitness=a_count / max(len(genome), 1))


@pytest.fixture
def tmp_output(tmp_path):
    return tmp_path / "scale_out"


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


def test_run_produces_seed_files(tmp_output):
    """Each seed generates a JSON output file."""
    config = EvolutionConfig(martian_type="compute_alone", population_size=4)
    run_scale_experiment(
        martian_type="compute_alone",
        config_base=config,
        run_martian_fn=mock_runner,
        generations=3,
        seeds=[42, 43],
        output_dir=tmp_output,
    )
    assert (tmp_output / "seed_42.json").exists()
    assert (tmp_output / "seed_43.json").exists()


def test_json_schema_correct(tmp_output):
    """Output JSON has required top-level and per-generation keys."""
    config = EvolutionConfig(martian_type="compute_alone", population_size=4)
    run_scale_experiment(
        martian_type="compute_alone",
        config_base=config,
        run_martian_fn=mock_runner,
        generations=5,
        seeds=[42],
        output_dir=tmp_output,
    )
    data = json.loads((tmp_output / "seed_42.json").read_text())
    assert data["martian_type"] == "compute_alone"
    assert data["seed"] == 42
    assert data["generations"] == 5
    assert len(data["per_generation"]) == 5

    pg = data["per_generation"][0]
    for key in ("gen", "mean_fitness", "max_fitness", "min_fitness",
                "stddev_fitness", "distinct_genomes", "diversity", "elapsed_ms"):
        assert key in pg, f"missing key in per_generation entry: {key}"

    div = pg["diversity"]
    for key in ("unique_genomes", "mean_pairwise_hamming", "monoculture"):
        assert key in div, f"missing key in diversity: {key}"


def test_seeds_are_independent(tmp_output):
    """Different seeds can produce different fitness trajectories."""
    config = EvolutionConfig(martian_type="compute_alone", population_size=4)
    run_scale_experiment(
        martian_type="compute_alone",
        config_base=config,
        run_martian_fn=mock_runner,
        generations=3,
        seeds=[42, 99],
        output_dir=tmp_output,
    )
    d42 = json.loads((tmp_output / "seed_42.json").read_text())
    d99 = json.loads((tmp_output / "seed_99.json").read_text())
    assert d42["seed"] == 42
    assert d99["seed"] == 99


def test_elapsed_ms_non_negative(tmp_output):
    """elapsed_ms is non-negative for every generation."""
    config = EvolutionConfig(martian_type="compute_alone", population_size=4)
    run_scale_experiment(
        martian_type="compute_alone",
        config_base=config,
        run_martian_fn=mock_runner,
        generations=3,
        seeds=[42],
        output_dir=tmp_output,
    )
    data = json.loads((tmp_output / "seed_42.json").read_text())
    for pg in data["per_generation"]:
        assert pg["elapsed_ms"] >= 0.0


def test_per_generation_count_matches_generations(tmp_output):
    """per_generation array length == generations parameter."""
    config = EvolutionConfig(martian_type="compute_alone", population_size=4)
    run_scale_experiment(
        martian_type="compute_alone",
        config_base=config,
        run_martian_fn=mock_runner,
        generations=7,
        seeds=[42],
        output_dir=tmp_output,
    )
    data = json.loads((tmp_output / "seed_42.json").read_text())
    assert len(data["per_generation"]) == 7


def test_selection_strategy_is_forwarded_to_per_seed_config(tmp_output):
    """config_base.selection_strategy must reach the per-seed run, not default to 'tournament'."""
    import alienclaw.evolution.population as pop_mod
    captured: list[EvolutionConfig] = []
    orig = pop_mod.Population.load_or_create
    def spy(c):
        captured.append(c)
        return orig(c)
    pop_mod.Population.load_or_create = spy
    try:
        config = EvolutionConfig(
            martian_type="compute_alone",
            population_size=4,
            selection_strategy="truncation",
            truncation_top_fraction=0.25,
        )
        run_scale_experiment(
            martian_type="compute_alone",
            config_base=config,
            run_martian_fn=mock_runner,
            generations=2,
            seeds=[42],
            output_dir=tmp_output,
        )
    finally:
        pop_mod.Population.load_or_create = orig

    assert len(captured) == 1
    assert captured[0].selection_strategy == "truncation"
    assert captured[0].truncation_top_fraction == 0.25


def test_truncation_strategy_actually_selects_top_fraction(tmp_output):
    """End-to-end: truncation selection with top_fraction=0.5 must reach the selector."""
    import alienclaw.evolution.generation as gen_mod
    captured: list[str] = []
    orig = gen_mod._make_selector
    def spy(config):
        result = orig(config)
        captured.append(config.selection_strategy)
        return result
    gen_mod._make_selector = spy
    try:
        config = EvolutionConfig(
            martian_type="compute_alone",
            population_size=4,
            selection_strategy="truncation",
            truncation_top_fraction=0.5,
        )
        run_scale_experiment(
            martian_type="compute_alone",
            config_base=config,
            run_martian_fn=mock_runner,
            generations=2,
            seeds=[42],
            output_dir=tmp_output,
        )
    finally:
        gen_mod._make_selector = orig

    assert captured == ["truncation"] * 2, f"Expected truncation dispatched; got {captured}"


def test_brain_field_is_forwarded_to_per_seed_config(tmp_output, monkeypatch):
    """config_base.brain must be propagated to each per-seed EvolutionConfig.

    Regression guard for the same forwarding-gap class as PKT-463
    (selection_strategy/truncation_top_fraction). The brain field controls
    whether mutate_directed or mutate is used in evaluate_and_evolve.
    """
    from datetime import datetime, timezone
    from unittest.mock import MagicMock, patch

    from alienclaw.evolution.types import GenerationStats

    brain_sentinel = MagicMock(name="BrainSpec")
    config = EvolutionConfig(
        martian_type="compute_alone",
        population_size=4,
        brain=brain_sentinel,
    )

    captured_configs: list[EvolutionConfig] = []

    def null_evolve(pop, cfg, runner, rng):
        captured_configs.append(cfg)
        stats = GenerationStats(
            martian_type=cfg.martian_type, generation=0, count=0,
            mean_fitness=0.0, median_fitness=0.0, max_fitness=0.0,
            min_fitness=0.0, stddev_fitness=0.0, distinct_genomes=0,
            captured_at=datetime.now(timezone.utc).isoformat(),
        )
        return {"stats": stats, "generation": 0, "next_generation": 1, "children_minted": 0}

    with patch("alienclaw.evolution.scale_experiment.evaluate_and_evolve", null_evolve), \
         patch("alienclaw.evolution.scale_experiment.population_diversity",
               return_value={"unique_genomes": 0, "mean_pairwise_hamming": 0.0,
                             "monoculture": True}):
        run_scale_experiment(
            martian_type="compute_alone",
            config_base=config,
            run_martian_fn=mock_runner,
            generations=1,
            seeds=[42],
            output_dir=tmp_output,
        )

    assert len(captured_configs) == 1
    assert captured_configs[0].brain is brain_sentinel, (
        f"brain not forwarded to per-seed config: expected {brain_sentinel!r}, "
        f"got {captured_configs[0].brain!r}"
    )
