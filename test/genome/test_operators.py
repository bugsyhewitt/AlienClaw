"""Tests for genome.operators module."""

from __future__ import annotations

import random

import pytest

from alienclaw.genome.alphabet import GENOME_LENGTH, SECTION_LENGTH
from alienclaw.genome.codec import assemble, parse
from alienclaw.genome.operators import crossover, mutate, random_genome
from alienclaw.genome.validation import validate


def _make_section(content: str, length: int = SECTION_LENGTH) -> str:
    content = content[:length]
    return content + "0" * (length - len(content))


_WEB_ID = _make_section("WEB00001G1AlienClaw1WebSearchFamily")
_WEB_EX = _make_section("3RSequentialPerfBalanced")
_WEB_BH = _make_section("EscalateStdOutputJSONArray")
WEB_GENOME = assemble(_WEB_ID, _WEB_EX, _WEB_BH)

_FR_ID = _make_section("FREAD001G1AlienClaw1FileReadFamily0")
_FR_EX = _make_section("2RSequentialPerfFast")
_FR_BH = _make_section("EscalateStdOutputFileContent")
FR_GENOME = assemble(_FR_ID, _FR_EX, _FR_BH)


class TestMutate:
    def test_rate_zero_returns_same(self) -> None:
        result = mutate(WEB_GENOME, random.Random(42), rate=0.0)
        assert result == WEB_GENOME

    def test_rate_zero_checksum_still_valid(self) -> None:
        result = mutate(WEB_GENOME, random.Random(1), rate=0.0)
        assert validate(result).valid

    def test_result_is_valid_genome(self) -> None:
        result = mutate(WEB_GENOME, random.Random(5))
        assert validate(result).valid

    def test_id_tag_never_changes(self) -> None:
        """ID-tag chars 0-7 must be protected from mutation regardless of rate."""
        for seed in range(20):
            result = mutate(WEB_GENOME, random.Random(seed), rate=1.0)
            assert result[:8] == WEB_GENOME[:8], (
                f"ID-tag changed with seed={seed}: {WEB_GENOME[:8]!r} → {result[:8]!r}"
            )

    def test_result_length(self) -> None:
        result = mutate(WEB_GENOME, random.Random(9))
        assert len(result) == GENOME_LENGTH

    def test_result_is_base62(self) -> None:
        from alienclaw.genome.alphabet import ALPHABET_SET
        result = mutate(WEB_GENOME, random.Random(3))
        assert all(c in ALPHABET_SET for c in result)

    def test_deterministic(self) -> None:
        r1 = mutate(WEB_GENOME, random.Random(42))
        r2 = mutate(WEB_GENOME, random.Random(42))
        assert r1 == r2

    def test_different_seeds_may_differ(self) -> None:
        results = {mutate(WEB_GENOME, random.Random(s)) for s in range(10)}
        # At rate 1/256, changes are rare — some seeds may produce same output;
        # but across 10 seeds at least 2 distinct outputs are highly probable
        # (probability of all 10 producing same output is astronomically small)
        assert len(results) >= 2

    def test_rate_one_changes_mutable_region(self) -> None:
        """At rate=1.0, all chars 8..191 should change (with overwhelming probability)."""
        result = mutate(WEB_GENOME, random.Random(7), rate=1.0)
        # ID tag (0-7) must match
        assert result[:8] == WEB_GENOME[:8]
        # Body chars 8..191 should NOT all be identical to original
        changed = sum(1 for i in range(8, 192) if result[i] != WEB_GENOME[i])
        # With 184 chars and 1/62 chance of random draw matching original,
        # expected unchanged ≈ 184/62 ≈ 3; require at least 90% changed
        assert changed >= 150

    def test_rejects_wrong_length(self) -> None:
        with pytest.raises(ValueError, match="exactly 256"):
            mutate("0" * 255, random.Random(1))

    def test_statistical_rate(self) -> None:
        """Over 1000 mutations, mean changed chars should be ~1.0 (rate=1/256 × 184 mutable)."""
        n_trials = 1000
        rng = random.Random(0)
        changes = [
            sum(1 for i in range(8, 192) if mutate(WEB_GENOME, rng)[i] != WEB_GENOME[i])
            for _ in range(n_trials)
        ]
        mean = sum(changes) / n_trials
        # Expected ≈ 184 × (1/256) ≈ 0.719; allow generous range
        assert 0.4 < mean < 1.5, f"Unexpected mutation rate mean: {mean:.3f}"


