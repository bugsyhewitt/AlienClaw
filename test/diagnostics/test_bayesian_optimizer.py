"""Tests for bayesian_optimizer.py."""
from __future__ import annotations

import pytest

from alienclaw.diagnostics.bayesian_optimizer import bayesian_optimize, BayesOptResult


class TestBayesianOptimize:
    def test_maximizes_hill_function(self):
        """BO should find the maximum of a simple hill function."""
        def hill(x: float) -> float:
            return -(x - 2.0) ** 2 + 5.0  # peak at x=2, value=5

        result = bayesian_optimize(hill, bounds=(0.0, 5.0), n_initial=5, n_total=15)
        assert result.best_x == pytest.approx(2.0, abs=0.3)
        assert result.best_y == pytest.approx(5.0, abs=0.2)

    def test_result_type(self):
        def f(x): return -x**2
        result = bayesian_optimize(f, bounds=(-2.0, 2.0), n_initial=3, n_total=8)
        assert isinstance(result, BayesOptResult)
        assert isinstance(result.best_x, float)
        assert isinstance(result.best_y, float)

    def test_evaluation_count(self):
        def f(x): return x
        result = bayesian_optimize(f, bounds=(0.0, 1.0), n_initial=4, n_total=10)
        assert result.n_evaluations == 10
        assert len(result.evaluation_history) == 10

    def test_best_is_max(self):
        """best_y should equal the maximum y in evaluation history."""
        def f(x): return -abs(x - 0.7)
        result = bayesian_optimize(f, bounds=(0.0, 1.0), n_initial=5, n_total=12)
        max_y = max(h[1] for h in result.evaluation_history)
        assert result.best_y == pytest.approx(max_y, abs=1e-9)

    def test_constant_objective(self):
        """Constant objective doesn't crash (all evaluations equal)."""
        def f(x): return 1.0
        result = bayesian_optimize(f, bounds=(0.0, 1.0), n_initial=3, n_total=8)
        assert result.best_y == pytest.approx(1.0)

    def test_reproducible_with_seed(self):
        def f(x): return -x**2 + 3*x
        result1 = bayesian_optimize(f, bounds=(0.0, 5.0), n_initial=4, n_total=10, rng_seed=42)
        result2 = bayesian_optimize(f, bounds=(0.0, 5.0), n_initial=4, n_total=10, rng_seed=42)
        assert result1.best_x == pytest.approx(result2.best_x)
        assert result1.best_y == pytest.approx(result2.best_y)

    def test_bounds_respected(self):
        """All evaluated x values must be within bounds."""
        def f(x): return x
        bounds = (0.5, 1.5)
        result = bayesian_optimize(f, bounds=bounds, n_initial=4, n_total=10)
        for x, _ in result.evaluation_history:
            assert bounds[0] <= x <= bounds[1], f"x={x} out of bounds {bounds}"

    def test_monotone_objective(self):
        """Maximizing a monotone function finds the upper bound."""
        def f(x): return x  # maximum at right boundary
        result = bayesian_optimize(f, bounds=(0.0, 1.0), n_initial=3, n_total=12)
        assert result.best_x > 0.7  # should converge toward 1.0
