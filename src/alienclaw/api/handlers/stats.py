from __future__ import annotations

from ..storage import GlobalStats, InstallStore
from ..types import StatsResponse


def handle_stats(
    stats_store: GlobalStats,
    install_store: InstallStore,
) -> tuple[int, StatsResponse]:
    """GET /v1/stats — aggregated statistics."""
    raw = stats_store.get()
    return 200, StatsResponse(
        total_genomes=raw.get("total_genomes", 0),
        total_installs=raw.get("total_installs", 0),
        total_fitness_evaluations=raw.get("total_fitness_evaluations", 0),
        top_fitness_by_type=raw.get("top_fitness_by_type", {}),
    )
