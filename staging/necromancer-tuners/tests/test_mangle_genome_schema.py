"""mangle genome schema: round-trips, gene bounds, and the committed winner."""

from __future__ import annotations

import random

import pytest
from alienclaw_ga.genome.codec import round_trip_check
from alienclaw_ga.genome.validation import validate
from hypothesis import given, seed, settings
from hypothesis import strategies as st

from genome_helpers import XCODE_MAX, load_winner, with_xcodes
from necromancer_tuners.mangle import genome_schema as gs

KEYS = {"strategy", "alpha", "beta", "exploration_floor", "concurrency", "timeout"}


def _assert_in_bounds(cfg: dict) -> None:
    assert set(cfg) == KEYS
    assert cfg["strategy"] in ("uniform", "adaptive")
    assert 0.1 <= cfg["alpha"] <= 5.0
    assert 0.1 <= cfg["beta"] <= 5.0
    assert 0.0 <= cfg["exploration_floor"] <= 0.045
    assert cfg["exploration_floor"] <= 1.0 / 22  # documented: valid for >= 22 mutators
    assert isinstance(cfg["concurrency"], int)
    assert 1 <= cfg["concurrency"] <= 16
    assert 1.0 <= cfg["timeout"] <= 30.0
    # every float is an exact multiple of its documented scale
    assert round(cfg["alpha"] * 10) / 10.0 == cfg["alpha"]
    assert round(cfg["beta"] * 10) / 10.0 == cfg["beta"]
    assert round(cfg["exploration_floor"] * 1000) / 1000.0 == cfg["exploration_floor"]
    assert round(cfg["timeout"] * 10) / 10.0 == cfg["timeout"]


# ---------------------------------------------------------------------------
# Documented baselines round-trip
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "config",
    [gs.DEFAULT_CONFIG, gs.ADAPTIVE_DEFAULT_CONFIG],
    ids=["uniform-default", "adaptive-default"],
)
@pytest.mark.parametrize("rng_seed", [0, 1, 42, 2026])
def test_baseline_round_trip(config, rng_seed):
    genome = gs.encode_mangle_config(config, random.Random(rng_seed))
    assert len(genome) == 256
    assert round_trip_check(genome)
    assert validate(genome).valid
    assert genome[:8] == gs.MANGLE_ID_TAG
    assert genome[10:20] == gs.MANGLE_NAMESPACE
    assert gs.decode_mangle_config(genome) == config


def test_defaults_match_mangle_out_of_the_box():
    # mangle.scheduler.AdaptiveScheduler defaults: alpha=1.0, beta=1.0, floor=0.02
    assert gs.DEFAULT_CONFIG["strategy"] == "uniform"
    assert gs.ADAPTIVE_DEFAULT_CONFIG == {**gs.DEFAULT_CONFIG, "strategy": "adaptive"}
    for cfg in (gs.DEFAULT_CONFIG, gs.ADAPTIVE_DEFAULT_CONFIG):
        assert (cfg["alpha"], cfg["beta"], cfg["exploration_floor"]) == (1.0, 1.0, 0.02)


def test_encode_clamps_out_of_range_values():
    wild = {
        "strategy": "something-else",
        "alpha": 99.0,
        "beta": 0.0,
        "exploration_floor": 0.5,
        "concurrency": 0,
        "timeout": 1000.0,
    }
    cfg = gs.decode_mangle_config(gs.encode_mangle_config(wild, random.Random(0)))
    assert cfg == {
        "strategy": "uniform",  # anything but "adaptive" encodes as uniform
        "alpha": 5.0,
        "beta": 0.1,
        "exploration_floor": 0.045,
        "concurrency": 1,
        "timeout": 30.0,
    }


def test_encode_is_deterministic_for_a_seeded_rng():
    a = gs.encode_mangle_config(gs.DEFAULT_CONFIG, random.Random(7))
    b = gs.encode_mangle_config(gs.DEFAULT_CONFIG, random.Random(7))
    assert a == b


def test_random_genome_pins_id_tag_and_namespace():
    for s in range(20):
        g = gs.random_mangle_genome(random.Random(s))
        assert g[:8] == "MGL00001"
        assert g[10:20] == "MangleGA01"
        assert round_trip_check(g)


