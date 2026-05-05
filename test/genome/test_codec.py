"""Tests for genome.codec module."""

from __future__ import annotations

import pytest

from alienclaw.genome.alphabet import ALPHABET, GENOME_LENGTH, SECTION_LENGTH
from alienclaw.genome.checksum import compute_checksum
from alienclaw.genome.codec import assemble, parse, round_trip_check


def _make_section(content: str, length: int = SECTION_LENGTH) -> str:
    """Pad or truncate content to exactly `length` Base62 chars."""
    content = content[:length]
    return content + "0" * (length - len(content))


WEB_IDENTITY = _make_section("WEB00001G1AlienClaw1WebSearchFamily")
WEB_EXECUTION = _make_section("3RSequentialPerfBalanced")
WEB_BEHAVIOR = _make_section("EscalateStdOutputJSONArray")


class TestAssemble:
    def test_produces_256_chars(self) -> None:
        g = assemble(WEB_IDENTITY, WEB_EXECUTION, WEB_BEHAVIOR)
        assert len(g) == GENOME_LENGTH

    def test_all_base62(self) -> None:
        g = assemble(WEB_IDENTITY, WEB_EXECUTION, WEB_BEHAVIOR)
        alphabet_set = set(ALPHABET)
        assert all(c in alphabet_set for c in g)

    def test_sections_in_correct_positions(self) -> None:
        g = assemble(WEB_IDENTITY, WEB_EXECUTION, WEB_BEHAVIOR)
        s = SECTION_LENGTH
        assert g[:s] == WEB_IDENTITY
        assert g[s : s * 2] == WEB_EXECUTION
        assert g[s * 2 : s * 3] == WEB_BEHAVIOR

    def test_checksum_is_computed(self) -> None:
        g = assemble(WEB_IDENTITY, WEB_EXECUTION, WEB_BEHAVIOR)
        body = WEB_IDENTITY + WEB_EXECUTION + WEB_BEHAVIOR
        assert g[192:] == compute_checksum(body)

    def test_rejects_short_identity(self) -> None:
        with pytest.raises(ValueError, match="exactly 64"):
            assemble("0" * 63, WEB_EXECUTION, WEB_BEHAVIOR)

    def test_rejects_non_base62(self) -> None:
        with pytest.raises(ValueError, match="non-Base62"):
            assemble("+" + "0" * 63, WEB_EXECUTION, WEB_BEHAVIOR)

    def test_deterministic(self) -> None:
        g1 = assemble(WEB_IDENTITY, WEB_EXECUTION, WEB_BEHAVIOR)
        g2 = assemble(WEB_IDENTITY, WEB_EXECUTION, WEB_BEHAVIOR)
        assert g1 == g2


class TestParse:
    def test_sections_are_correct_length(self) -> None:
        g = assemble(WEB_IDENTITY, WEB_EXECUTION, WEB_BEHAVIOR)
        parsed = parse(g)
        assert len(parsed.identity) == SECTION_LENGTH
        assert len(parsed.execution) == SECTION_LENGTH
        assert len(parsed.behavior) == SECTION_LENGTH
        assert len(parsed.checksum) == SECTION_LENGTH

    def test_parsed_sections_match_input(self) -> None:
        g = assemble(WEB_IDENTITY, WEB_EXECUTION, WEB_BEHAVIOR)
        parsed = parse(g)
        assert parsed.identity == WEB_IDENTITY
        assert parsed.execution == WEB_EXECUTION
        assert parsed.behavior == WEB_BEHAVIOR

    def test_rejects_wrong_length(self) -> None:
        with pytest.raises(ValueError, match="exactly 256"):
            parse("0" * 255)
        with pytest.raises(ValueError, match="exactly 256"):
            parse("0" * 257)

    def test_rejects_non_base62(self) -> None:
        valid = assemble(WEB_IDENTITY, WEB_EXECUTION, WEB_BEHAVIOR)
        invalid = "+" + valid[1:]
        with pytest.raises(ValueError, match="non-Base62"):
            parse(invalid)

    def test_rejects_bad_checksum(self) -> None:
        g = assemble(WEB_IDENTITY, WEB_EXECUTION, WEB_BEHAVIOR)
        # Flip the first checksum character
        flip_char = "A" if g[192] != "A" else "B"
        tampered = g[:192] + flip_char + g[193:]
        with pytest.raises(ValueError, match="[Cc]hecksum"):
            parse(tampered)

    def test_property_accessors(self) -> None:
        g = assemble(WEB_IDENTITY, WEB_EXECUTION, WEB_BEHAVIOR)
        parsed = parse(g)
        assert parsed.id_tag == "WEB00001"
        assert parsed.generation_marker == "G1"
        assert parsed.namespace == "AlienClaw1"
        # retry: '3' → (51-48) % 5 + 1 = 4
        assert parsed.retry_count == 4
        # backoff: 'R' → (82-48) % 10 * 500 = 2000
        assert parsed.backoff_ms == 2000
        # escalation: 'E' → fail_forward = False
        assert parsed.fail_forward is False

    def test_fail_forward_true(self) -> None:
        behavior_f = "F" + WEB_BEHAVIOR[1:]  # change 'E' → 'F'
        g = assemble(WEB_IDENTITY, WEB_EXECUTION, behavior_f)
        parsed = parse(g)
        assert parsed.fail_forward is True


class TestRoundTrip:
    def test_assemble_parse_round_trip(self) -> None:
        g = assemble(WEB_IDENTITY, WEB_EXECUTION, WEB_BEHAVIOR)
        assert round_trip_check(g) is True

    def test_parse_full_round_trip(self) -> None:
        g = assemble(WEB_IDENTITY, WEB_EXECUTION, WEB_BEHAVIOR)
        parsed = parse(g)
        assert parsed.full() == g

    def test_round_trip_preserves_padding_zeros(self) -> None:
        """Reserved zero-padding bytes MUST survive round-trip (spec MUST)."""
        # Content shorter than section — zeros are padding
        identity = "XTEST001G1AlienClaw1Test" + "0" * 40  # 24 chars + 40 zeros = 64
        execution = "1ASeq" + "0" * 59
        behavior = "E" + "0" * 63
        g = assemble(identity, execution, behavior)
        parsed = parse(g)
        assert parsed.identity == identity
        assert parsed.execution == execution
        assert parsed.behavior == behavior
        assert round_trip_check(g) is True

    def test_round_trip_check_rejects_invalid(self) -> None:
        assert round_trip_check("bad_genome") is False
        assert round_trip_check("0" * 255) is False

    def test_all_three_seed_genomes(self) -> None:
        """Round-trip all three seed Martian specs from seed-installer.ts."""
        seeds = [
            (
                _make_section("WEB00001G1AlienClaw1WebSearchFamily"),
                _make_section("3RSequentialPerfBalanced"),
                _make_section("EscalateStdOutputJSONArray"),
            ),
            (
                _make_section("FREAD001G1AlienClaw1FileReadFamily0"),
                _make_section("2RSequentialPerfFast"),
                _make_section("EscalateStdOutputFileContent"),
            ),
            (
                _make_section("FWRITE01G1AlienClaw1FileWriteFamily"),
                _make_section("2RSequentialPerfSafe"),
                _make_section("EscalateStdOutputWriteConfirm"),
            ),
        ]
        for identity, execution, behavior in seeds:
            g = assemble(identity, execution, behavior)
            assert round_trip_check(g), f"Round-trip failed for identity={identity[:16]}"
