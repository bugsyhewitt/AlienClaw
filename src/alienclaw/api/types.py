"""Request/response dataclasses for all 6 API endpoints.

Mirrors LEADERBOARD_API_SPEC.md v1.0 exactly.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


# ── Install ──────────────────────────────────────────────────────────────────

@dataclass
class InstallRequest:
    api_key: str       # 43-char Base62
    machine_hash: str  # 64-char hex SHA-256


@dataclass
class RateLimitInfo:
    submissions_per_hour: int = 100
    window_seconds: int = 3600


@dataclass
class InstallResponse:
    status: str         # "registered" | "known"
    install_id: str
    rate_limit: RateLimitInfo = field(default_factory=RateLimitInfo)


# ── Genome submission ─────────────────────────────────────────────────────────

@dataclass
class SubmissionRequest:
    genome: str
    martian_type: str
    fitness: float
    run_metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class SubmissionResponse:
    submission_id: str
    submitted_at: str  # ISO 8601
    rank: int
    is_new_top: bool


# ── Top genomes ───────────────────────────────────────────────────────────────

@dataclass
class GenomeEntry:
    genome: str
    fitness: float
    submission_id: str
    submitted_at: str
    generation: int | None = None


@dataclass
class TopGenomesResponse:
    martian_type: str
    genomes: list[GenomeEntry]
    total_for_type: int


# ── Martian types ─────────────────────────────────────────────────────────────

@dataclass
class MartianTypeInfo:
    name: str
    current_top_fitness: float
    submission_count: int
    last_submission_at: str


@dataclass
class MartianTypesResponse:
    martian_types: list[MartianTypeInfo]
    total: int


# ── Health ────────────────────────────────────────────────────────────────────

@dataclass
class HealthResponse:
    status: str           # "ok" | "degraded"
    version: str
    uptime_seconds: int
    message: str | None = None


# ── Stats ─────────────────────────────────────────────────────────────────────

@dataclass
class StatsResponse:
    total_genomes: int
    total_installs: int
    total_fitness_evaluations: int
    top_fitness_by_type: dict[str, float]


# ── Errors ────────────────────────────────────────────────────────────────────

@dataclass
class APIError:
    code: str
    message: str
    details: dict[str, Any] = field(default_factory=dict)