# ---------------------------------------------------------------------------
# Gene bounds for random genomes (fixed-seed hypothesis)
# ---------------------------------------------------------------------------

@seed(20261126)
@settings(max_examples=300, deadline=None)
@given(st.integers(min_value=0, max_value=2**32 - 1))
def test_random_genomes_decode_in_bounds_and_round_trip(rng_seed):
    genome = gs.random_mangle_genome(random.Random(rng_seed))
    cfg = gs.decode_mangle_config(genome)
    _assert_in_bounds(cfg)
    re_encoded = gs.encode_mangle_config(cfg, random.Random(rng_seed + 1))
    assert gs.decode_mangle_config(re_encoded) == cfg


@seed(1126)
@settings(max_examples=300, deadline=None)
@given(st.lists(st.integers(min_value=0, max_value=XCODE_MAX), min_size=6, max_size=6))
def test_every_xcode_value_decodes_in_bounds(xcodes):
    base = gs.random_mangle_genome(random.Random(0))
    genome = with_xcodes(base, dict(enumerate(xcodes)))
    cfg = gs.decode_mangle_config(genome)
    _assert_in_bounds(cfg)
    assert gs.decode_mangle_config(gs.encode_mangle_config(cfg, random.Random(3))) == cfg


def test_xcode_extremes_hit_the_documented_range_ends():
    base = gs.random_mangle_genome(random.Random(0))
    lo = gs.decode_mangle_config(with_xcodes(base, {i: 0 for i in range(6)}))
    hi = gs.decode_mangle_config(with_xcodes(base, {i: XCODE_MAX for i in range(6)}))
    assert lo == {"strategy": "uniform", "alpha": 0.1, "beta": 0.1,
                  "exploration_floor": 0.0, "concurrency": 1, "timeout": 1.0}
    assert hi == {"strategy": "adaptive", "alpha": 5.0, "beta": 5.0,
                  "exploration_floor": 0.045, "concurrency": 16, "timeout": 30.0}


def test_decoder_ignores_free_xcode_positions():
    base = gs.encode_mangle_config(gs.ADAPTIVE_DEFAULT_CONFIG, random.Random(0))
    noisy = with_xcodes(base, {i: (i * 997) % (XCODE_MAX + 1) for i in range(6, 31)})
    assert noisy != base
    assert gs.decode_mangle_config(noisy) == gs.ADAPTIVE_DEFAULT_CONFIG


# ---------------------------------------------------------------------------
# Committed winner (mangle_tuner/results/, copied to tests/fixtures/mangle/)
# ---------------------------------------------------------------------------

def test_winner_artifacts_agree_with_each_other():
    w = load_winner("mangle")
    genome = w["genome_txt"].strip()
    assert w["genome_txt"] == genome + "\n"
    assert genome == w["config"]["genome"] == w["results"]["evolved"]["genome"]
    assert w["config"]["config"] == w["config"]["config_roundtrip"]
    assert w["config"]["config"] == w["results"]["evolved"]["config"]
    assert w["config"]["id_tag"] == genome[:8] == gs.MANGLE_ID_TAG


def test_winner_genome_re_decodes_to_recorded_config():
    w = load_winner("mangle")
    genome = w["config"]["genome"]
    assert round_trip_check(genome)
    assert validate(genome).valid
    cfg = gs.decode_mangle_config(genome)
    assert cfg == w["config"]["config"]
    assert cfg == {"strategy": "adaptive", "alpha": 0.6, "beta": 2.8,
                   "exploration_floor": 0.008, "concurrency": 3, "timeout": 21.9}
    _assert_in_bounds(cfg)


def test_winner_genome_is_reproduced_byte_for_byte_by_the_staged_encoder():
    # run_ga re-encodes the winner with random.Random(0); the staged encoder on
    # alienclaw_ga must reproduce the in-tree artifact exactly.
    w = load_winner("mangle")
    assert gs.encode_mangle_config(w["config"]["config"], random.Random(0)) == (
        w["config"]["genome"]
    )


def test_winner_results_record_a_consistent_gate_pass():
    r = load_winner("mangle")["results"]
    ev = r["evolved"]["fitness_held_out"]
    assert r["gate_pass"] is True
    assert ev > r["baselines"]["uniform_held_out"]
    assert ev > r["baselines"]["adaptive_held_out"]
