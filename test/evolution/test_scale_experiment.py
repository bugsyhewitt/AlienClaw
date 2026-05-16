"""Tests for scale_experiment.py (pilot-scale: small pop, few gens)."""
from __future__ import annotations

import json
import os
from pathlib import Path

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
