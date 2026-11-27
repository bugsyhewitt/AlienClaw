"""Reward model + fitness adapter sanity: reward table, bounds, monotonicity, shrinkage."""
from __future__ import annotations

import itertools
import math
from datetime import datetime, timedelta, timezone

import pytest
from hypothesis import given
from hypothesis import strategies as st

from _synth import SIG_A, SIG_D, row, sufficient, write
from pho3nix_tuner import reward_model as rm
from pho3nix_tuner.fitness_adapter import evaluate_config
from pho3nix_tuner.genome_schema import AGGRESSIVE_CONFIG, DEFAULT_CONFIG, STEALTH_CONFIG

# ---------------------------------------------------------------------------
# compute_reward
# ---------------------------------------------------------------------------

REWARD_TABLE = {
    # (success, timed_out, partial) -> reward
    (False, False, False): 0.0,
    (True, False, False): 1.0,
    (False, True, False): -0.5,
    (False, False, True): -0.1,
    (True, True, False): 0.5,
    (True, False, True): 0.9,
    (False, True, True): -0.6,
    (True, True, True): 0.4,
}


@pytest.mark.parametrize(("flags", "expected"), sorted(REWARD_TABLE.items()))
def test_reward_table(flags, expected) -> None:
    s, t, p = flags
    r = rm.compute_reward(row(0, success=s, timed_out=t, partial_results=p))
    assert r == pytest.approx(expected)


def test_reward_range() -> None:
    """All rewards lie in [-0.6, 1.0] (inside the [-1, 1] clamp).

    Note: the docstring says [REWARD_TIMED_OUT, REWARD_SUCCESS] == [-0.5, 1.0];
    a failed run that both timed out and was partial scores -0.6.
    """
    assert min(REWARD_TABLE.values()) == pytest.approx(-0.6)
    assert max(REWARD_TABLE.values()) == rm.REWARD_SUCCESS == 1.0


def test_reward_monotonicity() -> None:
    for s, t, p in itertools.product([False, True], repeat=3):
        base = REWARD_TABLE[(s, t, p)]
        if not s:
            assert REWARD_TABLE[(True, t, p)] > base  # success only helps
        if not t:
            assert REWARD_TABLE[(s, True, p)] < base  # a timeout only hurts
        if not p:
            assert REWARD_TABLE[(s, t, True)] < base  # partial results only hurt


@pytest.mark.parametrize("tool", ["nuclei", "wafw00f", "unknown", "?"])
def test_non_target_tools_have_no_reward(tool) -> None:
    assert rm.compute_reward(row(0, tool=tool, success=True)) is None


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def test_recency_weight() -> None:
    now = datetime.now(timezone.utc)
    assert rm._recency_weight("", now) == 1.0
    assert rm._recency_weight("garbage", now) == 1.0
    assert rm._recency_weight(now.isoformat(), now) == pytest.approx(1.0)
    half = (now - timedelta(days=rm.RECENCY_HALF_LIFE_DAYS)).isoformat()
    assert rm._recency_weight(half, now) == pytest.approx(0.5)


def test_param_vector_parsing() -> None:
    vec = rm._param_vector(row(0, params={
        "threads": 20, "delay": "0.5s", "timeout": "10s", "timing": "-T4",
        "ratio": "1.25", "mode": "dir", "bad": "xs",
    }))
    assert vec == {"threads": 20.0, "delay": 0.5, "timeout": 10.0, "ratio": 1.25}


def test_param_distance() -> None:
    assert rm._param_distance({"a": 0.0, "b": 3.0}, {"a": 4.0, "b": 0.0}) == 5.0
    assert rm._param_distance({"a": 1.0}, {"z": 1.0}) == 1e6


# ---------------------------------------------------------------------------
# RewardModel.estimate
# ---------------------------------------------------------------------------


def test_empty_model_returns_prior() -> None:
    model = rm.RewardModel([])
    assert model.global_mean == rm.BAYES_PRIOR_MEAN
    assert model.estimate("gobuster", "gobuster|https", {"threads": 20.0}) == rm.BAYES_PRIOR_MEAN
    assert model.context_support("gobuster|https") == 0
    assert model.context_keys == []


def test_unknown_context_returns_global_mean() -> None:
    model = rm.RewardModel(sufficient(8))
    assert model.global_mean == pytest.approx((1.0 - 0.5 - 0.5 - 0.1) / 4)
    assert model.estimate("nmap", "nmap|raw", {}) == model.global_mean
    assert model.context_mean("nmap|raw") == model.global_mean


def test_non_target_rows_are_ignored() -> None:
    model = rm.RewardModel([row(i, tool="nuclei", success=True) for i in range(10)])
    assert model.context_keys == []
    assert model.global_mean == rm.BAYES_PRIOR_MEAN


