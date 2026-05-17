"""Validate api-contract-fixtures.json against live Python implementations.

Exercises api_key_format, machine_hash, genome_validation, and constant
categories. endpoint/error/auth/rate/sort categories are contract docs
(consumed by TypeScript) and are not exercised here.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from alienclaw.api.auth import is_valid_api_key_format, is_valid_machine_hash
from alienclaw.api.validation import validate_submission
from alienclaw.api.types import SubmissionRequest

FIXTURE_PATH = Path(__file__).parent.parent / "fixtures" / "api-contract-fixtures.json"
_REGISTERED_TYPES = {
    "compute", "web_search", "search_text", "file_read",
    "file_write", "http_get", "url_fetch", "extract_json",
}


def _load_cases(category: str) -> list[dict]:
    data = json.loads(FIXTURE_PATH.read_text())
    return [c for c in data["cases"] if c["category"] == category]


def _submission(inp: dict) -> SubmissionRequest:
    return SubmissionRequest(
        genome=inp["genome"],
        martian_type=inp["martian_type"],
        fitness=inp["fitness"],
        leaderboard_name=inp.get("leaderboard_name", ""),
        run_metadata=inp.get("run_metadata", {}),
    )


class TestAPIKeyFormat:
    @pytest.mark.parametrize("case", _load_cases("api_key_format"), ids=lambda c: c["id"])
    def test_key_format(self, case):
        result = is_valid_api_key_format(case["input"])
        assert result == case["expected"]["valid"], (
            f"{case['id']}: {case['description']!r} — "
            f"expected valid={case['expected']['valid']}, got {result}"
        )


class TestMachineHash:
    @pytest.mark.parametrize("case", _load_cases("machine_hash"), ids=lambda c: c["id"])
    def test_machine_hash(self, case):
        result = is_valid_machine_hash(case["input"])
        assert result == case["expected"]["valid"], (
            f"{case['id']}: {case['description']!r} — "
            f"expected valid={case['expected']['valid']}, got {result}"
        )


class TestGenomeValidation:
    @pytest.mark.parametrize("case", _load_cases("genome_validation"), ids=lambda c: c["id"])
    def test_genome_validation(self, case):
        req = _submission(case["input"])
        result = validate_submission(req, _REGISTERED_TYPES)
        assert result.valid == case["expected"]["valid"], (
            f"{case['id']}: {case['description']!r} — "
            f"expected valid={case['expected']['valid']}, got {result.valid}"
        )
        expected_code = case["expected"].get("error_code")
        if expected_code is not None:
            assert result.error is not None, f"{case['id']}: expected error but got none"
            assert result.error.code == expected_code, (
                f"{case['id']}: expected error code {expected_code!r}, got {result.error.code!r}"
            )
        elif result.valid:
            assert result.error is None


class TestConstants:
    def test_fixture_has_correct_constants(self):
        data = json.loads(FIXTURE_PATH.read_text())
        c = data["constants"]
        assert c["api_key_length"] == 43
        assert c["machine_hash_length"] == 64
        assert c["genome_length"] == 256
        assert c["rate_limit_per_hour"] == 100

    def test_valid_genomes_are_actually_valid(self):
        from alienclaw.genome.validation import validate
        data = json.loads(FIXTURE_PATH.read_text())
        for name, genome in data["valid_genomes"].items():
            result = validate(genome)
            assert result.valid, f"valid_genomes.{name} failed: {list(result.errors)}"
            assert len(genome) == 256, f"valid_genomes.{name} wrong length"

    def test_fixture_has_at_least_30_cases(self):
        data = json.loads(FIXTURE_PATH.read_text())
        assert len(data["cases"]) >= 30, f"Expected ≥30 cases, got {len(data['cases'])}"

    def test_all_canonical_error_codes_present(self):
        data = json.loads(FIXTURE_PATH.read_text())
        error_case = next(c for c in data["cases"] if c["id"] == "error-002")
        codes = set(error_case["codes"])
        required = {
            "INVALID_API_KEY_FORMAT", "INVALID_MACHINE_HASH",
            "INVALID_GENOME_LENGTH", "INVALID_GENOME_ALPHABET",
            "INVALID_GENOME_CHECKSUM", "INVALID_FITNESS_RANGE",
            "UNKNOWN_MARTIAN_TYPE", "UNAUTHORIZED",
        }
        assert required <= codes
