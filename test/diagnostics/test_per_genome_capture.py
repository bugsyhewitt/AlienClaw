"""Direct unit tests for alienclaw/diagnostics/per_genome_capture.py.

capture_per_genome() runs evolution and records every (genome, fitness, gen)
evaluated; run_per_genome_capture() repeats that across seeds with isolated
population roots and tags each record with its seed.

Tests use a deterministic hash-based mock RunMartianCallback (fitness is a
pure function of the genome string) so every assertion is reproducible.
"""
from __future__ import annotations

import hashlib
import os

import pytest

from alienclaw.diagnostics.per_genome_capture import capture_per_genome, run_per_genome_capture
from alienclaw.evolution.generation import FitnessReport
from alienclaw.evolution.population import Population
from alienclaw.evolution.types import EvolutionConfig
from alienclaw.genome.validation import validate

ENV_KEY = "ALIENCLAW_POPULATIONS_ROOT"


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    monkeypatch.setenv(ENV_KEY, str(tmp_path / "populations"))
    yield


def _hash_fitness(genome: str) -> float:
    """Deterministic fitness in [0, 1] derived purely from the genome string."""
    digest = hashlib.sha256(genome.encode("ascii")).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


def _make_counting_runner():
    calls: list[str] = []

    def run(martian_type: str, genome: str) -> FitnessReport:
        calls.append(genome)
        return FitnessReport(fitness=_hash_fitness(genome), run_metadata={"tool_calls": 1})

    return run, calls


def _config(population_size: int = 4, seed: int = 11) -> EvolutionConfig:
    return EvolutionConfig(martian_type="compute", population_size=population_size, seed=seed)


class TestCapturePerGenome:
    def test_record_count_is_population_size_times_generations(self):
        run, _ = _make_counting_runner()
        records = capture_per_genome("compute", run, _config(4, 11), generations=3)
        assert len(records) == 4 * 3

    def test_record_fields(self):
        run, _ = _make_counting_runner()
        records = capture_per_genome("compute", run, _config(4, 11), generations=1)
        for rec in records:
            assert set(rec.keys()) == {"genome", "fitness", "gen"}
            assert isinstance(rec["genome"], str)
            assert isinstance(rec["fitness"], float)
            assert isinstance(rec["gen"], int)

    def test_gen_indices_are_sequential_blocks(self):
        run, _ = _make_counting_runner()
        records = capture_per_genome("compute", run, _config(4, 11), generations=2)
        assert [r["gen"] for r in records] == [0, 0, 0, 0, 1, 1, 1, 1]

    def test_fitness_matches_runner_output_for_each_genome(self):
        run, _ = _make_counting_runner()
        records = capture_per_genome("compute", run, _config(4, 11), generations=2)
        for rec in records:
            assert rec["fitness"] == pytest.approx(_hash_fitness(rec["genome"]))

    def test_all_recorded_genomes_are_valid(self):
        """Gen-1 records include mutated/crossed-over children — still valid genomes."""
        run, _ = _make_counting_runner()
        records = capture_per_genome("compute", run, _config(4, 11), generations=2)
        for rec in records:
            assert len(rec["genome"]) == 256
            assert validate(rec["genome"]).valid, validate(rec["genome"]).errors

    def test_deterministic_across_fresh_population_roots(self, tmp_path, monkeypatch):
        run_a, _ = _make_counting_runner()
        monkeypatch.setenv(ENV_KEY, str(tmp_path / "root-a"))
        records_a = capture_per_genome("compute", run_a, _config(4, 42), generations=2)

        run_b, _ = _make_counting_runner()
        monkeypatch.setenv(ENV_KEY, str(tmp_path / "root-b"))
        records_b = capture_per_genome("compute", run_b, _config(4, 42), generations=2)

        assert records_a == records_b

    def test_zero_generations_yields_no_records_and_no_runner_calls(self):
        run, calls = _make_counting_runner()
        records = capture_per_genome("compute", run, _config(4, 11), generations=0)
        assert records == []
        assert calls == []

    def test_runner_invoked_twice_per_genome_per_generation(self):
        """Documented actual behavior: the capture loop evaluates every pool entry,
        then evaluate_and_evolve() re-evaluates the same entries — 2x calls each."""
        run, calls = _make_counting_runner()
        capture_per_genome("compute", run, _config(4, 11), generations=2)
        assert len(calls) == 2 * 4 * 2

    def test_elite_genomes_carry_into_next_generation(self):
        """Default elitism_count=2: the two fittest gen-0 genomes must reappear
        among gen-1 records."""
        run, _ = _make_counting_runner()
        records = capture_per_genome("compute", run, _config(4, 11), generations=2)
        gen0 = [r for r in records if r["gen"] == 0]
        gen1_genomes = {r["genome"] for r in records if r["gen"] == 1}
        top2 = sorted(gen0, key=lambda r: r["fitness"], reverse=True)[:2]
        for rec in top2:
            assert rec["genome"] in gen1_genomes

    def test_reuses_existing_population_on_disk(self):
        config = _config(3, 5)
        pre = Population.load_or_create(config)
        pre_genomes = {e.genome for e in pre.all()}

        run, _ = _make_counting_runner()
        records = capture_per_genome("compute", run, config, generations=1)
        assert {r["genome"] for r in records} == pre_genomes


class TestRunPerGenomeCapture:
    def test_combined_records_tagged_by_seed(self):
        run, _ = _make_counting_runner()
        records = run_per_genome_capture("compute", run, population_size=4,
                                         generations=2, seeds=[3, 5])
        assert len(records) == 2 * 4 * 2
        for rec in records:
            assert set(rec.keys()) == {"genome", "fitness", "gen", "seed"}
        assert [r["seed"] for r in records] == [3] * 8 + [5] * 8

    def test_restores_env_var_when_previously_set(self, monkeypatch, tmp_path):
        sentinel = str(tmp_path / "sentinel-root")
        monkeypatch.setenv(ENV_KEY, sentinel)
        run, _ = _make_counting_runner()
        run_per_genome_capture("compute", run, population_size=2, generations=1, seeds=[1])
        assert os.environ[ENV_KEY] == sentinel

    def test_removes_env_var_when_previously_unset(self, monkeypatch):
        monkeypatch.delenv(ENV_KEY, raising=False)
        run, _ = _make_counting_runner()
        run_per_genome_capture("compute", run, population_size=2, generations=1, seeds=[1])
        assert ENV_KEY not in os.environ

    def test_same_seeds_reproducible_across_invocations(self):
        run_a, _ = _make_counting_runner()
        first = run_per_genome_capture("compute", run_a, population_size=4,
                                       generations=2, seeds=[7])
        run_b, _ = _make_counting_runner()
        second = run_per_genome_capture("compute", run_b, population_size=4,
                                        generations=2, seeds=[7])
        assert first == second

    def test_different_seeds_produce_different_initial_genomes(self):
        run, _ = _make_counting_runner()
        records = run_per_genome_capture("compute", run, population_size=4,
                                         generations=1, seeds=[1, 2])
        seed1_genomes = {r["genome"] for r in records if r["seed"] == 1}
        seed2_genomes = {r["genome"] for r in records if r["seed"] == 2}
        assert seed1_genomes.isdisjoint(seed2_genomes)
