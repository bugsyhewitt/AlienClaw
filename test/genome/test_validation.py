"""Tests for genome.validation module."""

from __future__ import annotations

import pytest

from alienclaw.genome.alphabet import SECTION_LENGTH
from alienclaw.genome.codec import assemble
from alienclaw.genome.validation import validate


def _make_section(content: str) -> str:
    return content[:SECTION_LENGTH] + "0" * (SECTION_LENGTH - len(content[:SECTION_LENGTH]))


WEB_GENOME = assemble(
    _make_section("WEB00001G1AlienClaw1WebSearchFamily"),
    _make_section("3RSequentialPerfBalanced"),
    _make_section("EscalateStdOutputJSONArray"),
)


class TestValidate:
    def test_valid_genome_passes(self) -> None:
        result = validate(WEB_GENOME)
        assert result.valid is True
        assert result.errors == []

    def test_valid_returns_truthy(self) -> None:
        assert validate(WEB_GENOME)

    def test_wrong_length_short(self) -> None:
        result = validate("0" * 255)
        assert not result.valid
        assert any("256" in e or "Length" in e for e in result.errors)

    def test_wrong_length_long(self) -> None:
        result = validate("0" * 257)
        assert not result.valid

    def test_empty_string(self) -> None:
        result = validate("")
        assert not result.valid

    def test_non_base62_plus(self) -> None:
        invalid = "+" + "0" * 255
        result = validate(invalid)
        assert not result.valid
        assert any("Base62" in e or "alphabet" in e.lower() for e in result.errors)

    def test_non_base62_equals(self) -> None:
        result = validate("=" + "0" * 255)
        assert not result.valid

    def test_bad_checksum(self) -> None:
        flip = "A" if WEB_GENOME[192] != "A" else "B"
        tampered = WEB_GENOME[:192] + flip + WEB_GENOME[193:]
        result = validate(tampered)
        assert not result.valid
        assert any("checksum" in e.lower() or "Checksum" in e for e in result.errors)

    def test_non_string_input(self) -> None:
        result = validate(None)  # type: ignore[arg-type]
        assert not result.valid

    def test_validation_result_is_frozen(self) -> None:
        result = validate(WEB_GENOME)
        with pytest.raises((AttributeError, TypeError)):
            result.valid = False  # type: ignore[misc]

    def test_all_three_seed_genomes(self) -> None:
        seeds = [
            ("WEB00001G1AlienClaw1WebSearchFamily", "3RSequentialPerfBalanced",
             "EscalateStdOutputJSONArray"),
            ("FREAD001G1AlienClaw1FileReadFamily0", "2RSequentialPerfFast",
             "EscalateStdOutputFileContent"),
            ("FWRITE01G1AlienClaw1FileWriteFamily", "2RSequentialPerfSafe",
             "EscalateStdOutputWriteConfirm"),
        ]
        for identity, execution, behavior in seeds:
            g = assemble(
                _make_section(identity),
                _make_section(execution),
                _make_section(behavior),
            )
            result = validate(g)
            assert result.valid, f"Seed genome failed: {identity[:8]}, errors={result.errors}"
