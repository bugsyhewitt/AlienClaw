"""Per-install token bucket rate limiting.

In-memory for v1 — server restart resets buckets. This is documented in
deferred.md as a v1 limitation. At Packet 10 scale (one operator), restarts
are rare enough that this is not a material issue.

Per spec: 100 submissions per install per hour (rolling 3600s window).
Only POST /v1/genomes counts against the bucket.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

_LIMIT = 100
_WINDOW = 3600  # seconds


class RateLimiter:
    def __init__(self, limit: int = _LIMIT, window_seconds: int = _WINDOW):
        self._limit = limit
        self._window = window_seconds
        self._buckets: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, install_id: str) -> tuple[bool, int]:
        """Check if the install may proceed.

        Returns (allowed, retry_after_seconds).
        retry_after_seconds is 0 when allowed.
        """
        now = time.monotonic()
        cutoff = now - self._window
        with self._lock:
            bucket = self._buckets[install_id]
            # Evict expired
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= self._limit:
                # Retry after oldest entry expires
                oldest = bucket[0]
                retry_after = int(oldest + self._window - now) + 1
                return False, retry_after
            bucket.append(now)
            return True, 0

    def remaining(self, install_id: str) -> int:
        now = time.monotonic()
        cutoff = now - self._window
        with self._lock:
            bucket = self._buckets[install_id]
            count = sum(1 for ts in bucket if ts > cutoff)
            return max(0, self._limit - count)
