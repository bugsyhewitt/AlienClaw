from __future__ import annotations

from ..auth import hash_api_key
from ..storage import InstallStore
from ..types import InstallRequest, InstallResponse, RateLimitInfo
from ..validation import validate_install_request


def handle_install(req: InstallRequest, store: InstallStore) -> tuple[int, InstallResponse]:
    """POST /v1/install — register an install or refresh existing."""
    v = validate_install_request(req.api_key, req.machine_hash)
    if not v.valid:
        raise ValueError(v.error)

    api_key_hash = hash_api_key(req.api_key)
    install_id, is_new = store.register(api_key_hash, req.machine_hash)

    return (201 if is_new else 200), InstallResponse(
        status="registered" if is_new else "known",
        install_id=install_id,
        rate_limit=RateLimitInfo(),
    )
