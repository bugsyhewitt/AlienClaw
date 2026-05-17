from __future__ import annotations

from typing import TYPE_CHECKING

from ..storage import SubmissionStore
from ..types import (GenomeEntry, SubmissionRequest, SubmissionResponse,
                     TopGenomesResponse)
from ..validation import validate_submission

if TYPE_CHECKING:
    from ..audit_log import AuditLog


def handle_submit_genome(
    req: SubmissionRequest,
    api_key_hash: str,
    store: SubmissionStore,
    registered_types: set[str],
    audit_log: "AuditLog | None" = None,
    client_ip: str = "unknown",
) -> tuple[int, SubmissionResponse]:
    """POST /v1/genomes — submit a genome."""
    v = validate_submission(req, registered_types)
    if not v.valid:
        # Log rejected submission before raising
        if audit_log is not None:
            audit_log.record(
                api_key_hash=api_key_hash,
                martian_type=req.martian_type,
                genome=req.genome,
                fitness=req.fitness,
                result="rejected",
                rejection_code=v.error.code if v.error else "UNKNOWN",
                client_ip=client_ip,
            )
        raise ValueError(v.error)

    # Duplicate suppression (24-hour window)
    dup = store.find_duplicate(req.genome, req.martian_type, req.fitness, api_key_hash)
    if dup:
        rank = store.rank_for_fitness(req.martian_type, req.fitness)
        if audit_log is not None:
            audit_log.record(
                api_key_hash=api_key_hash,
                martian_type=req.martian_type,
                genome=req.genome,
                fitness=req.fitness,
                result="accepted",
                rejection_code=None,
                client_ip=client_ip,
            )
        return 200, SubmissionResponse(
            submission_id=dup["submission_id"],
            submitted_at=dup["submitted_at"],
            rank=rank,
            is_new_top=store.is_new_top(req.martian_type, req.fitness),
        )

    is_top = store.is_new_top(req.martian_type, req.fitness)
    sid, submitted_at = store.save(
        req.genome, req.martian_type, req.fitness,
        api_key_hash, req.run_metadata,
        leaderboard_name=req.leaderboard_name,
    )
    rank = store.rank_for_fitness(req.martian_type, req.fitness)

    if audit_log is not None:
        audit_log.record(
            api_key_hash=api_key_hash,
            martian_type=req.martian_type,
            genome=req.genome,
            fitness=req.fitness,
            result="accepted",
            rejection_code=None,
            client_ip=client_ip,
        )

    return 201, SubmissionResponse(
        submission_id=sid,
        submitted_at=submitted_at,
        rank=rank,
        is_new_top=is_top,
    )


def handle_top_genomes(
    martian_type: str,
    n: int,
    store: SubmissionStore,
    registered_types: set[str],
) -> tuple[int, TopGenomesResponse]:
    """GET /v1/genomes/top — fetch top-N genomes for a martian_type."""
    if martian_type not in registered_types:
        raise LookupError(f"UNKNOWN_MARTIAN_TYPE:{martian_type}")
    n = max(1, min(100, n))
    entries_raw = store.top_for_type(martian_type, n=n)
    total = store.count_for_type(martian_type)
    entries = [
        GenomeEntry(
            genome=e["genome"],
            fitness=e["fitness"],
            submission_id=e["submission_id"],
            submitted_at=e["submitted_at"],
            leaderboard_name=e.get("leaderboard_name", ""),
            generation=e.get("run_metadata", {}).get("generation"),
        )
        for e in entries_raw
    ]
    return 200, TopGenomesResponse(
        martian_type=martian_type,
        genomes=entries,
        total_for_type=total,
    )
