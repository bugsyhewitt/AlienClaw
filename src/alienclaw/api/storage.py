"""Flat-file persistence for the API server.

Layout:
    DATA_ROOT/
        genomes/<martian_type>/<submission_id>.json
        installs/<api_key_hash[:8]>/<api_key_hash>.json
        stats/global.json

Atomic writes (tmpfile + rename). Same discipline as Packet 8's population storage.
Reads scan all files for a type — O(n) per query, fine for v1 scale.
"""
from __future__ import annotations

import json
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def data_root() -> Path:
    override = os.environ.get("ALIENCLAW_API_DATA_ROOT")
    if override:
        return Path(override)
    return Path("/var/alienclaw")


def _atomic_write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, sort_keys=True)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try: os.unlink(tmp)
        except FileNotFoundError: pass
        raise


class SubmissionStore:
    def __init__(self, root: Path | None = None):
        self._root = root or data_root()

    def _genome_dir(self, martian_type: str) -> Path:
        return self._root / "genomes" / martian_type

    def save(self, genome: str, martian_type: str, fitness: float,
             api_key_hash: str, run_metadata: dict,
             leaderboard_name: str = "") -> tuple[str, str]:
        """Save a genome submission. Returns (submission_id, submitted_at)."""
        sid = f"sub_{uuid.uuid4().hex[:6]}"
        now = datetime.now(timezone.utc).isoformat()
        data = {
            "submission_id": sid,
            "genome": genome,
            "martian_type": martian_type,
            "fitness": fitness,
            "leaderboard_name": leaderboard_name,
            "api_key_hash": api_key_hash,
            "run_metadata": run_metadata,
            "submitted_at": now,
        }
        path = self._genome_dir(martian_type) / f"{sid}.json"
        _atomic_write(path, data)
        self._update_global_stats(martian_type, fitness,
                                   run_metadata.get("total_task_count", 0))
        return sid, now

    def top_for_type(self, martian_type: str, n: int = 10) -> list[dict]:
        d = self._genome_dir(martian_type)
        if not d.exists():
            return []
        entries = []
        for p in d.iterdir():
            if p.suffix != ".json":
                continue
            try:
                with p.open("r", encoding="utf-8") as f:
                    entries.append(json.load(f))
            except Exception:
                continue
        entries.sort(key=lambda e: e["fitness"], reverse=True)
        return entries[:n]

    def count_for_type(self, martian_type: str) -> int:
        d = self._genome_dir(martian_type)
        if not d.exists():
            return 0
        return sum(1 for p in d.iterdir() if p.suffix == ".json")

    def rank_for_fitness(self, martian_type: str, fitness: float) -> int:
        """1-based rank of this fitness among all submissions (1 = top)."""
        d = self._genome_dir(martian_type)
        if not d.exists():
            return 1
        count_above = 0
        for p in d.iterdir():
            if p.suffix != ".json":
                continue
            try:
                with p.open("r", encoding="utf-8") as f:
                    e = json.load(f)
                if e["fitness"] > fitness:
                    count_above += 1
            except Exception:
                continue
        return count_above + 1

    def is_new_top(self, martian_type: str, fitness: float) -> bool:
        top = self.top_for_type(martian_type, n=1)
        return not top or fitness >= top[0]["fitness"]

    def find_duplicate(self, genome: str, martian_type: str,
                       fitness: float, api_key_hash: str) -> dict | None:
        d = self._genome_dir(martian_type)
        if not d.exists():
            return None
        from datetime import timedelta
        now = datetime.now(timezone.utc)
        cutoff = (now - timedelta(hours=24)).isoformat()
        for p in d.iterdir():
            if p.suffix != ".json":
                continue
            try:
                with p.open("r", encoding="utf-8") as f:
                    e = json.load(f)
                if (e["genome"] == genome and e["fitness"] == fitness
                        and e["api_key_hash"] == api_key_hash
                        and e["submitted_at"] >= cutoff):
                    return e
            except Exception:
                continue
        return None

    def _update_global_stats(self, martian_type: str, fitness: float, task_count: int) -> None:
        path = self._root / "stats" / "global.json"
        try:
            if path.exists():
                with path.open("r", encoding="utf-8") as f:
                    stats = json.load(f)
            else:
                stats = {"total_genomes": 0, "total_fitness_evaluations": 0,
                         "top_fitness_by_type": {}}
            stats["total_genomes"] = stats.get("total_genomes", 0) + 1
            stats["total_fitness_evaluations"] = (
                stats.get("total_fitness_evaluations", 0) + max(0, task_count))
            top = stats.setdefault("top_fitness_by_type", {})
            if fitness > top.get(martian_type, 0.0):
                top[martian_type] = fitness
            _atomic_write(path, stats)
        except Exception:
            pass  # stats update is non-fatal


class InstallStore:
    def __init__(self, root: Path | None = None):
        self._root = root or data_root()

    def _path(self, api_key_hash: str) -> Path:
        return self._root / "installs" / api_key_hash[:2] / f"{api_key_hash}.json"

    def register(self, api_key_hash: str, machine_hash: str) -> tuple[str, bool]:
        """Register or look up an install. Returns (install_id, is_new)."""
        path = self._path(api_key_hash)
        if path.exists():
            with path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            return data["install_id"], False
        install_id = f"inst_{uuid.uuid4().hex[:6]}"
        now = datetime.now(timezone.utc).isoformat()
        data = {
            "install_id": install_id,
            "api_key_hash": api_key_hash,
            "machine_hash": machine_hash,
            "registered_at": now,
        }
        _atomic_write(path, data)
        self._increment_install_count()
        return install_id, True

    def exists(self, api_key_hash: str) -> bool:
        return self._path(api_key_hash).exists()

    def count(self) -> int:
        installs_dir = self._root / "installs"
        if not installs_dir.exists():
            return 0
        return sum(1 for p in installs_dir.rglob("*.json"))

    def _increment_install_count(self) -> None:
        path = self._root / "stats" / "global.json"
        try:
            if path.exists():
                with path.open("r", encoding="utf-8") as f:
                    stats = json.load(f)
            else:
                stats = {}
            stats["total_installs"] = stats.get("total_installs", 0) + 1
            _atomic_write(path, stats)
        except Exception:
            pass


class GlobalStats:
    def __init__(self, root: Path | None = None):
        self._root = root or data_root()

    def get(self) -> dict:
        path = self._root / "stats" / "global.json"
        if path.exists():
            with path.open("r", encoding="utf-8") as f:
                return json.load(f)
        return {"total_genomes": 0, "total_installs": 0,
                "total_fitness_evaluations": 0, "top_fitness_by_type": {}}
