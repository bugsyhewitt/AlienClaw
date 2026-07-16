"""Governance gate for the evolution loop.

Consulted after each generation; returns a GateDecision that approves
continuation or halts cleanly. Halting leaves the Martian population
persisted on disk (storage.py), so the run resumes via
Population.load / Population.load_or_create.

Python-side seam: the production gate adapts the TypeScript governance
decision (BossBot / AdvisorBot review) through the bridge, as run_martian
adapts the summon bridge. Tests inject a deterministic stub.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from .types import GenerationStats


@dataclass(frozen=True)
class GateDecision:
    """Outcome of a governance review for one generation."""

    approved: bool
    reason: str = ""


class GovernanceGate(Protocol):
    """Consulted after each generation; approves continuation or halts."""

    def review(self, generation: int, stats: GenerationStats) -> GateDecision:
        ...
