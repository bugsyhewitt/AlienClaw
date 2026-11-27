"""A tiny real GA run (2 generations) on the synthetic sufficient history.

Everything it writes lands in tmp_path: the artifacts (--output), the engine's
population store (ALIENCLAW_POPULATIONS_ROOT), and HOME.
"""
from __future__ import annotations

import json
import random
import subprocess
import sys

from alienclaw_ga.evolution.generation import FitnessReport, evaluate_and_evolve
from alienclaw_ga.evolution.population import Population
from alienclaw_ga.evolution.types import EvolutionConfig
from alienclaw_ga.genome.codec import round_trip_check

from _synth import HISTORIES, write
from conftest import SRC
from pho3nix_tuner.fitness_adapter import make_fitness_callback
from pho3nix_tuner.genome_schema import PHO_ID_TAG, decode_pho_config

RUN_GA = SRC / "pho3nix_tuner" / "run_ga.py"


def _src_tree() -> set[str]:
    return {str(p.relative_to(SRC)) for p in SRC.rglob("*") if "__pycache__" not in p.parts}


def test_run_ga_two_generations_writes_only_to_tmp(tmp_path, sub_env) -> None:
    hist = write(tmp_path / "sufficient.json", HISTORIES["sufficient"]())
    out_path = tmp_path / "out" / "winner.genome.txt"
    src_before = _src_tree()
    proc = subprocess.run(
        [sys.executable, str(RUN_GA), "--history", str(hist), "--tool", "gobuster",
         "--pop-size", "6", "--generations", "2", "--output", str(out_path)],
        capture_output=True, text=True, cwd=tmp_path, env=sub_env, timeout=300,
    )
    log = proc.stdout + proc.stderr
    assert "gen 01/02" in proc.stdout and "gen 02/02" in proc.stdout, log

    # Artifacts
    genome = out_path.read_text().strip()
    config_doc = json.loads(out_path.with_suffix(".config.json").read_text())
    results = json.loads(out_path.with_suffix(".results.json").read_text())
    assert len(genome) == 256 and round_trip_check(genome)
    assert genome[:8] == PHO_ID_TAG == config_doc["id_tag"]
    assert config_doc["genome"] == genome
    assert decode_pho_config(genome) == config_doc["config"] == config_doc["config_roundtrip"]
    assert results["generations"] == 2 and results["pop_size"] == 6
    assert results["train_entries"] == 36 and results["held_out_entries"] == 12
    assert 0.0 <= results["evolved"]["fitness_training"] <= 1.0

    # Exit code mirrors the held-out gate. The synthetic data makes every baseline
    # lose (each sits on a failing signature) while mid-range delays win, so with the
    # fixed --ga-rng-seed the evolved winner beats them.
    assert proc.returncode == (0 if results["gate_pass"] else 1), log
    assert results["gate_pass"] is True, log
    assert results["baselines"]["best_held_out"] == 0.0
    assert results["evolved"]["fitness_held_out"] > 0.0

    # Writes stayed in tmp_path: population store under the tmp root, nothing new in src/.
    pops = list((tmp_path / "populations").iterdir())
    assert len(pops) == 1 and pops[0].name.startswith("pho")
    assert not (tmp_path / "pho3nix_tuner").exists()  # default --output was not used
    assert _src_tree() == src_before


def test_in_process_ga_with_fitness_callback(tmp_path) -> None:
    hist = write(tmp_path / "sufficient.json", HISTORIES["sufficient"]())
    callback = make_fitness_callback(hist, "gobuster", "gobuster|https")
    config = EvolutionConfig(
        martian_type="photest", population_size=6, tournament_k=3,
        mutation_rate=1.0 / 256.0, crossover_rate=0.5, elitism_count=2, seed=11,
        selection_strategy="tournament",
    )
    pop = Population.create(config)
    rng = random.Random(11)
    results = [evaluate_and_evolve(pop, config, callback, rng) for _ in range(2)]
    assert [r["generation"] for r in results] == [0, 1]
    for r in results:
        assert 0.0 <= r["stats"].min_fitness <= r["stats"].max_fitness <= 1.0
    assert all(round_trip_check(e.genome) for e in pop.all())
    assert (tmp_path / "populations" / "photest").is_dir()


def test_fitness_callback_is_zero_when_gate_stops(tmp_path) -> None:
    hist = write(tmp_path / "bad.json", HISTORIES["single_signature"]())
    callback = make_fitness_callback(hist, "gobuster", "gobuster|https")
    genome = Population.create(EvolutionConfig(
        martian_type="photest", population_size=2, tournament_k=2, mutation_rate=0.01,
        crossover_rate=0.5, elitism_count=1, seed=1, selection_strategy="tournament",
    )).all()[0].genome
    report = callback("photest", genome)
    assert isinstance(report, FitnessReport) and report.fitness == 0.0


def test_fitness_callback_rejects_unknown_tool(tmp_path) -> None:
    import pytest

    hist = write(tmp_path / "sufficient.json", HISTORIES["sufficient"]())
    with pytest.raises(ValueError, match="target_tool"):
        make_fitness_callback(hist, "nuclei", "nuclei|https")


def test_fitness_callback_swallows_bad_genomes(tmp_path) -> None:
    hist = write(tmp_path / "sufficient.json", HISTORIES["sufficient"]())
    callback = make_fitness_callback(hist, "gobuster", "gobuster|https")
    assert callback("photest", "too-short").fitness == 0.0
