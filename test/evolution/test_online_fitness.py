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

    def test_clear_deletes_existing_log(self, tmp_path):
        """A-004: clear() removes the file; subsequent read() returns []."""
        log = OnlineFitnessLog(tmp_path / "of.jsonl")
        log.record("compute", 0.5)
        assert (tmp_path / "of.jsonl").exists()
        log.clear()
        assert not (tmp_path / "of.jsonl").exists()
        assert log.read() == []

    def test_clear_is_noop_when_file_does_not_exist(self, tmp_path):
        """A-005: clear() on a never-written log does not raise FileNotFoundError."""
        log = OnlineFitnessLog(tmp_path / "of.jsonl")
        assert not (tmp_path / "of.jsonl").exists()
        log.clear()  # must not raise
        assert log.read() == []