def _cand(sig: dict) -> dict[str, float]:
    return {k: float(sig[k]) for k in ("threads", "delay_ms", "timeout_sec")}


def test_estimate_prefers_configs_near_successful_runs() -> None:
    model = rm.RewardModel(sufficient(48))
    ctx = "gobuster|https"
    good = model.estimate("gobuster", ctx, _cand(SIG_D))
    bad = model.estimate("gobuster", ctx, _cand(SIG_A))
    assert good > model.context_mean(ctx) > bad
    # Moving the candidate from SIG_A toward SIG_D never lowers the estimate.
    steps = [
        {k: SIG_A[k] + (SIG_D[k] - SIG_A[k]) * f / 10 for k in ("threads", "delay_ms",
                                                              "timeout_sec")}
        for f in range(11)
    ]
    ests = [model.estimate("gobuster", ctx, s) for s in steps]
    assert all(b >= a - 1e-12 for a, b in itertools.pairwise(ests))


def test_shrinkage_formula_thin_and_thick_support() -> None:
    ctx = "gobuster|https"
    # Thin bucket (n=3 < MIN_SUPPORT): shrink factor n / (n + 3 * prior).
    # No timestamps -> recency weight 1.0 each, so the k-NN mean is exact.
    thin = [row(i, params=dict(SIG_D), success=(i == 0), timestamp=None) for i in range(3)]
    model = rm.RewardModel(thin)
    n = 3
    s = n / (n + rm.BAYES_PRIOR_STRENGTH * 3.0)
    wm = 1.0 / 3.0  # three equidistant (d=0), equally weighted neighbours
    cm = 1.0 / 3.0
    assert model.estimate("gobuster", ctx, _cand(SIG_D)) == pytest.approx(s * wm + (1 - s) * cm)
    # Thick bucket: the estimate sits between the k-NN mean and the context mean.
    model = rm.RewardModel(sufficient(48))
    est = model.estimate("gobuster", ctx, _cand(SIG_D))
    n = 48
    s = n / (n + rm.BAYES_PRIOR_STRENGTH)
    assert est == pytest.approx(s * 1.0 + (1 - s) * model.context_mean(ctx), rel=1e-3)


_flags = st.tuples(st.booleans(), st.booleans(), st.booleans())


@given(
    st.lists(
        st.tuples(st.integers(5, 50), st.integers(0, 1000), st.integers(5, 30), _flags),
        min_size=1, max_size=30,
    ),
    st.tuples(st.integers(5, 50), st.integers(0, 1000), st.integers(5, 30)),
)
def test_estimate_is_within_bucket_reward_range(rows, cand) -> None:
    """estimate() is a convex combination of bucket rewards, so it stays in their range."""
    entries = [
        row(i, params={"threads": t, "delay_ms": d, "timeout_sec": to},
            success=s, timed_out=tt, partial_results=p)
        for i, (t, d, to, (s, tt, p)) in enumerate(rows)
    ]
    rewards = [rm.compute_reward(e) for e in entries]
    model = rm.RewardModel(entries)
    est = model.estimate("gobuster", "gobuster|https",
                         {"threads": float(cand[0]), "delay_ms": float(cand[1]),
                          "timeout_sec": float(cand[2])})
    assert math.isfinite(est)
    assert min(rewards) - 1e-9 <= est <= max(rewards) + 1e-9


def test_from_file_reads_all_envelopes(tmp_path) -> None:
    for i, payload in enumerate([sufficient(12), {"entries": sufficient(12)},
                                 {"runs": sufficient(12)}, {"history": sufficient(12)}]):
        model = rm.RewardModel.from_file(write(tmp_path / f"h{i}.json", payload))
        assert model.context_support("gobuster|https") == 12


# ---------------------------------------------------------------------------
# fitness_adapter
# ---------------------------------------------------------------------------


def test_evaluate_config_is_clamped_to_unit_interval() -> None:
    model = rm.RewardModel(sufficient(48))
    for cfg in (DEFAULT_CONFIG, STEALTH_CONFIG, AGGRESSIVE_CONFIG):
        assert evaluate_config(cfg, model, "gobuster", "gobuster|https") == 0.0  # raw < 0
    winner = {**DEFAULT_CONFIG, **SIG_D}
    assert 0.5 < evaluate_config(winner, model, "gobuster", "gobuster|https") <= 1.0


def test_evaluate_config_sqlmap_has_no_genes() -> None:
    """sqlmap: empty candidate vector, so every config scores the same."""
    rows = [row(i, tool="sqlmap", params={"level": i % 3}, success=bool(i % 2))
            for i in range(10)]
    model = rm.RewardModel(rows)
    a = evaluate_config(DEFAULT_CONFIG, model, "sqlmap", "sqlmap|https")
    b = evaluate_config(STEALTH_CONFIG, model, "sqlmap", "sqlmap|https")
    assert a == b
