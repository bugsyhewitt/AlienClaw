"""test_genome_vectors.py — Adversarial genome conformance tests (T2, PKT-P1).

Tests the adversarial cases added by scripts/gen-testvectors.py:
- invalid_length: length 255, 257, 0
- invalid_character: non-Base62 characters
- confusable_fail_checksum: 0→O, 1→l substitutions
- bad_checksum: valid genome with one checksum char flipped
- all_minimum: all '0' mutable body
- all_maximum: all 'z' mutable body
- seeded_random: 20 deterministic valid genomes

Both TS and Python runners load from the same fixture file; this test
covers the Python side only. The TS counterpart is ts-fixture-runner.test.ts.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from alienclaw.genome.codec import parse
from alienclaw.genome.checksum import compute_checksum, verify_checksum

FIXTURES_PATH = (
    Path(__file__).parent.parent.parent / "test" / "fixtures" / "genome-spec-fixtures.json"
)


@pytest.fixture(scope="module")
def fixtures() -> dict:
    with open(FIXTURES_PATH, encoding="utf-8") as f:
        return json.load(f)


def adversarial_cases(fixtures: dict) -> list[dict]:
    return [c for c in fixtures["cases"] if c["name"].startswith("adversarial-")]


def seeded_random_cases(fixtures: dict) -> list[dict]:
    return [c for c in fixtures["cases"] if c["name"].startswith("seeded-random-")]


# ---------------------------------------------------------------------------
# Adversarial: invalid length
# ---------------------------------------------------------------------------

class TestInvalidLength:
    def test_length_255_rejected(self, fixtures: dict) -> None:
        cases = [c for c in adversarial_cases(fixtures) if "length-255" in c["name"]]
        assert len(cases) >= 1
        for case in cases:
            with pytest.raises(ValueError, match="256"):
                parse(case["input"])

    def test_length_257_rejected(self, fixtures: dict) -> None:
        cases = [c for c in adversarial_cases(fixtures) if "length-257" in c["name"]]
        assert len(cases) >= 1
        for case in cases:
            with pytest.raises(ValueError, match="256"):
                parse(case["input"])

    def test_empty_rejected(self, fixtures: dict) -> None:
        cases = [c for c in adversarial_cases(fixtures) if "length-0" in c["name"]]
        assert len(cases) >= 1
        for case in cases:
            with pytest.raises(ValueError, match="256"):
                parse(case["input"])


# ---------------------------------------------------------------------------
# Adversarial: invalid characters
# ---------------------------------------------------------------------------

class TestInvalidCharacter:
    def test_exclamation_rejected(self, fixtures: dict) -> None:
        cases = [c for c in adversarial_cases(fixtures) if "char-exclamation" in c["name"]]
        assert len(cases) >= 1
        for case in cases:
            with pytest.raises(ValueError, match="non-Base62"):
                parse(case["input"])

    def test_at_rejected(self, fixtures: dict) -> None:
        cases = [c for c in adversarial_cases(fixtures) if "char-at" in c["name"]]
        assert len(cases) >= 1
        for case in cases:
            with pytest.raises(ValueError, match="non-Base62"):
                parse(case["input"])

    def test_space_rejected(self, fixtures: dict) -> None:
        cases = [c for c in adversarial_cases(fixtures) if "char-space" in c["name"]]
        assert len(cases) >= 1
        for case in cases:
            with pytest.raises(ValueError, match="non-Base62"):
                parse(case["input"])


# ---------------------------------------------------------------------------
# Adversarial: confusable characters fail checksum
# ---------------------------------------------------------------------------

class TestConfusables:
    def test_0_to_O_fails_checksum(self, fixtures: dict) -> None:
        cases = [c for c in adversarial_cases(fixtures) if "confusable-0-to-O" in c["name"]]
        for case in cases:
            with pytest.raises(ValueError, match="[Cc]hecksum"):
                parse(case["input"])

    def test_1_to_l_fails_checksum(self, fixtures: dict) -> None:
        cases = [c for c in adversarial_cases(fixtures) if "confusable-1-to-l" in c["name"]]
        for case in cases:
            with pytest.raises(ValueError, match="[Cc]hecksum"):
                parse(case["input"])


# ---------------------------------------------------------------------------
# Adversarial: bad checksum
# ---------------------------------------------------------------------------

class TestBadChecksum:
    def test_last_char_flipped(self, fixtures: dict) -> None:
        cases = [c for c in adversarial_cases(fixtures) if "bad-checksum-last-char" in c["name"]]
        assert len(cases) >= 1
        for case in cases:
            with pytest.raises(ValueError, match="[Cc]hecksum"):
                parse(case["input"])

    def test_first_checksum_char_flipped(self, fixtures: dict) -> None:
        cases = [c for c in adversarial_cases(fixtures) if "bad-checksum-first-char" in c["name"]]
        assert len(cases) >= 1
        for case in cases:
            with pytest.raises(ValueError, match="[Cc]hecksum"):
                parse(case["input"])


# ---------------------------------------------------------------------------
# Adversarial: all minimum / all maximum
# ---------------------------------------------------------------------------

class TestExtremeValues:
    def test_all_minimum_valid(self, fixtures: dict) -> None:
        cases = [c for c in adversarial_cases(fixtures) if "all-minimum" in c["name"]]
        assert len(cases) >= 1
        for case in cases:
            if case.get("expected_pass"):
                result = parse(case["input"])
                assert result is not None
            else:
                with pytest.raises(ValueError):
                    parse(case["input"])

    def test_all_maximum_valid(self, fixtures: dict) -> None:
        cases = [c for c in adversarial_cases(fixtures) if "all-maximum" in c["name"]]
        assert len(cases) >= 1
        for case in cases:
            if case.get("expected_pass"):
                result = parse(case["input"])
                assert result is not None
            else:
                with pytest.raises(ValueError):
                    parse(case["input"])


# ---------------------------------------------------------------------------
# Seeded random genomes: all should be valid
# ---------------------------------------------------------------------------

class TestSeededRandom:
    def test_all_seeded_random_are_valid(self, fixtures: dict) -> None:
        cases = seeded_random_cases(fixtures)
        assert len(cases) == 20
        for case in cases:
            if case.get("expected_pass", True):
                result = parse(case["input"])
                assert result is not None
                assert verify_checksum(case["input"])
            else:
                with pytest.raises(ValueError):
                    parse(case["input"])

    def test_seeded_random_checksums_verify(self, fixtures: dict) -> None:
        """Cross-check: the checksum in each seeded genome matches the computed value."""
        cases = [c for c in seeded_random_cases(fixtures) if c.get("expected_pass", True)]
        for case in cases:
            genome = case["input"]
            assert len(genome) == 256
            body = genome[:192]
            stored_checksum = genome[192:]
            computed_checksum = compute_checksum(body)
            assert stored_checksum == computed_checksum, (
                f"Seeded genome {case['name']} has checksum mismatch"
            )
