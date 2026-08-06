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


class TestOnlineFitnessRecordNanGuard:
    """PKT-489 T2: record() must skip NaN/±Infinity with stderr warning."""

    def test_record_skips_nan_fitness_with_stderr_warning(self, tmp_path, capsys):
        """B-001: record(nan) drops entry and emits stderr warning."""
        log = OnlineFitnessLog(tmp_path / "of.jsonl")
        log.record("compute", float("nan"))
        assert log.read() == []
        captured = capsys.readouterr()
        assert "dropped non-finite fitness" in captured.err
        assert "compute" in captured.err

    def test_record_skips_positive_infinity_fitness_with_stderr_warning(self, tmp_path, capsys):
        """B-002: record(+inf) drops entry and emits stderr warning."""
        log = OnlineFitnessLog(tmp_path / "of.jsonl")
        log.record("web_search", float("inf"))
        assert log.read() == []
        captured = capsys.readouterr()
        assert "dropped non-finite fitness" in captured.err

    def test_record_skips_negative_infinity_fitness_with_stderr_warning(self, tmp_path, capsys):
        """B-003: record(-inf) drops entry and emits stderr warning."""
        log = OnlineFitnessLog(tmp_path / "of.jsonl")
        log.record("compute", float("-inf"))
        assert log.read() == []
        captured = capsys.readouterr()
        assert "dropped non-finite fitness" in captured.err

    @pytest.mark.parametrize("fitness", [0.0, 0.5, 1.0, -0.5])
    def test_record_accepts_finite_fitness_regression(self, tmp_path, fitness):
        """B-004: finite fitness values (including negative) are accepted."""
        log = OnlineFitnessLog(tmp_path / "of.jsonl")
        log.record("compute", fitness)
        entries = log.read()
        assert len(entries) == 1
        assert entries[0]["fitness"] == fitness

    def test_record_nan_does_not_corrupt_file_content(self, tmp_path):
        """B-005: after record(nan), file is empty and read() returns []."""
        log = OnlineFitnessLog(tmp_path / "of.jsonl")
        log.record("compute", float("nan"))
        assert log.read() == []
        path = tmp_path / "of.jsonl"
        if path.exists():
            assert path.read_text().strip() == ""


class TestOnlineFitnessReadMalformedGuard:
    """PKT-489 T1: read() must skip malformed JSONL lines without raising."""

    def test_read_skips_malformed_json_line_silently(self, tmp_path):
        """C-001: valid/NOT_JSON/valid → 2 entries returned, no exception."""
        p = tmp_path / "of.jsonl"
        p.write_text(
            '{"martian_type":"compute","fitness":0.5,"ts":"2026-01-01T00:00:00+00:00"}\n'
            "NOT_JSON\n"
            '{"martian_type":"web_search","fitness":0.8,"ts":"2026-01-01T00:01:00+00:00"}\n',
            encoding="utf-8",
        )
        log = OnlineFitnessLog(p)
        entries = log.read()
        assert len(entries) == 2
        assert entries[0]["fitness"] == 0.5
        assert entries[1]["fitness"] == 0.8

    def test_read_skips_truncated_last_line_silently(self, tmp_path):
        """C-002: valid + truncated partial → 1 entry returned, no exception."""
        p = tmp_path / "of.jsonl"
        p.write_text(
            '{"martian_type":"compute","fitness":0.5,"ts":"2026-01-01T00:00:00+00:00"}\n'
            '{"fitness":0.',
            encoding="utf-8",
        )
        log = OnlineFitnessLog(p)
        entries = log.read()
        assert len(entries) == 1
        assert entries[0]["fitness"] == 0.5

    def test_read_skips_empty_after_strip_regression(self, tmp_path):
        """C-003: blank lines only → 0 entries (strip filter still works)."""
        p = tmp_path / "of.jsonl"
        p.write_text("\n\n\n", encoding="utf-8")
        log = OnlineFitnessLog(p)
        assert log.read() == []

    def test_read_skips_mixed_corruption_does_not_disable_live_evo(self, tmp_path):
        """C-004: 5 valid + 2 malformed + 5 valid → 10 entries, no exception.

        This is the live-evo regression: previously a single JSONDecodeError
        would propagate through live_evo.py and disable live-evo for all
        martian types until the log was hand-repaired.
        """
        p = tmp_path / "of.jsonl"
        lines = []
        for i in range(5):
            lines.append(
                f'{{"martian_type":"compute","fitness":{0.1 * i},'
                f'"ts":"2026-01-01T{i:02d}:00:00+00:00"}}\n'
            )
        lines.append("CORRUPT_LINE\n")
        lines.append('{"broken":\n')
        for i in range(5, 10):
            lines.append(
                f'{{"martian_type":"compute","fitness":{0.1 * i},'
                f'"ts":"2026-01-01T{i:02d}:00:00+00:00"}}\n'
            )
        p.write_text("".join(lines), encoding="utf-8")
        log = OnlineFitnessLog(p)
        entries = log.read()
        assert len(entries) == 10
        compute_entries = [e for e in entries if e["martian_type"] == "compute"]
        assert len(compute_entries) == 10

    def test_read_returns_typed_dicts_regression(self, tmp_path):
        """C-005: 2 valid entries round-trip with correct types."""
        log = OnlineFitnessLog(tmp_path / "of.jsonl")
        log.record("compute", 0.75)
        log.record("web_search", 0.42)
        entries = log.read()
        assert len(entries) == 2
        assert isinstance(entries[0]["martian_type"], str)
        assert isinstance(entries[0]["fitness"], float)
        assert isinstance(entries[0]["ts"], str)
