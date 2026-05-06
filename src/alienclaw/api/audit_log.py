"""Submission audit log — append-only JSONL with daily rollover.

Storage layout:
    $ALIENCLAW_API_DATA_ROOT/audit/submissions-YYYY-MM-DD.jsonl

Each line (one JSON object):
    {
      "ts":             "<ISO 8601 UTC>",
      "api_key_hash":   "<sha256 hex — NEVER the raw key>",
      "client_ip":      "<IP string or 'unknown'>",
      "martian_type":   "<type>",
      "genome_sha256":  "<sha256 hex of submitted genome>",
      "fitness":        <float>,
      "result":         "accepted" | "rejected",
      "rejection_code": "<spec error code or null>"
    }

Write discipline:
- open() in append mode ('a') — POSIX O_APPEND guarantees atomic appends
  for writes smaller than PIPE_BUF (4096 bytes on Linux). Each log line
  is <512 bytes, well within the limit.
- fsync after each write to ensure the line reaches disk.
- Failures log to stderr and do NOT block the submission — audit failure
  is loud but non-blocking.

NEVER logs raw API keys. NEVER logs full genome content.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class AuditLog:
    """Append-only JSONL submission audit log."""

    def __init__(self, data_root: Path | None = None):
        self._root = data_root

    def _log_path(self, date_str: str | None = None) -> Path | None:
        if self._root is None:
            return None
        d = date_str or _today_utc()
        return self._root / "audit" / f"submissions-{d}.jsonl"

    def record(
        self,
        api_key_hash: str,
        martian_type: str,
        genome: str,
        fitness: float,
        result: str,
        rejection_code: str | None = None,
        client_ip: str = "unknown",
    ) -> None:
        """Append one log entry. Failures print to stderr; never raise."""
        path = self._log_path()
        if path is None:
            return

        entry: dict[str, Any] = {
            "ts":             _now_iso(),
            "api_key_hash":   api_key_hash,
            "client_ip":      client_ip or "unknown",
            "martian_type":   martian_type,
            "genome_sha256":  _sha256(genome),
            "fitness":        fitness,
            "result":         result,
            "rejection_code": rejection_code,
        }
        line = json.dumps(entry, sort_keys=True) + "\n"

        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "a", encoding="utf-8") as f:
                f.write(line)
                f.flush()
                os.fsync(f.fileno())
        except Exception as exc:
            print(f"[audit_log] WARNING: failed to write entry: {exc}", file=sys.stderr)