class TestCrossover:
    def test_result_is_valid(self) -> None:
        result = crossover(WEB_GENOME, FR_GENOME, random.Random(1))
        assert validate(result).valid

    def test_result_length(self) -> None:
        result = crossover(WEB_GENOME, FR_GENOME, random.Random(2))
        assert len(result) == GENOME_LENGTH

    def test_identical_parents(self) -> None:
        result = crossover(WEB_GENOME, WEB_GENOME, random.Random(3))
        assert result == WEB_GENOME

    def test_sections_come_from_parents(self) -> None:
        """Each 64-char section of the child must equal the same section from one parent."""
        result = crossover(WEB_GENOME, FR_GENOME, random.Random(4))
        s = SECTION_LENGTH
        for i in range(3):
            section = result[i * s : (i + 1) * s]
            parent_a_section = WEB_GENOME[i * s : (i + 1) * s]
            parent_b_section = FR_GENOME[i * s : (i + 1) * s]
            assert section in (parent_a_section, parent_b_section), (
                f"Section {i} of child is not from either parent"
            )

    def test_no_mid_section_splicing(self) -> None:
        """Crossover must use whole sections — no partial section mixing."""
        result = crossover(WEB_GENOME, FR_GENOME, random.Random(5))
        s = SECTION_LENGTH
        for i in range(3):
            section = result[i * s : (i + 1) * s]
            assert section == WEB_GENOME[i * s : (i + 1) * s] or \
                   section == FR_GENOME[i * s : (i + 1) * s]

    def test_checksum_is_recomputed(self) -> None:
        """Child checksum must match its actual body, not either parent's checksum."""
        from alienclaw.genome.checksum import compute_checksum
        result = crossover(WEB_GENOME, FR_GENOME, random.Random(6))
        assert result[192:] == compute_checksum(result[:192])

    def test_deterministic(self) -> None:
        r1 = crossover(WEB_GENOME, FR_GENOME, random.Random(99))
        r2 = crossover(WEB_GENOME, FR_GENOME, random.Random(99))
        assert r1 == r2

    def test_rejects_wrong_length(self) -> None:
        with pytest.raises(ValueError, match="256 chars"):
            crossover("0" * 255, WEB_GENOME, random.Random(1))

    def test_all_8_patterns_achievable(self) -> None:
        """With enough seeds, all 8 section-assignment patterns should appear."""
        s = SECTION_LENGTH
        patterns: set[tuple[int, int, int]] = set()
        for seed in range(200):
            result = crossover(WEB_GENOME, FR_GENOME, random.Random(seed))
            pattern = tuple(
                0 if result[i * s : (i + 1) * s] == WEB_GENOME[i * s : (i + 1) * s] else 1
                for i in range(3)
            )
            patterns.add(pattern)
        assert len(patterns) == 8, (
            f"Only {len(patterns)} of 8 crossover patterns observed in 200 seeds"
        )


class TestRandomGenome:
    def test_produces_valid_genome(self) -> None:
        g = random_genome(random.Random(1), "TEST0001")
        assert validate(g).valid

    def test_id_tag_preserved(self) -> None:
        g = random_genome(random.Random(2), "MYID0001")
        assert g[:8] == "MYID0001"

    def test_namespace_preserved(self) -> None:
        g = random_genome(random.Random(3), "TEST0001", namespace="AlienClaw1")
        parsed = parse(g)
        assert parsed.namespace == "AlienClaw1"

    def test_rejects_wrong_id_tag_length(self) -> None:
        with pytest.raises(ValueError, match="id_tag"):
            random_genome(random.Random(1), "SHORT")

    def test_rejects_wrong_namespace_length(self) -> None:
        with pytest.raises(ValueError, match="namespace"):
            random_genome(random.Random(1), "TEST0001", namespace="bad")

    def test_deterministic(self) -> None:
        g1 = random_genome(random.Random(42), "TEST0001")
        g2 = random_genome(random.Random(42), "TEST0001")
        assert g1 == g2
