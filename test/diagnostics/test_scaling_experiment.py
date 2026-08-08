"""Tests for scaling_experiment.py."""
from __future__ import annotations

import pytest

from alienclaw.diagnostics.fitness_formula_candidates import option_b
from alienclaw.diagnostics.scaling_experiment import (
    sample_landscape, compute_dynamics_summary,
)


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


class TestSampleLandscape:
    def test_returns_expected_structure(self):
        result = sample_landscape(
            martian_type="compute_alone",
            inputs={"input": "2 + 2"},
            formula_fn=option_b,
            slot_count=1,
            n_genomes=5,
            seeds=[42],
        )
        assert "records" in result
        assert "summary" in result
        assert result["slot_count"] == 1

    def test_correct_record_count(self):
        result = sample_landscape(
            martian_type="compute_alone",
            inputs={"input": "2 + 2"},
            formula_fn=option_b,
            slot_count=1,
            n_genomes=10,
            seeds=[42],
        )
        assert result["n_genomes"] == 10

    def test_records_have_required_fields(self):
        result = sample_landscape(
            martian_type="compute_alone",
            inputs={"input": "2 + 2"},
            formula_fn=option_b,
            slot_count=1,
            n_genomes=5,
            seeds=[42],
        )
        for rec in result["records"]:
            assert "genome" in rec
            assert "formula_fitness" in rec
            assert "correctness" in rec
            assert "tool_calls" in rec

    def test_option_b_single_slot_fitness_non_negative(self):
        """option_b with single-slot compute should give non-negative fitness."""
        result = sample_landscape(
            martian_type="compute_alone",
            inputs={"input": "2 + 2"},
            formula_fn=option_b,
            slot_count=1,
            n_genomes=5,
            seeds=[42],
        )
        assert result["summary"]["mean_formula_fitness"] >= 0.0
        assert result["summary"]["max_formula_fitness"] <= 1.0

    def test_summary_fields_present(self):
        result = sample_landscape(
            martian_type="compute_alone",
            inputs={"input": "2 + 2"},
            formula_fn=option_b,
            slot_count=1,
            n_genomes=5,
            seeds=[42],
        )
        for key in ("mean_formula_fitness", "max_formula_fitness", "n_unique_fitnesses", "fitness_range"):
            assert key in result["summary"]

    def test_formula_name_matches_input_formula(self):
        """sample_landscape returns formula_name matching the requested formula_fn."""
        from alienclaw.diagnostics.fitness_formula_candidates import (
            option_b, option_current, option_c_prime,
        )
        result = sample_landscape(
            martian_type="compute_alone",
            inputs={"input": "2 + 2"},
            formula_fn=option_b,
            slot_count=1,
            n_genomes=3,
            seeds=[42],
        )
        assert result["formula_name"] == "option_b", (
            f"formula_name should match the requested formula_fn; got {result['formula_name']!r}"
        )

    def test_formula_name_differs_per_formula(self):
        """Passing two different formulas returns two different formula_name values."""
        from alienclaw.diagnostics.fitness_formula_candidates import option_b, option_current
        r_b = sample_landscape(
            martian_type="compute_alone",
            inputs={"input": "2 + 2"},
            formula_fn=option_b,
            slot_count=1,
            n_genomes=2,
            seeds=[42],
        )
        r_c = sample_landscape(
            martian_type="compute_alone",
            inputs={"input": "2 + 2"},
            formula_fn=option_current,
            slot_count=1,
            n_genomes=2,
            seeds=[42],
        )
        assert r_b["formula_name"] == "option_b"
        assert r_c["formula_name"] == "option_current"
        assert r_b["formula_name"] != r_c["formula_name"]


class TestComputeDynamicsSummary:
    def test_empty_results_returns_zero_summary(self):
        from alienclaw.diagnostics.dynamics_summary import DynamicsSummary
        result = compute_dynamics_summary([], 100)
        assert isinstance(result, DynamicsSummary)
