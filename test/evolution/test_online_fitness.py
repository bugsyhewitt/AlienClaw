"""test_online_fitness.py — OnlineFitnessLog unit tests (packet 128)."""
import pytest

from alienclaw.evolution.online_fitness import OnlineFitnessLog
from alienclaw.evolution.population import Population
from alienclaw.evolution.types import EvolutionConfig


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


class TestOnlineFitnessLog:
    def test_initial_read_empty(self, tmp_path):
        """A-001: fresh log returns []."""
        log = OnlineFitnessLog(tmp_path / "of.jsonl")
        assert log.read() == []

    def test_record_and_read_three_entries(self, tmp_path):
        """A-002: record 3 entries, read returns all 3 in order."""
        log = OnlineFitnessLog(tmp_path / "of.jsonl")
        log.record("compute", 0.5)
        log.record("web_search", 0.8)
        log.record("compute", 0.7)
        entries = log.read()
        assert len(entries) == 3
        assert entries[0]["martian_type"] == "compute"
        assert entries[0]["fitness"] == 0.5
        assert entries[1]["martian_type"] == "web_search"
        assert entries[1]["fitness"] == 0.8
        assert entries[2]["fitness"] == 0.7
        assert "ts" in entries[0]

    def test_isolation_from_population(self, tmp_path):
        """A-003: 3 online entries don't appear in Population pool.
        Population pool has population_size seeded entries; online log has 3.
        """
        log = OnlineFitnessLog(tmp_path / "of.jsonl")
        log.record("compute", 0.9)
        log.record("compute", 0.8)
        log.record("compute", 0.7)

        config = EvolutionConfig(martian_type="compute", population_size=4)
        pop = Population.load_or_create(config)

        assert len(log.read()) == 3
        assert len(pop.all()) == 4  # seeded by Population.create, not from online log

    def test_clear_deletes_file(self, tmp_path):
        """A-004: clear() deletes the JSONL file and read() returns [] after."""
        log = OnlineFitnessLog(tmp_path / "of.jsonl")
        log.record("compute", 0.5)
        log.clear()
        assert log.read() == []

    def test_clear_on_missing_file_is_noop(self, tmp_path):
        """A-005: clear() on a never-written log does not raise."""
        log = OnlineFitnessLog(tmp_path / "never.jsonl")
        log.clear()  # file doesn't exist — must not raise
        assert log.read() == []

    # ── Packet 485 — input validation ────────────────────────────────────────

    def test_record_rejects_infinity(self, tmp_path):
        """B-001: record() rejects math.inf with ValueError mentioning 'fitness'."""
        log = OnlineFitnessLog(tmp_path / "of.jsonl")
        with pytest.raises(ValueError, match="fitness"):
            log.record("compute", float("inf"))

    def test_record_rejects_nan(self, tmp_path):
        """B-002: record() rejects float('nan') with ValueError mentioning 'fitness'."""
        log = OnlineFitnessLog(tmp_path / "of.jsonl")
        with pytest.raises(ValueError, match="fitness"):
            log.record("compute", float("nan"))

    def test_record_rejects_above_one(self, tmp_path):
        """B-003: record() rejects 1.5 (above range) with ValueError mentioning 'fitness'."""
        log = OnlineFitnessLog(tmp_path / "of.jsonl")
        with pytest.raises(ValueError, match="fitness"):
            log.record("compute", 1.5)

    def test_record_rejects_below_zero(self, tmp_path):
        """B-004: record() rejects -0.5 (below range) with ValueError mentioning 'fitness'."""
        log = OnlineFitnessLog(tmp_path / "of.jsonl")
        with pytest.raises(ValueError, match="fitness"):
            log.record("compute", -0.5)

    def test_record_accepts_boundaries(self, tmp_path):
        """B-005: record() accepts 0.0 and 1.0 (closed interval boundaries)."""
        log = OnlineFitnessLog(tmp_path / "of.jsonl")
        log.record("compute", 0.0)
        log.record("compute", 1.0)
        entries = log.read()
        assert len(entries) == 2
        assert entries[0]["fitness"] == 0.0
        assert entries[1]["fitness"] == 1.0
