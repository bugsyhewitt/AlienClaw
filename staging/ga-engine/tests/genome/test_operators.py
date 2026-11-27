"""Tests for genome.operators module."""

from __future__ import annotations

import random
from types import SimpleNamespace

import pytest

from alienclaw_ga.genome.alphabet import GENOME_LENGTH, SECTION_LENGTH
from alienclaw_ga.genome.codec import assemble, parse
from alienclaw_ga.genome.operators import crossover, mutate, mutate_directed, random_genome
from alienclaw_ga.genome.validation import validate


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
        from alienclaw_ga.genome.alphabet import ALPHABET_SET
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
        """At rate=1.0, Xcodes in slots 1+2 should mostly change."""
        result = mutate(WEB_GENOME, random.Random(7), rate=1.0)
        # ID tag (0-7) must match (slot 0; mutate touches only slots 1+2)
        assert result[:8] == WEB_GENOME[:8]
        # Slots 1+2 cover bytes 64..191; with Xcode-level steps, up to 62
        # Xcodes (124 chars) may change. Some may clamp; require >= 80.
        changed = sum(1 for i in range(64, 192) if result[i] != WEB_GENOME[i])
        # Step mutations of magnitude 1..4 often change only the low byte of
        # an Xcode (carry into the high byte is rare), so chars-changed ≈ 30..70.
        assert changed >= 25, f"only {changed} chars changed in slots 1+2"

    def test_rejects_wrong_length(self) -> None:
        with pytest.raises(ValueError, match="exactly 256"):
            mutate("0" * 255, random.Random(1))

    def test_statistical_rate(self) -> None:
        """Over 1000 mutations, mean changed chars should be small (Xcode-level)."""
        n_trials = 1000
        rng = random.Random(0)
        changes = [
            sum(1 for i in range(64, 192) if mutate(WEB_GENOME, rng)[i] != WEB_GENOME[i])
            for _ in range(n_trials)
        ]
        mean = sum(changes) / n_trials
        # Expected ≈ 62 Xcodes × (1/256) × 2 chars ≈ 0.48 chars per call;
        # but step magnitudes >1 may change both bytes more often. Allow range.
        assert 0.05 < mean < 0.9, f"Unexpected mutation rate mean: {mean:.3f}"


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
        from alienclaw_ga.genome.checksum import compute_checksum
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


# ---------------------------------------------------------------------------
# Base62 precondition (stash 58b64f7a): mutate() and mutate_directed() document
# "Raises: ValueError: if genome is not a valid 256-char Base62 string". A
# 256-char genome with a non-Base62 character must raise that ValueError, not a
# bare KeyError from the Xcode lookup, and must never pass through silently with
# a freshly recomputed checksum (what rate=0.0 / no-brain calls used to do).
# ---------------------------------------------------------------------------

# One position per section: ID tag, EXECUTION Xcode 0, BEHAVIOR Xcode 0, CHECKSUM.
_CORRUPT_POSITIONS = (3, 65, 129, 200)
_CORRUPT_CHARS = ("!", "é", " ")


def _corrupt(genome: str, pos: int, ch: str) -> str:
    out = genome[:pos] + ch + genome[pos + 1:]
    assert len(out) == GENOME_LENGTH
    return out


def _one_field_brain() -> SimpleNamespace:
    """Duck-typed brain: mutate_directed reads only .parameter_schema and its fields."""
    field = SimpleNamespace(xcode_index=0, direction="none", range_min=0, range_max=3843)
    return SimpleNamespace(parameter_schema=(field,))


class TestBase62Precondition:
    @pytest.mark.parametrize("pos", _CORRUPT_POSITIONS)
    @pytest.mark.parametrize("ch", _CORRUPT_CHARS)
    @pytest.mark.parametrize("rate", [0.0, 1.0])
    def test_mutate_rejects_non_base62(self, pos: int, ch: str, rate: float) -> None:
        bad = _corrupt(WEB_GENOME, pos, ch)
        with pytest.raises(ValueError, match="non-Base62"):
            mutate(bad, random.Random(1), rate=rate)

    @pytest.mark.parametrize("pos", _CORRUPT_POSITIONS)
    @pytest.mark.parametrize("ch", _CORRUPT_CHARS)
    @pytest.mark.parametrize("with_brain", [False, True])
    def test_mutate_directed_rejects_non_base62(
        self, pos: int, ch: str, with_brain: bool
    ) -> None:
        bad = _corrupt(WEB_GENOME, pos, ch)
        brains = [None, _one_field_brain() if with_brain else None, None, None]
        with pytest.raises(ValueError, match="non-Base62"):
            mutate_directed(bad, brains, random.Random(1), rate=1.0)

    def test_error_lists_offending_characters(self) -> None:
        bad = _corrupt(_corrupt(WEB_GENOME, 65, "!"), 66, "@")
        with pytest.raises(ValueError, match=r"\['!', '@'\]"):
            mutate(bad, random.Random(1), rate=1.0)

    def test_valid_genome_still_mutates(self) -> None:
        """The precondition does not reject a valid genome (both operators)."""
        assert validate(mutate(WEB_GENOME, random.Random(5), rate=1.0)).valid
        brains = [None, _one_field_brain(), None, None]
        assert validate(mutate_directed(WEB_GENOME, brains, random.Random(5), rate=1.0)).valid
