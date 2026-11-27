"""mangle fitness adapter: mocked fuzz campaign → crash-rate fitness.

The adapter boundary is ``fitness_adapter.fuzz_file`` (mangle's campaign entry
point, which spawns the decoder subprocesses). Each test replaces it with a
function that writes a results.jsonl like mangle's; the fake coverage_report
(tuner_fakes.py) reads it back with mangle's counting rules.
"""

from __future__ import annotations

import math
import random
import subprocess
import tempfile
from pathlib import Path
from unittest import mock

import pytest
from alienclaw_ga.evolution.generation import FitnessReport, evaluate_and_evolve
from alienclaw_ga.evolution.population import Population
from alienclaw_ga.evolution.types import EvolutionConfig
from hypothesis import given, seed, settings
from hypothesis import strategies as st

import tuner_fakes
from necromancer_tuners.mangle import fitness_adapter as fa
from necromancer_tuners.mangle import genome_schema as gs
from tuner_fakes import write_results_jsonl

CONFIG = {
    "strategy": "adaptive",
    "alpha": 0.6,
    "beta": 2.8,
    "exploration_floor": 0.008,
    "concurrency": 3,
    "timeout": 21.9,
}


@pytest.fixture
def seed_file(tmp_path):
    p = tmp_path / "clean.h265"
    p.write_bytes(b"\x00\x00\x00\x01\x40\x01")
    return p


@pytest.fixture
def work_dir(tmp_path):
    d = tmp_path / "work"
    d.mkdir()
    return d


def _fuzz_writing(outcomes, calls=None, during=None):
    def fake_fuzz_file(**kwargs):
        if calls is not None:
            calls.append(kwargs)
        if during is not None:
            during(kwargs)
        write_results_jsonl(kwargs["output_dir"], outcomes)
        return []
    return fake_fuzz_file


def test_adapter_is_bound_to_the_fakes():
    assert getattr(fa._mangle_engine, tuner_fakes.FAKE_MARKER, False)
    assert fa.coverage_report is tuner_fakes.coverage_report
    assert fa.FitnessReport is FitnessReport  # alienclaw_ga's, not in-tree alienclaw's


def test_crash_rate_is_crash_aborts_over_total_iterations(monkeypatch, seed_file, work_dir):
    outcomes = (
        [("m1", "crash")] * 3 + [("m2", "abort")] + [("m1", "clean")] * 4
        + [("m2", "timeout"), ("m3", "hang")]
    )
    calls: list[dict] = []
    monkeypatch.setattr(fa, "fuzz_file", _fuzz_writing(outcomes, calls))

    fitness = fa.run_mangle_candidate(CONFIG, seed_file, seed_rng=5, iterations=10,
                                      work_dir=work_dir)

    assert fitness == pytest.approx(0.4)  # (3 crash + 1 abort) / 10; timeout/hang are not
    assert len(calls) == 1
    kw = calls[0]
    assert kw["seed_path"] == Path(seed_file)
    assert kw["iterations"] == 10
    assert kw["decoder"] == "ffmpeg"
    assert kw["timeout"] == 21.9
    assert kw["seed_rng"] == 5
    assert kw["concurrency"] == 3
    assert kw["strategy"] == "adaptive"
    assert kw["scheduler_state"] is None
    assert kw["crash_dedup"] is False
    assert Path(kw["output_dir"]).parent == work_dir


def test_output_dir_is_removed_after_success_and_failure(monkeypatch, seed_file, work_dir):
    monkeypatch.setattr(fa, "fuzz_file", _fuzz_writing([("m1", "crash")]))
    fa.run_mangle_candidate(CONFIG, seed_file, 0, 1, work_dir=work_dir)
    assert list(work_dir.iterdir()) == []

    def boom(**kwargs):
        (Path(kwargs["output_dir"]) / "partial.bin").write_bytes(b"x")
        raise RuntimeError("decoder blew up")

    monkeypatch.setattr(fa, "fuzz_file", boom)
    assert fa.run_mangle_candidate(CONFIG, seed_file, 0, 1, work_dir=work_dir) == 0.0
    assert list(work_dir.iterdir()) == []


def test_default_work_dir_is_the_system_temp_dir(monkeypatch, seed_file, scratch_dir):
    calls: list[dict] = []
    monkeypatch.setattr(fa, "fuzz_file", _fuzz_writing([("m1", "clean")], calls))
    fa.evaluate_config(CONFIG, seed_file, 0, 1)
    # conftest points tempfile at the per-test scratch dir
    assert Path(calls[0]["output_dir"]).parent == scratch_dir
    assert list(scratch_dir.iterdir()) == []


def test_missing_seed_scores_zero_without_fuzzing(monkeypatch, tmp_path, work_dir):
    calls: list[dict] = []
    monkeypatch.setattr(fa, "fuzz_file", _fuzz_writing([("m1", "crash")], calls))
    assert fa.run_mangle_candidate(CONFIG, tmp_path / "nope.h265", 0, 10, work_dir) == 0.0
    assert calls == []
    assert list(work_dir.iterdir()) == []


@pytest.mark.parametrize(
    "exc",
    [
        subprocess.TimeoutExpired(cmd="ffmpeg", timeout=21.9),
        TimeoutError("campaign timed out"),
        FileNotFoundError("ffmpeg: not found"),
        RuntimeError("anything"),
    ],
    ids=["subprocess-timeout", "timeout", "decoder-missing", "other"],
)
def test_fuzzer_failure_or_timeout_scores_zero(monkeypatch, seed_file, work_dir, exc):
    def failing(**kwargs):
        raise exc

    monkeypatch.setattr(fa, "fuzz_file", failing)
    assert fa.run_mangle_candidate(CONFIG, seed_file, 0, 10, work_dir) == 0.0


