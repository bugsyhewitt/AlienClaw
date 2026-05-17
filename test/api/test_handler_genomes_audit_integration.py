"""Integration: genome handler calls audit log on accepted + rejected submissions."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from alienclaw.api.audit_log import AuditLog
from alienclaw.api.handlers.genomes import handle_submit_genome
from alienclaw.api.types import SubmissionRequest
from alienclaw.genome.operators import random_genome
import random


def _valid_genome() -> str:
    return random_genome(random.Random(42), "COMPUT01")


REGISTERED = {
    "compute", "web_search", "search_text", "file_read",
    "file_write", "http_get", "url_fetch", "extract_json",
}

API_KEY_HASH = "b" * 64


@pytest.fixture
def store(tmp_path: Path):
    from alienclaw.api.storage import SubmissionStore
    return SubmissionStore(root=tmp_path)


@pytest.fixture
def audit(tmp_path: Path) -> AuditLog:
    return AuditLog(data_root=tmp_path)


def today_log(tmp_path: Path) -> Path:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return tmp_path / "audit" / f"submissions-{today}.jsonl"


def read_entries(tmp_path: Path) -> list[dict]:
    path = today_log(tmp_path)
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


class TestGenomeHandlerAuditIntegration:
    def test_valid_submission_logged_as_accepted(self, store, audit, tmp_path):
        req = SubmissionRequest(
            genome=_valid_genome(), martian_type="compute",
            fitness=0.85, leaderboard_name="TESTBOTA", run_metadata={},
        )
        handle_submit_genome(req, API_KEY_HASH, store, REGISTERED,
                             audit_log=audit, client_ip="10.0.0.1")
        entries = read_entries(tmp_path)
        assert len(entries) == 1
        assert entries[0]["result"] == "accepted"
        assert entries[0]["martian_type"] == "compute"
        assert entries[0]["fitness"] == 0.85

    def test_rejected_submission_logged_with_code(self, store, audit, tmp_path):
        req = SubmissionRequest(
            genome="TOOSHORT", martian_type="compute",
            fitness=0.5, leaderboard_name="TESTBOTA", run_metadata={},
        )
        with pytest.raises(ValueError):
            handle_submit_genome(req, API_KEY_HASH, store, REGISTERED,
                                 audit_log=audit, client_ip="10.0.0.2")
        entries = read_entries(tmp_path)
        assert len(entries) == 1
        assert entries[0]["result"] == "rejected"
        assert entries[0]["rejection_code"] == "INVALID_GENOME_LENGTH"

    def test_no_audit_log_does_not_crash(self, store):
        req = SubmissionRequest(
            genome=_valid_genome(), martian_type="compute",
            fitness=0.5, leaderboard_name="TESTBOTA", run_metadata={},
        )
        # audit_log=None should work without error
        status, _ = handle_submit_genome(req, API_KEY_HASH, store, REGISTERED)
        assert status in (200, 201)

    def test_duplicate_submission_still_logged(self, store, audit, tmp_path):
        genome = _valid_genome()
        req = SubmissionRequest(genome=genome, martian_type="compute",
                                fitness=0.5, leaderboard_name="TESTBOTA", run_metadata={})
        handle_submit_genome(req, API_KEY_HASH, store, REGISTERED,
                             audit_log=audit, client_ip="10.0.0.1")
        handle_submit_genome(req, API_KEY_HASH, store, REGISTERED,
                             audit_log=audit, client_ip="10.0.0.1")
        entries = read_entries(tmp_path)
        assert len(entries) == 2
        assert all(e["result"] == "accepted" for e in entries)

    def test_audit_failure_does_not_block_submission(self, store, tmp_path):
        # Make the audit dir a file to trigger failure
        broken_log = AuditLog(data_root=tmp_path)
        audit_dir = tmp_path / "audit"
        audit_dir.write_text("not a directory")  # type: ignore
        req = SubmissionRequest(
            genome=_valid_genome(), martian_type="compute",
            fitness=0.5, leaderboard_name="TESTBOTA", run_metadata={},
        )
        # Submission must succeed despite audit failure
        status, _ = handle_submit_genome(req, API_KEY_HASH, store, REGISTERED,
                                         audit_log=broken_log)
        assert status in (200, 201)
