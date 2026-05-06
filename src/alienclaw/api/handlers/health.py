from __future__ import annotations

import time as _time

from ..types import HealthResponse

_SERVER_VERSION = "1.0.0"
_START_TIME = _time.monotonic()


def handle_health() -> tuple[int, HealthResponse]:
    """GET /v1/health — server health check."""
    uptime = int(_time.monotonic() - _START_TIME)
    return 200, HealthResponse(
        status="ok",
        version=_SERVER_VERSION,
        uptime_seconds=uptime,
    )
