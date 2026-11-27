"""PKT-1415: regression guards against silent non-finite acceptance in
   diagnostics/instrumentation.py recorders."""
import json
import math
from dataclasses import asdict

import pytest

from alienclaw_ga.diagnostics.instrumentation import (
    CaptureHook,
    record_fitness,
    record_genome,
    record_runner_result,
)


@pytest.fixture(autouse=True)
def _enable_diagnostics(monkeypatch):
    monkeypatch.setenv("ALIENCLAW_DIAGNOSTICS", "1")


class TestRecordFitnessNonFinite:
    def test_record_fitness_nan_coerced_to_zero(self):
        with CaptureHook() as hook:
            record_fitness(float("nan"))
        assert hook.trace().fitness == 0.0
        assert math.isfinite(hook.trace().fitness)

    def test_record_fitness_pos_inf_coerced_to_zero(self):
        with CaptureHook() as hook:
            record_fitness(float("inf"))
        assert hook.trace().fitness == 0.0

    def test_record_fitness_neg_inf_coerced_to_zero(self):
        with CaptureHook() as hook:
            record_fitness(-float("inf"))
        assert hook.trace().fitness == 0.0

    def test_record_fitness_finite_unchanged(self):
        """Regression: benign finite values pass through unchanged."""
        for v in (0.0, 0.5, 1.0, 0.123456789):
            with CaptureHook() as hook:
                record_fitness(v)
            assert hook.trace().fitness == v


class TestRecordRunnerResultNonFinite:
    def test_correctness_nan_coerced_to_zero(self):
        with CaptureHook() as hook:
            record_runner_result({}, None, float("nan"), 1)
        assert hook.trace().correctness == 0.0
        assert math.isfinite(hook.trace().correctness)

    def test_correctness_finite_unchanged(self):
        with CaptureHook() as hook:
            record_runner_result({}, None, 0.42, 1)
        assert hook.trace().correctness == 0.42


class TestEndToEndJsonEmission:
    def test_json_dumps_strict_round_trip_after_non_finite(self):
        """End-to-end: capture a non-finite fitness; ensure strict
           json.dumps(allow_nan=False) succeeds (RFC 8259 compliant)."""
        with CaptureHook() as hook:
            record_genome("AAAA", "compute", {})
            record_runner_result({}, None, 0.5, 1)
            record_fitness(float("nan"))
        d = asdict(hook.trace())
        # Strict mode: raises ValueError on NaN/Inf; we expect NO raise.
        json.dumps(d, allow_nan=False)
