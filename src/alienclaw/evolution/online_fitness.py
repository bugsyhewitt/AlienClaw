"""Online fitness log — append-only JSONL keyed by martian_type.

Records observed runtime fitness from live campaign execution.
Isolated from Population storage — never imported by population.py.
"""
from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

_DEFAULT_PATH = Path.home() / ".alienclaw" / "online_fitness.jsonl"


class OnlineFitnessLog:
    """Append-only log of observed runtime fitness, separate from evolved Population fitness."""

    def __init__(self, path: str | Path | None = None) -> None:
        self._path = Path(path) if path is not None else _DEFAULT_PATH
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def record(self, martian_type: str, fitness: float) -> None:
        """Append one fitness observation."""
        if not math.isfinite(fitness):
            print(
                f"[online-fitness] WARNING: dropped non-finite fitness "
                f"(martian_type={martian_type!r}, fitness={fitness!r})",
                file=sys.stderr,
            )
            return
        entry = {
            "martian_type": martian_type,
            "fitness": fitness,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        with self._path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry) + "\n")

    def read(self) -> list[dict]:
        """Return all recorded entries, oldest first."""
        if not self._path.exists():
            return []
        result: list[dict] = []
        with self._path.open(encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                try:
                    result.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return result

    def clear(self) -> None:
        """Delete the log file (for tests / maintenance)."""
        if self._path.exists():
            self._path.unlink()
