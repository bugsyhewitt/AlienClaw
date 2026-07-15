"""Tests for evolution/live_evo.py — threshold-triggered live evolution.

All tests use tmp_path for the online fitness log and watermark file;
no writes to the real ~/.alienclaw/ directory.
bridge_run_martian is monkeypatched to return a deterministic FitnessReport
so no real bridge subprocess is spawned.
"""
from __future__ import annotations

from pathlib import Path

from alienclaw.evolution.generation import FitnessReport
from alienclaw.evolution.live_evo import (
    LIVE_EVO_THRESHOLD,
    _read_watermark,
    _write_watermark,
    check_and_evolve,
)
from alienclaw.evolution.online_fitness import OnlineFitnessLog

# ── helpers ────────────────────────────────────────────────────────────────


def _write_observations(log_path: Path, martian_type: str, count: int) -> None:
    log = OnlineFitnessLog(path=log_path)
    for i in range(count):
        log.record(martian_type, 0.5 + i * 0.01)


def _patch_bridge(monkeypatch, fitness: float = 0.7) -> None:
    from alienclaw.evolution import live_evo as lm
    fixed_report = FitnessReport(fitness=fitness, run_metadata={"ok": True})
    monkeypatch.setattr(lm, "bridge_run_martian", lambda mt, genome: fixed_report, raising=False)
    # Also patch where it's imported inside check_and_evolve's local scope
    import alienclaw.evolution.bridge_runner as br_mod
    monkeypatch.setattr(br_mod, "bridge_run_martian", lambda mt, genome: fixed_report)


# ── watermark helpers ───────────────────────────────────────────────────────


class TestWatermarkHelpers:
    def test_read_watermark_missing_file_returns_zero(self, tmp_path: Path) -> None:
        wpath = tmp_path / "watermarks.json"
        assert _read_watermark("compute", wpath) == 0

    def test_write_then_read_roundtrips(self, tmp_path: Path) -> None:
        wpath = tmp_path / "watermarks.json"
        _write_watermark("compute", 15, wpath)
        assert _read_watermark("compute", wpath) == 15

    def test_watermarks_are_per_type(self, tmp_path: Path) -> None:
        wpath = tmp_path / "watermarks.json"
        _write_watermark("compute", 5, wpath)
        _write_watermark("reason", 12, wpath)
        assert _read_watermark("compute", wpath) == 5
        assert _read_watermark("reason", wpath) == 12
        assert _read_watermark("other", wpath) == 0

    def test_write_watermark_is_idempotent(self, tmp_path: Path) -> None:
        wpath = tmp_path / "watermarks.json"
        _write_watermark("compute", 5, wpath)
        _write_watermark("compute", 10, wpath)
        assert _read_watermark("compute", wpath) == 10


# ── check_and_evolve ────────────────────────────────────────────────────────


class TestCheckAndEvolve:
    def test_below_threshold_returns_none(self, tmp_path: Path, monkeypatch) -> None:
        log_path = tmp_path / "fitness.jsonl"
        wpath    = tmp_path / "watermarks.json"
        _write_observations(log_path, "compute", LIVE_EVO_THRESHOLD - 1)
        monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))

        result = check_and_evolve("compute", log_path=log_path, watermark_path=wpath)

        assert result is None

    def test_at_threshold_evolves_and_returns_dict(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        log_path = tmp_path / "fitness.jsonl"
        wpath    = tmp_path / "watermarks.json"
        monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
        _write_observations(log_path, "compute", LIVE_EVO_THRESHOLD)
        _patch_bridge(monkeypatch)

        result = check_and_evolve("compute", log_path=log_path, watermark_path=wpath)

        assert result is not None
        assert result["generation"] == 0
        assert result["next_generation"] == 1
        assert isinstance(result["children_minted"], int) and result["children_minted"] > 0
        assert result["new_observations"] == LIVE_EVO_THRESHOLD

    def test_above_threshold_evolves(self, tmp_path: Path, monkeypatch) -> None:
        log_path = tmp_path / "fitness.jsonl"
        wpath    = tmp_path / "watermarks.json"
        monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
        _write_observations(log_path, "compute", LIVE_EVO_THRESHOLD + 5)
        _patch_bridge(monkeypatch)

        result = check_and_evolve("compute", log_path=log_path, watermark_path=wpath)

        assert result is not None
        assert result["new_observations"] == LIVE_EVO_THRESHOLD + 5

    def test_watermark_written_after_evolution(self, tmp_path: Path, monkeypatch) -> None:
        log_path = tmp_path / "fitness.jsonl"
        wpath    = tmp_path / "watermarks.json"
        count = LIVE_EVO_THRESHOLD + 3
        _write_observations(log_path, "compute", count)
        monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
        _patch_bridge(monkeypatch)

        check_and_evolve("compute", log_path=log_path, watermark_path=wpath)

        assert _read_watermark("compute", wpath) == count

    def test_watermark_prevents_double_evolve(self, tmp_path: Path, monkeypatch) -> None:
        log_path = tmp_path / "fitness.jsonl"
        wpath    = tmp_path / "watermarks.json"
        monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
        _write_observations(log_path, "compute", LIVE_EVO_THRESHOLD)
        _patch_bridge(monkeypatch)

        first  = check_and_evolve("compute", log_path=log_path, watermark_path=wpath)
        second = check_and_evolve("compute", log_path=log_path, watermark_path=wpath)

        assert first  is not None
        assert second is None

    def test_custom_threshold_respected(self, tmp_path: Path, monkeypatch) -> None:
        log_path = tmp_path / "fitness.jsonl"
        wpath    = tmp_path / "watermarks.json"
        monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
        _write_observations(log_path, "compute", 3)
        _patch_bridge(monkeypatch)

        result = check_and_evolve("compute", threshold=3, log_path=log_path, watermark_path=wpath)

        assert result is not None

    def test_observations_for_other_type_ignored(self, tmp_path: Path, monkeypatch) -> None:
        log_path = tmp_path / "fitness.jsonl"
        wpath    = tmp_path / "watermarks.json"
        monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
        # Write enough for "reason" but not "compute"
        _write_observations(log_path, "reason", LIVE_EVO_THRESHOLD)
        _write_observations(log_path, "compute", LIVE_EVO_THRESHOLD - 1)

        result = check_and_evolve("compute", log_path=log_path, watermark_path=wpath)

        assert result is None
