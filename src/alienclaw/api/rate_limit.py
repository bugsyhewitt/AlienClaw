"""Per-install token bucket rate limiting — flat-file persistent.

Storage layout:
    $ALIENCLAW_API_DATA_ROOT/rate_limit/<hash[:2]>/<hash>.json

File contents (per install):
    {"install_id": "<sha256>", "window_timestamps": ["<ISO>", ...]}

Server restart no longer resets buckets. Rolling-window pruning keeps
file sizes bounded (only timestamps within the last window are retained).

Per spec: 100 submissions per install per hour (rolling 3600s window).
Only POST /v1/genomes counts against the bucket.

Concurrency: per-install threading.Lock prevents concurrent requests
from the same install double-counting. In-memory cache is the primary
state; disk is the persistence layer loaded lazily on first use.
"""
from __future__ import annotations

import json
import os
import tempfile
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

_LIMIT = 100
_WINDOW = 3600  # seconds


def _iso_to_ts(iso: str) -> float:
    return datetime.fromisoformat(iso).timestamp()


class RateLimiter:
    def __init__(
        self,
        limit: int = _LIMIT,
        window_seconds: int = _WINDOW,
        data_root: Path | None = None,
    ):
        self._limit = limit
        self._window = window_seconds
        self._data_root = data_root
        # In-memory cache: install_id → list[float unix timestamps]
        # Primary state; disk is the persistence layer (lazy-loaded once per instance).
        self._cache: dict[str, list[float]] = {}
        self._cache_loaded: set[str] = set()
        # Per-install locks for thread safety
        self._locks: dict[str, Lock] = defaultdict(Lock)
        self._meta_lock = Lock()

    def _lock_for(self, install_id: str) -> Lock:
        with self._meta_lock:
            return self._locks[install_id]

    def _file_path(self, install_id: str) -> Path | None:
        if self._data_root is None:
            return None
        return self._data_root / "rate_limit" / install_id[:2] / f"{install_id}.json"

    def _ensure_loaded(self, install_id: str) -> None:
        """Lazy-load timestamps from disk into cache (once per instance lifetime)."""
        if install_id in self._cache_loaded:
            return
        self._cache_loaded.add(install_id)
        path = self._file_path(install_id)
        if path is None or not path.exists():
            self._cache.setdefault(install_id, [])
            return
        try:
            with open(path, encoding="utf-8") as f:
                data: dict[str, Any] = json.load(f)
            self._cache[install_id] = [_iso_to_ts(iso) for iso in data.get("window_timestamps", [])]
        except Exception:
            self._cache.setdefault(install_id, [])

    def _persist(self, install_id: str, timestamps: list[float]) -> None:
        """Write timestamps to disk atomically. Silently ignores errors."""
        path = self._file_path(install_id)
        if path is None:
            return
        iso_list = [
            datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            for ts in sorted(timestamps)
        ]
        data = {"install_id": install_id, "window_timestamps": iso_list}
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(data, f, sort_keys=True)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(tmp, path)
            except Exception:
                try:
                    os.unlink(tmp)
                except FileNotFoundError:
                    pass
                raise
        except Exception:
            pass  # persistence failure is silent; in-memory state still works

    def check(self, install_id: str) -> tuple[bool, int]:
        """Check if the install may submit.

        Returns (allowed, retry_after_seconds).
        retry_after_seconds is 0 when allowed.
        """
        lock = self._lock_for(install_id)
        with lock:
            self._ensure_loaded(install_id)
            now = time.time()
            cutoff = now - self._window
            # Prune expired entries
            timestamps = [ts for ts in self._cache.get(install_id, []) if ts > cutoff]

            if len(timestamps) >= self._limit:
                oldest = min(timestamps)
                retry_after = int(oldest + self._window - now) + 1
                self._cache[install_id] = timestamps
                return False, max(1, retry_after)

            timestamps.append(now)
            self._cache[install_id] = timestamps
            self._persist(install_id, timestamps)
            return True, 0

    def remaining(self, install_id: str) -> int:
        lock = self._lock_for(install_id)
        with lock:
            self._ensure_loaded(install_id)
            now = time.time()
            cutoff = now - self._window
            timestamps = [ts for ts in self._cache.get(install_id, []) if ts > cutoff]
            return max(0, self._limit - len(timestamps))
