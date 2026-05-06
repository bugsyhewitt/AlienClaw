from __future__ import annotations

from ..storage import SubmissionStore
from ..types import MartianTypeInfo, MartianTypesResponse


def handle_martian_types(
    registered_types: set[str],
    store: SubmissionStore,
) -> tuple[int, MartianTypesResponse]:
    """GET /v1/martian-types — list all registered types."""
    infos: list[MartianTypeInfo] = []
    for mtype in sorted(registered_types):
        top = store.top_for_type(mtype, n=1)
        total = store.count_for_type(mtype)
        top_fitness = top[0]["fitness"] if top else 0.0
        last_at = top[0]["submitted_at"] if top else ""
        infos.append(MartianTypeInfo(
            name=mtype,
            current_top_fitness=top_fitness,
            submission_count=total,
            last_submission_at=last_at,
        ))
    return 200, MartianTypesResponse(martian_types=infos, total=len(infos))
