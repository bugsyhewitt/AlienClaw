"""Tests for audit_log.py — append-only JSONL, daily rollover, no raw keys."""
from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

from alienclaw.api.audit_log import AuditLog


FAKE_KEY_HASH = "a" * 64
FAKE_GENOME = "X" * 256
FAKE_GENOME_SHA256 = hashlib.sha256(FAKE_GENOME.encode()).hexdigest()


@pytest.fixture
def log(tmp_path: Path) -> AuditLog:
    return AuditLog(data_root=tmp_path)


def read_lines(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


class TestAuditLogWrite:
    def test_record_creates_log_file(self, log: AuditLog, tmp_path: Path):
        log.record(FAKE_KEY_HASH, "compute", FAKE_GENOME, 0.85, "accepted")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        expected = tmp_path / "audit" / f"submissions-{today}.jsonl"
        assert expected.exists()

    def test_accepted_entry_has_correct_fields(self, log: AuditLog, tmp_path: Path):
        log.record(FAKE_KEY_HASH, "compute", FAKE_GENOME, 0.85, "accepted",
                   client_ip="1.2.3.4")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        lines = read_lines(tmp_path / "audit" / f"submissions-{today}.jsonl")
        assert len(lines) == 1
        entry = lines[0]
        assert entry["api_key_hash"] == FAKE_KEY_HASH
        assert entry["martian_type"] == "compute"
        assert entry["genome_sha256"] == FAKE_GENOME_SHA256
        assert entry["fitness"] == 0.85
        assert entry["result"] == "accepted"
        assert entry["rejection_code"] is None
        assert entry["client_ip"] == "1.2.3.4"
        assert "ts" in entry

    def test_rejected_entry_includes_rejection_code(self, log: AuditLog, tmp_path: Path):
        log.record(FAKE_KEY_HASH, "compute", FAKE_GENOME, 1.5, "rejected",
                   rejection_code="INVALID_FITNESS_RANGE")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        lines = read_lines(tmp_path / "audit" / f"submissions-{today}.jsonl")
        assert lines[0]["result"] == "rejected"
        assert lines[0]["rejection_code"] == "INVALID_FITNESS_RANGE"

    def test_raw_api_key_never_in_log(self, log: AuditLog, tmp_path: Path):
        raw_key = "SomeRawApiKey12345678901234567890123456789AB"
        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
        log.record(key_hash, "compute", FAKE_GENOME, 0.5, "accepted")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        content = (tmp_path / "audit" / f"submissions-{today}.jsonl").read_text()
        assert raw_key not in content, "Raw API key must never appear in log file"

    def test_full_genome_never_in_log(self, log: AuditLog, tmp_path: Path):
        log.record(FAKE_KEY_HASH, "compute", FAKE_GENOME, 0.5, "accepted")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        content = (tmp_path / "audit" / f"submissions-{today}.jsonl").read_text()
        assert FAKE_GENOME not in content, "Full genome must never appear in log file"
        assert FAKE_GENOME_SHA256 in content, "Genome sha256 must be in log file"

    def test_multiple_entries_accumulate(self, log: AuditLog, tmp_path: Path):
        for i in range(5):
            log.record(FAKE_KEY_HASH, "compute", FAKE_GENOME, float(i) / 10, "accepted")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        lines = read_lines(tmp_path / "audit" / f"submissions-{today}.jsonl")
        assert len(lines) == 5

    def test_daily_rollover_different_dates_different_files(self, tmp_path: Path):
        log = AuditLog(data_root=tmp_path)
        # Directly call the internal path with different date strings
        path1 = log._log_path("2026-05-06")
        path2 = log._log_path("2026-05-07")
        assert path1 != path2
        assert "2026-05-06" in str(path1)
        assert "2026-05-07" in str(path2)

    def test_no_data_root_is_noop(self):
        log = AuditLog(data_root=None)
        # Should not raise
        log.record(FAKE_KEY_HASH, "compute", FAKE_GENOME, 0.5, "accepted")

    def test_write_failure_logs_to_stderr_not_raises(self, log: AuditLog, tmp_path: Path, capsys):
        # Make audit dir a file (not a dir) to trigger write failure
        audit_file = tmp_path / "audit"
        audit_file.write_text("not a directory")
        log.record(FAKE_KEY_HASH, "compute", FAKE_GENOME, 0.5, "accepted")
        captured = capsys.readouterr()
        assert "audit_log" in captured.err or "WARNING" in captured.err

    def test_entry_is_valid_json_line(self, log: AuditLog, tmp_path: Path):
        log.record(FAKE_KEY_HASH, "compute", FAKE_GENOME, 0.75, "accepted")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        path = tmp_path / "audit" / f"submissions-{today}.jsonl"
        for line in path.read_text().splitlines():
            if line.strip():
                parsed = json.loads(line)  # must not raise
                assert isinstance(parsed, dict)

    def test_ts_is_iso_format(self, log: AuditLog, tmp_path: Path):
        log.record(FAKE_KEY_HASH, "compute", FAKE_GENOME, 0.5, "accepted")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        lines = read_lines(tmp_path / "audit" / f"submissions-{today}.jsonl")
        ts = lines[0]["ts"]
        # Should parse without error
        datetime.fromisoformat(ts)
