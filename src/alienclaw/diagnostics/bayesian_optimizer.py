"""Bayesian optimization for fitness formula hyperparameter selection.

Uses scikit-learn's GaussianProcessRegressor with Matern kernel and
Expected Improvement acquisition function to find the hyperparameter
value (α or β) that maximizes a quality objective.

Validated on a simple hill function before use on real objectives.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import Matern


@dataclass
class BayesOptResult:
    """Result of Bayesian optimization."""
    best_x: float
    best_y: float
    evaluation_history: list[tuple[float, float]] = field(default_factory=list)
    n_evaluations: int = 0


def _normal_cdf(z: np.ndarray) -> np.ndarray:
    """Standard normal CDF via scipy.special.ndtr (stable implementation)."""
    from scipy.special import ndtr
    return ndtr(z)


def _normal_pdf(z: np.ndarray) -> np.ndarray:
    """Standard normal PDF."""
    return np.exp(-0.5 * z**2) / math.sqrt(2 * math.pi)


def _expected_improvement(
    candidate_xs: np.ndarray,
    gp: GaussianProcessRegressor,
    best_y: float,
    xi: float = 0.01,
) -> np.ndarray:
    """Expected Improvement acquisition function.

    Args:
        candidate_xs: (n, 1) array of candidate x values
        gp: fitted GaussianProcessRegressor
        best_y: best y value observed so far
        xi: exploration parameter (default 0.01)

    Returns:
        EI values for each candidate
    """
    mu, sigma = gp.predict(candidate_xs, return_std=True)
    sigma = np.maximum(sigma, 1e-9)
    z = (mu - best_y - xi) / sigma
    ei = (mu - best_y - xi) * _normal_cdf(z) + sigma * _normal_pdf(z)
    ei[sigma < 1e-9] = 0.0
    return ei


def bayesian_optimize(
    objective: Callable[[float], float],
    bounds: tuple[float, float],
    n_initial: int = 5,
    n_total: int = 15,
    rng_seed: int = 42,
    n_candidates: int = 200,
) -> BayesOptResult:
    """Maximize objective(x) over [bounds[0], bounds[1]].

    Args:
        objective: function to maximize; x → y (higher y = better)
        bounds: (lower, upper) bounds for x
        n_initial: random samples before GP-driven search
        n_total: total evaluations (random + GP-driven)
        rng_seed: for reproducibility
        n_candidates: number of candidate points for EI maximization

    Returns:
        BayesOptResult with best x, best y, and full evaluation history
    """
    rng = np.random.RandomState(rng_seed)
    history: list[tuple[float, float]] = []

    # Initial random samples (uniform)
    lo, hi = bounds
    initial_xs = rng.uniform(lo, hi, size=n_initial)
    for x in initial_xs:
        y = objective(float(x))
        history.append((float(x), float(y)))

    # GP-driven optimization
    kernel = Matern(length_scale=1.0, nu=2.5)

    for _ in range(n_total - n_initial):
        X_obs = np.array([[h[0]] for h in history])
        y_obs = np.array([h[1] for h in history])

        # Normalize y for GP stability
        y_mean, y_std = float(np.mean(y_obs)), float(np.std(y_obs))
        if y_std < 1e-8:
            # All observations equal; fall back to random
            x_next = float(rng.uniform(lo, hi))
        else:
            y_norm = (y_obs - y_mean) / y_std
            gp = GaussianProcessRegressor(
                kernel=kernel, n_restarts_optimizer=3,
                random_state=rng_seed, normalize_y=False,
            )
            gp.fit(X_obs, y_norm)

            candidates = np.linspace(lo, hi, n_candidates).reshape(-1, 1)
            best_y_norm = float(y_norm.max())
            ei = _expected_improvement(candidates, gp, best_y_norm)
            x_next = float(candidates[np.argmax(ei)][0])

        y_next = objective(x_next)
        history.append((x_next, float(y_next)))

    best = max(history, key=lambda h: h[1])
    return BayesOptResult(
        best_x=best[0],
        best_y=best[1],
        evaluation_history=history,
        n_evaluations=len(history),
    )
