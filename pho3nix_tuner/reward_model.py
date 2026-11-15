"""Offline reward model for Pho3nix run-history entries.

Derives a scalar reward from existing run_history fields:
  - success (bool)   — primary signal
  - timed_out (bool) — negative: tool hung, rate limit was likely hit
  - partial_results  — minor negative: completed but incomplete

For a candidate config NOT in the history, estimates reward via distance-weighted
k-NN over logged param-vectors within the same (tool, context_key) bucket, then
Bayesian-shrinks toward the context global mean when support is thin.

Mirroring ToolStatsStore's methodology:
  BAYES_PRIOR_STRENGTH = 6.0  (same as pho3nix's value)
  RECENCY_HALF_LIFE_DAYS = 21.0
  MIN_SUPPORT = 5  (below this, estimate shrinks aggressively toward global mean)
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Reward formula constants
# ---------------------------------------------------------------------------

REWARD_SUCCESS = 1.0
REWARD_TIMED_OUT = -0.5
REWARD_PARTIAL = -0.1
REWARD_FAIL = 0.0

# Bayesian prior (matches ToolStatsStore's BAYES_PRIOR_STRENGTH)
BAYES_PRIOR_STRENGTH = 6.0
BAYES_PRIOR_MEAN = 0.3   # pessimistic global prior on unknown params

# Recency half-life in days (matches ToolStatsStore's RECENCY_HALF_LIFE_DAYS)
RECENCY_HALF_LIFE_DAYS = 21.0

# k-NN config
K_NEIGHBORS = 5
MIN_SUPPORT = 5          # below this many in-context neighbors, shrink heavily

# Target tools (must match inspect_history.py)
TARGET_TOOLS = {"nmap", "gobuster", "sqlmap"}


def compute_reward(entry: dict) -> float | None:
    """Compute scalar reward for a single run_history entry.

    Returns None for entries whose tool is not in TARGET_TOOLS.
    Returns a float in [REWARD_TIMED_OUT, REWARD_SUCCESS] otherwise.
    """
    tool = entry.get("tool", "?")
    if tool not in TARGET_TOOLS:
        return None

    r = REWARD_FAIL
    if entry.get("success"):
        r = REWARD_SUCCESS
    if entry.get("timed_out"):
        r += REWARD_TIMED_OUT
    if entry.get("partial_results"):
        r += REWARD_PARTIAL
    return float(max(-1.0, min(1.0, r)))


def _context_key(entry: dict) -> str:
    """Derive context key (mirrors inspect_history._context_key)."""
    endpoint = entry.get("endpoint") or ""
    tool = entry.get("tool", "?")
    if endpoint.startswith("https://"):
        scheme = "https"
    elif endpoint.startswith("http://"):
        scheme = "http"
    elif endpoint.startswith("ftp://"):
        scheme = "ftp"
    elif endpoint:
        scheme = "raw"
    else:
        scheme = "unknown"
    return f"{tool}|{scheme}"


def _recency_weight(ts_str: str, now: datetime) -> float:
    """Compute recency weight [0, 1] using exponential decay over RECENCY_HALF_LIFE_DAYS.

    Returns 1.0 if timestamp is unparseable (treat as recent).
    """
    if not ts_str:
        return 1.0
    try:
        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        age_days = (now - ts).total_seconds() / 86400.0
        return math.exp(-age_days * math.log(2.0) / RECENCY_HALF_LIFE_DAYS)
    except Exception:
        return 1.0


def _param_vector(entry: dict) -> dict[str, Any]:
    """Extract numeric/integer params from a run_history entry."""
    params = entry.get("params") or {}
    result: dict[str, Any] = {}
    for k, v in params.items():
        if isinstance(v, (int, float)):
            result[k] = float(v)
        elif isinstance(v, str):
            # Parse delay strings like "1s", "0.5s"
            if v.endswith("s"):
                try:
                    result[k] = float(v[:-1])
                except ValueError:
                    pass
            else:
                try:
                    result[k] = float(v)
                except ValueError:
                    pass
    return result


def _param_distance(a: dict[str, float], b: dict[str, float]) -> float:
    """L2 distance over shared keys; large (1e6) if no shared keys."""
    shared = set(a.keys()) & set(b.keys())
    if not shared:
        return 1e6
    sq = sum((a[k] - b[k]) ** 2 for k in shared)
    return math.sqrt(sq)


class RewardModel:
    """Offline reward model fit from imported rig run-history.

    Usage:
        model = RewardModel.from_file(Path("pho3nix_tuner/data/run_history.xil-1.json"))
        reward = model.estimate("gobuster", "gobuster|https", {"threads": 15, "delay_ms": 200})
    """

    def __init__(self, entries: list[dict]) -> None:
        self._now = datetime.now(tz=timezone.utc)
        # Index by context_key → list of (param_vector, reward, recency_weight)
        self._index: dict[str, list[tuple[dict, float, float]]] = defaultdict(list)
        self._global_mean: float = BAYES_PRIOR_MEAN

        rewards = []
        for entry in entries:
            r = compute_reward(entry)
            if r is None:
                continue
            ctx = _context_key(entry)
            pvec = _param_vector(entry)
            ts_str = entry.get("timestamp", "")
            w = _recency_weight(ts_str, self._now)
            self._index[ctx].append((pvec, r, w))
            rewards.append(r)

        if rewards:
            self._global_mean = sum(rewards) / len(rewards)

    @classmethod
    def from_file(cls, path: Path) -> "RewardModel":
        with path.open() as f:
            data = json.load(f)
        entries = data if isinstance(data, list) else data.get("entries", data.get("runs", []))
        return cls(entries)

    def estimate(
        self,
        tool: str,  # noqa: ARG002 (kept for API symmetry)
        context_key: str,
        candidate_params: dict[str, float],
    ) -> float:
        """Estimate reward for a candidate param vector in a given context.

        Uses recency-weighted k-NN within the context bucket, then Bayesian-shrinks
        toward the context global mean when neighbor count < MIN_SUPPORT.

        Returns BAYES_PRIOR_MEAN when the context bucket is empty.
        """
        bucket = self._index.get(context_key, [])
        if not bucket:
            return self._global_mean

        # Sort by distance to candidate
        with_dist = [
            (pvec, r, w, _param_distance(candidate_params, pvec))
            for pvec, r, w in bucket
        ]
        with_dist.sort(key=lambda x: x[3])
        neighbors = with_dist[:K_NEIGHBORS]

        # Recency-weighted average of k nearest rewards
        total_w = sum(w * max(0.0, 1.0 - d / (d + 1.0)) for _, _, w, d in neighbors)
        if total_w < 1e-9:
            # All neighbors at infinite distance — fall back
            weighted_mean = sum(r for _, r, _, _ in neighbors) / len(neighbors)
        else:
            weighted_mean = sum(
                r * w * max(0.0, 1.0 - d / (d + 1.0))
                for _, r, w, d in neighbors
            ) / total_w

        # Bayesian shrinkage toward context global mean
        n = len(bucket)
        context_mean = sum(r for _, r, _ in bucket) / n
        shrink_factor = n / (n + BAYES_PRIOR_STRENGTH)
        if n < MIN_SUPPORT:
            # Heavy shrinkage: blend heavily with global prior
            shrink_factor = n / (n + BAYES_PRIOR_STRENGTH * 3.0)

        return float(shrink_factor * weighted_mean + (1.0 - shrink_factor) * context_mean)

    def context_mean(self, context_key: str) -> float:
        """Global mean reward for a context bucket (or prior mean if empty)."""
        bucket = self._index.get(context_key, [])
        if not bucket:
            return self._global_mean
        return sum(r for _, r, _ in bucket) / len(bucket)

    def context_support(self, context_key: str) -> int:
        """Number of entries in this context bucket."""
        return len(self._index.get(context_key, []))

    @property
    def global_mean(self) -> float:
        return self._global_mean

    @property
    def context_keys(self) -> list[str]:
        return list(self._index.keys())
