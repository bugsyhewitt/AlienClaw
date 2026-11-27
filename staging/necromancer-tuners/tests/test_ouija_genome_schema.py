"""ouija genome schema: round-trips, gene bounds, and the committed winner."""

from __future__ import annotations

import itertools
import random

import pytest
from alienclaw_ga.genome.codec import round_trip_check
from alienclaw_ga.genome.validation import validate
from hypothesis import given, seed, settings
from hypothesis import strategies as st

from genome_helpers import XCODE_MAX, load_winner, with_xcodes
from necromancer_tuners.ouija import genome_schema as gs

KEYS = {"carrier", "framing", "repeats", "temperature"}
B64_BASELINE = dict(gs.PLAIN_BASELINE_CONFIG, carrier="b64")  # run_ga's second baseline


def _assert_in_bounds(cfg: dict) -> None:
    assert set(cfg) == KEYS
    assert cfg["carrier"] in gs.CARRIERS
    assert cfg["framing"] in gs.FRAMINGS
    assert isinstance(cfg["repeats"], int)
    assert 1 <= cfg["repeats"] <= 40
    assert 0.0 <= cfg["temperature"] <= 1.0
    assert round(cfg["temperature"], 2) == cfg["temperature"]


@pytest.mark.parametrize(
    "config",
    [gs.DEFAULT_CONFIG, gs.PLAIN_BASELINE_CONFIG, B64_BASELINE],
    ids=["default", "plain-baseline", "b64-baseline"],
)
@pytest.mark.parametrize("rng_seed", [0, 1, 42, 2026])
def test_baseline_round_trip(config, rng_seed):
    genome = gs.encode_ouija_config(config, random.Random(rng_seed))
    assert len(genome) == 256
    assert round_trip_check(genome)
    assert validate(genome).valid
    assert genome[:8] == gs.OUIJA_ID_TAG
    assert genome[10:20] == gs.OUIJA_NAMESPACE
    assert gs.decode_ouija_config(genome) == config


def test_every_carrier_framing_pair_round_trips():
    for i, (carrier, framing) in enumerate(itertools.product(gs.CARRIERS, gs.FRAMINGS)):
        cfg = {"carrier": carrier, "framing": framing,
               "repeats": 1 + i % 40, "temperature": (i % 101) / 100.0}
        cfg["temperature"] = round(cfg["temperature"], 2)
        assert gs.decode_ouija_config(gs.encode_ouija_config(cfg, random.Random(i))) == cfg


def test_encode_clamps_repeats_and_temperature():
    cfg = gs.decode_ouija_config(gs.encode_ouija_config(
        {"carrier": "hex", "framing": "urgent", "repeats": 0, "temperature": -0.3},
        random.Random(0),
    ))
    assert (cfg["repeats"], cfg["temperature"]) == (1, 0.0)
    cfg = gs.decode_ouija_config(gs.encode_ouija_config(
        {"carrier": "hex", "framing": "urgent", "repeats": 999, "temperature": 1.7},
        random.Random(0),
    ))
    assert (cfg["repeats"], cfg["temperature"]) == (40, 1.0)


@pytest.mark.parametrize("bad", [{"carrier": "morse"}, {"framing": "flattery"}])
def test_encode_rejects_unknown_carrier_or_framing(bad):
    with pytest.raises(ValueError):
        gs.encode_ouija_config({**gs.DEFAULT_CONFIG, **bad}, random.Random(0))


def test_random_genome_pins_id_tag_and_namespace():
    for s in range(20):
        g = gs.random_ouija_genome(random.Random(s))
        assert g[:8] == "OUI00001"
        assert g[10:20] == "OuijaGA001"
        assert round_trip_check(g)


@seed(20261126)
@settings(max_examples=300, deadline=None)
@given(st.integers(min_value=0, max_value=2**32 - 1))
def test_random_genomes_decode_in_bounds_and_round_trip(rng_seed):
    genome = gs.random_ouija_genome(random.Random(rng_seed))
    cfg = gs.decode_ouija_config(genome)
    _assert_in_bounds(cfg)
    assert gs.decode_ouija_config(gs.encode_ouija_config(cfg, random.Random(rng_seed))) == cfg


@seed(1126)
@settings(max_examples=300, deadline=None)
@given(st.lists(st.integers(min_value=0, max_value=XCODE_MAX), min_size=4, max_size=4))
def test_every_xcode_value_decodes_in_bounds(xcodes):
    base = gs.random_ouija_genome(random.Random(0))
    cfg = gs.decode_ouija_config(with_xcodes(base, dict(enumerate(xcodes))))
    _assert_in_bounds(cfg)
    assert gs.decode_ouija_config(gs.encode_ouija_config(cfg, random.Random(5))) == cfg


def test_xcode_extremes_hit_the_documented_range_ends():
    base = gs.random_ouija_genome(random.Random(0))
    lo = gs.decode_ouija_config(with_xcodes(base, {i: 0 for i in range(4)}))
    hi = gs.decode_ouija_config(with_xcodes(base, {i: XCODE_MAX for i in range(4)}))
    assert lo == {"carrier": "plain", "framing": "none", "repeats": 1, "temperature": 0.0}
    assert hi == {"carrier": "utag", "framing": "obfuscate", "repeats": 40, "temperature": 1.0}


def test_decoder_ignores_free_xcode_positions():
    base = gs.encode_ouija_config(B64_BASELINE, random.Random(0))
    noisy = with_xcodes(base, {i: (i * 613) % (XCODE_MAX + 1) for i in range(4, 31)})
    assert noisy != base
    assert gs.decode_ouija_config(noisy) == B64_BASELINE


# ---------------------------------------------------------------------------
# Committed winner (ouija_tuner/results/, copied to tests/fixtures/ouija/)
# ---------------------------------------------------------------------------

def test_winner_artifacts_agree_with_each_other():
    w = load_winner("ouija")
    genome = w["genome_txt"].strip()
    assert w["genome_txt"] == genome + "\n"
    assert genome == w["config"]["genome"] == w["results"]["evolved"]["genome"]
    assert w["config"]["config"] == w["config"]["config_roundtrip"]
    assert w["config"]["config"] == w["results"]["evolved"]["config"]
    assert w["config"]["id_tag"] == genome[:8] == gs.OUIJA_ID_TAG


def test_winner_genome_re_decodes_to_recorded_config():
    w = load_winner("ouija")
    genome = w["config"]["genome"]
    assert round_trip_check(genome)
    assert validate(genome).valid
    cfg = gs.decode_ouija_config(genome)
    assert cfg == w["config"]["config"]
    assert cfg == {"carrier": "plain", "framing": "roleplay", "repeats": 5, "temperature": 0.75}
    _assert_in_bounds(cfg)


def test_winner_genome_is_reproduced_byte_for_byte_by_the_staged_encoder():
    w = load_winner("ouija")
    assert gs.encode_ouija_config(w["config"]["config"], random.Random(0)) == (
        w["config"]["genome"]
    )


def test_winner_results_record_a_consistent_gate_pass():
    r = load_winner("ouija")["results"]
    ev = r["evolved"]["fitness_held_out"]
    assert r["gate_pass"] is True
    assert ev > r["baselines"]["plain_held_out"]
    assert ev > r["baselines"]["best_held_out"]
    assert r["baselines"]["best_held_out"] == max(
        r["baselines"]["plain_held_out"], r["baselines"]["b64_held_out"]
    )
