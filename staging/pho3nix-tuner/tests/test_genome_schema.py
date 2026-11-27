"""PHO00001 genome schema: encode/decode round-trip, bounds, clamping, param formatting."""
from __future__ import annotations

import random

import pytest
from alienclaw_ga.genome.codec import XCODE_MAX, encode_xcode, round_trip_check
from alienclaw_ga.genome.validation import validate
from hypothesis import given
from hypothesis import strategies as st

from pho3nix_tuner import genome_schema as gs

BASELINES = {
    "default": gs.DEFAULT_CONFIG,
    "stealth": gs.STEALTH_CONFIG,
    "aggressive": gs.AGGRESSIVE_CONFIG,
}
BOUNDS = {
    "threads": (gs._THREADS_MIN, gs._THREADS_MAX),
    "delay_ms": (gs._DELAY_MS_MIN, gs._DELAY_MS_MAX),
    "timeout_sec": (gs._TIMEOUT_SEC_MIN, gs._TIMEOUT_SEC_MAX),
    "timing_t": (gs._TIMING_T_MIN, gs._TIMING_T_MAX),
}


@pytest.mark.parametrize("name", sorted(BASELINES))
@pytest.mark.parametrize("seed", [0, 1, 42, 2026])
def test_baseline_round_trip(name: str, seed: int) -> None:
    cfg = BASELINES[name]
    genome = gs.encode_pho_config(cfg, random.Random(seed))
    assert len(genome) == 256
    assert genome[:8] == gs.PHO_ID_TAG
    assert genome[10:20] == gs.PHO_NAMESPACE
    assert round_trip_check(genome)
    assert validate(genome).valid
    assert gs.decode_pho_config(genome) == cfg


def test_baselines_are_distinct_and_in_bounds() -> None:
    assert len({tuple(sorted(c.items())) for c in BASELINES.values()}) == 3
    for cfg in BASELINES.values():
        assert set(cfg) == set(BOUNDS)
        for key, (lo, hi) in BOUNDS.items():
            assert lo <= cfg[key] <= hi


def test_encode_is_deterministic_for_a_seed() -> None:
    a = gs.encode_pho_config(gs.DEFAULT_CONFIG, random.Random(7))
    b = gs.encode_pho_config(gs.DEFAULT_CONFIG, random.Random(7))
    c = gs.encode_pho_config(gs.DEFAULT_CONFIG, random.Random(8))
    assert a == b
    assert a != c  # random filler differs ...
    assert gs.decode_pho_config(a) == gs.decode_pho_config(c)  # ... the genes do not


def test_encode_clamps_out_of_range_values() -> None:
    wild = {"threads": 999, "delay_ms": -5, "timeout_sec": 1, "timing_t": 9}
    decoded = gs.decode_pho_config(gs.encode_pho_config(wild, random.Random(0)))
    assert decoded == {"threads": 50, "delay_ms": 0, "timeout_sec": 5, "timing_t": 5}


def _with_xcodes(genome: str, value: int) -> str:
    """Overwrite EXECUTION-slot Xcodes 0-3 with `value` (checksum not recomputed)."""
    chars = list(genome)
    for x in range(4):
        base = gs._SLOT * 64 + 1 + x * 2
        chars[base : base + 2] = encode_xcode(value)
    return "".join(chars)


def test_extreme_xcodes_decode_to_exact_bounds() -> None:
    base = gs.random_pho_genome(random.Random(3))
    lo = gs.decode_pho_config(_with_xcodes(base, 0))
    hi = gs.decode_pho_config(_with_xcodes(base, XCODE_MAX))
    assert lo == {k: b[0] for k, b in BOUNDS.items()}
    assert hi == {k: b[1] for k, b in BOUNDS.items()}


@given(st.integers(min_value=0, max_value=2**32 - 1))
def test_random_genomes_decode_in_bounds(seed: int) -> None:
    genome = gs.random_pho_genome(random.Random(seed))
    assert genome[:8] == gs.PHO_ID_TAG
    assert round_trip_check(genome)
    cfg = gs.decode_pho_config(genome)
    for key, (lo, hi) in BOUNDS.items():
        assert lo <= cfg[key] <= hi


@given(
    st.integers(5, 50), st.integers(0, 1000), st.integers(5, 30), st.integers(2, 5),
    st.integers(min_value=0, max_value=2**16),
)
def test_every_in_bounds_config_round_trips(t, d, to, tt, seed) -> None:
    cfg = {"threads": t, "delay_ms": d, "timeout_sec": to, "timing_t": tt}
    genome = gs.encode_pho_config(cfg, random.Random(seed))
    assert round_trip_check(genome)
    assert gs.decode_pho_config(genome) == cfg


def test_param_formatting_for_baselines() -> None:
    assert gs.config_to_gobuster_params(gs.DEFAULT_CONFIG) == {
        "threads": 20, "delay": "0.0s", "timeout": "10s",
    }
    assert gs.config_to_gobuster_params(gs.STEALTH_CONFIG) == {
        "threads": 5, "delay": "1.0s", "timeout": "30s",
    }
    assert gs.config_to_nmap_params(gs.DEFAULT_CONFIG) == {"timing": "-T4"}
    assert gs.config_to_nmap_params(gs.STEALTH_CONFIG) == {"timing": "-T2"}
    assert gs.config_to_nmap_params(gs.AGGRESSIVE_CONFIG) == {"timing": "-T5"}


def test_delay_formatting_is_100ms_resolution() -> None:
    """Documented fragility: the gene has 1 ms resolution, the emitted flag 100 ms."""
    cfg = dict(gs.DEFAULT_CONFIG)
    emitted = set()
    for ms in range(0, 1001):
        cfg["delay_ms"] = ms
        emitted.add(gs.config_to_gobuster_params(cfg)["delay"])
    assert len(emitted) == 11
    cfg["delay_ms"] = 40
    assert gs.config_to_gobuster_params(cfg)["delay"] == "0.0s"