def test_missing_results_file_scores_zero(monkeypatch, seed_file, work_dir):
    monkeypatch.setattr(fa, "fuzz_file", lambda **kw: [])
    assert fa.run_mangle_candidate(CONFIG, seed_file, 0, 10, work_dir) == 0.0


def test_zero_iterations_scores_zero_not_nan(monkeypatch, seed_file, work_dir):
    monkeypatch.setattr(fa, "fuzz_file", _fuzz_writing([]))
    out = fa.run_mangle_candidate(CONFIG, seed_file, 0, 0, work_dir)
    assert out == 0.0
    assert math.isfinite(out)


def test_malformed_results_score_zero(monkeypatch, seed_file, work_dir):
    def garbage(**kwargs):
        (Path(kwargs["output_dir"]) / "results.jsonl").write_text("{not json\n")

    monkeypatch.setattr(fa, "fuzz_file", garbage)
    assert fa.run_mangle_candidate(CONFIG, seed_file, 0, 10, work_dir) == 0.0


@seed(20261126)
@settings(max_examples=60, deadline=None)
@given(st.integers(min_value=0, max_value=200).flatmap(
    lambda n: st.tuples(st.just(n), st.integers(min_value=0, max_value=n))
))
def test_crash_rate_is_finite_and_in_unit_interval(n_and_crashes):
    n, crashes = n_and_crashes
    outcomes = [("m", "crash")] * crashes + [("m", "clean")] * (n - crashes)
    with tempfile.TemporaryDirectory() as d:
        seed_path = Path(d) / "seed.h265"
        seed_path.write_bytes(b"\x00")
        with mock.patch.object(fa, "fuzz_file", _fuzz_writing(outcomes)):
            out = fa.run_mangle_candidate(CONFIG, seed_path, 0, n, work_dir=d)
    assert math.isfinite(out)
    assert 0.0 <= out <= 1.0
    assert out == (crashes / n if n else 0.0)


# ---------------------------------------------------------------------------
# Scheduler injection (the alpha / beta / exploration_floor genes)
# ---------------------------------------------------------------------------

def test_scheduler_params_are_injected_then_restored(monkeypatch, seed_file, work_dir):
    original = fa._mangle_engine.make_scheduler
    built: dict = {}

    def during(_kwargs):
        make = fa._mangle_engine.make_scheduler
        assert make is not original
        built["adaptive"] = make("adaptive", ["m1", "m2", "m3"])
        built["many"] = make("adaptive", [f"m{i}" for i in range(40)])
        built["uniform"] = make("uniform", ["m1", "m2"])

    cfg = dict(CONFIG, exploration_floor=0.045)
    monkeypatch.setattr(fa, "fuzz_file", _fuzz_writing([("m1", "clean")], during=during))
    fa.run_mangle_candidate(cfg, seed_file, 0, 1, work_dir)

    a = built["adaptive"]
    assert isinstance(a, tuner_fakes.AdaptiveScheduler)
    assert (a.alpha, a.beta, a.exploration_floor) == (0.6, 2.8, 0.045)
    # floor is clamped to 1/len(mutators) so mangle's validation never rejects it
    assert built["many"].exploration_floor == pytest.approx(1.0 / 40)
    assert isinstance(built["uniform"], tuner_fakes.UniformScheduler)
    assert fa._mangle_engine.make_scheduler is original


def test_scheduler_is_restored_when_the_campaign_raises(monkeypatch, seed_file, work_dir):
    original = fa._mangle_engine.make_scheduler

    def failing(**kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(fa, "fuzz_file", failing)
    fa.run_mangle_candidate(CONFIG, seed_file, 0, 1, work_dir)
    assert fa._mangle_engine.make_scheduler is original


# ---------------------------------------------------------------------------
# RunMartianCallback
# ---------------------------------------------------------------------------

def test_callback_decodes_genome_and_reports_fitness(monkeypatch, seed_file, work_dir):
    calls: list[dict] = []
    monkeypatch.setattr(
        fa, "fuzz_file", _fuzz_writing([("m1", "crash"), ("m1", "clean")], calls)
    )
    genome = gs.encode_mangle_config(CONFIG, random.Random(0))
    cb = fa.make_fitness_callback(seed_file, seed_rng=3, iterations=2, work_dir=work_dir)

    report = cb("mangle", genome)

    assert isinstance(report, FitnessReport)
    assert report.fitness == 0.5
    assert report.run_metadata == {
        "martian_type": "mangle",
        "config": CONFIG,
        "seed_file": str(seed_file),
        "seed_rng": 3,
        "iterations": 2,
    }
    assert calls[0]["strategy"] == "adaptive" and calls[0]["timeout"] == 21.9


def test_non_finite_fitness_never_reaches_the_population(monkeypatch, seed_file):
    # Real mangle reports integer counts, so a NaN needs a broken coverage report.
    # The adapter passes it through; alienclaw_ga coerces non-finite to 0.0.
    monkeypatch.setattr(fa, "fuzz_file", _fuzz_writing([("m1", "crash")]))
    monkeypatch.setattr(
        fa,
        "coverage_report",
        lambda out: tuner_fakes.CoverageReport(
            total_iterations=1,
            mutators=[tuner_fakes.MutatorCoverage("m1", 1, float("nan"))],
        ),
    )
    config = EvolutionConfig(martian_type="mglnan", population_size=4, elitism_count=1, seed=1)
    pop = Population.create(config)
    cb = fa.make_fitness_callback(seed_file, seed_rng=0, iterations=1)
    evaluate_and_evolve(pop, config, cb, random.Random(0))
    assert all(math.isfinite(e.fitness) for e in pop.all())
    assert all(0.0 <= e.fitness <= 1.0 for e in pop.all())
