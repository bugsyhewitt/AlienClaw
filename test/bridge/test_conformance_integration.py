"""Bridge-level integration tests for graded correctness (output-contract conformance).

`test/fitness/test_conformance.py` unit-tests `conformance_score`/`conformance_for` in
isolation. Nothing previously verified the load-bearing path end-to-end: that a genome
whose decoded parameters emit fewer OUTPUT CONTRACT fields actually produces a lower
`correctness` — and therefore a lower fitness — through the real bridge.

That gap mattered because the whole point of conformance grading is to give selection a
gradient on output quality. A regression that silently returned a constant correctness
would leave every unit test green while flattening the correctness channel again.

All requests use the real registries (seed/msb/, seed/martians/) and seeded genomes, so
these are deterministic and network-free.
"""
from __future__ import annotations

import json
import random
from typing import Any

import pytest

from alienclaw.bridge.server import handle
from alienclaw.fitness.conformance import conformance_for
from alienclaw.genome.operators import random_genome


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


def _summon(seed: int, martian_type: str = "compute", inputs: Any = None) -> dict:
    """Run one seeded genome through the real bridge; return the response object."""
    envelope = json.dumps({
        "bridge_version": "1.0",
        "request_id": f"conf-{seed}",
        "request": {
            "kind": "summon",
            "genome": random_genome(random.Random(seed), "COMPUT01"),
            "martian_type": martian_type,
            "inputs": {"input": "2 + 2"} if inputs is None else inputs,
            "timeout_ms": 30000,
        },
    }).encode()
    return handle(envelope)["response"]


# Seeds chosen to span every reachable compute conformance grade (1/6 … 6/6).
# Verified by sweeping seeds 0-59 against the real bridge.
_GRADE_SEEDS = [
    (7,  1 / 6),
    (5,  2 / 6),
    (0,  3 / 6),
    (28, 4 / 6),
    (2,  6 / 6),
]


@pytest.mark.parametrize("seed,expected_correctness", _GRADE_SEEDS)
def test_bridge_reports_graded_correctness(seed, expected_correctness):
    """A genome emitting k contract fields yields correctness = k/6 through the bridge."""
    resp = _summon(seed)
    assert resp["ok"] is True
    assert resp["run_metadata"]["correctness"] == pytest.approx(expected_correctness)


@pytest.mark.parametrize("seed,_expected", _GRADE_SEEDS)
def test_bridge_correctness_matches_conformance_of_returned_output(seed, _expected):
    """The bridge's correctness is exactly the conformance of the output it returned.

    Pins the two together so a change to either the scorer or the bridge wiring that
    desynchronises them fails loudly.
    """
    resp = _summon(seed)
    assert resp["ok"] is True
    assert resp["run_metadata"]["correctness"] == pytest.approx(
        conformance_for("compute", resp["output"])
    )


def test_correctness_channel_is_not_flat():
    """Distinct genomes must produce distinct correctness — the channel carries signal.

    This is the regression guard for the 2026-07-16 SIGNAL_PARTIAL finding: when
    correctness was binary, every successful run scored 1.0 and selection saw nothing.
    """
    values = set()
    for seed, _ in _GRADE_SEEDS:
        resp = _summon(seed)
        if resp.get("ok"):
            values.add(round(resp["run_metadata"]["correctness"], 6))
    assert len(values) >= 2, f"correctness is flat across genomes: {values}"


@pytest.mark.parametrize("seed,_expected", _GRADE_SEEDS)
def test_fitness_is_correctness_times_efficiency(seed, _expected):
    """Guards the C-prime composition: fitness = correctness x efficiency."""
    resp = _summon(seed)
    assert resp["ok"] is True
    meta = resp["run_metadata"]
    assert resp["fitness"] == pytest.approx(meta["correctness"] * meta["efficiency"])


def test_lower_conformance_yields_lower_fitness_at_equal_efficiency():
    """The point of the whole mechanism: worse output ranks below better output.

    Compares two genomes only when their efficiency matches, so the comparison
    isolates the correctness channel from the tool-call channel.
    """
    by_efficiency: dict[float, list[tuple[float, float]]] = {}
    for seed in range(60):
        resp = _summon(seed)
        if not resp.get("ok"):
            continue
        meta = resp["run_metadata"]
        by_efficiency.setdefault(
            round(meta["efficiency"], 6), []
        ).append((meta["correctness"], resp["fitness"]))

    compared = 0
    for pairs in by_efficiency.values():
        for (c1, f1) in pairs:
            for (c2, f2) in pairs:
                if c1 < c2:
                    assert f1 < f2, "lower correctness must rank below higher"
                    compared += 1
    assert compared > 0, "no equal-efficiency pairs with differing correctness found"
