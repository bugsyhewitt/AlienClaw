"""Tests for genome.alphabet module."""

from __future__ import annotations

import random

import pytest

from alienclaw.genome.alphabet import (
    ALPHABET,
    ALPHABET_INDEX,
    ALPHABET_SET,
    GENOME_LENGTH,
    ID_TAG_END,
    ID_TAG_START,
    MUTABLE_LENGTH,
    NUM_SECTIONS,
    SECTION_LENGTH,
    char_to_index,
    index_to_char,
    is_valid_genome_string,
    random_genome_chars,
    validate_section,
)


class TestAlphabet:
    def test_alphabet_length(self) -> None:
        assert len(ALPHABET) == 62

    def test_alphabet_starts_with_digits(self) -> None:
        assert ALPHABET[:10] == "0123456789"

    def test_alphabet_uppercase_follows_digits(self) -> None:
        assert ALPHABET[10:36] == "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

    def test_alphabet_lowercase_last(self) -> None:
        assert ALPHABET[36:] == "abcdefghijklmnopqrstuvwxyz"

    def test_alphabet_matches_ts_canonical(self) -> None:
        """The alphabet must match genome-codec.ts:18 exactly."""
        expected = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
        assert ALPHABET == expected

    def test_no_plus_slash_equals(self) -> None:
        """Base64 hazard characters must be absent."""
        for c in ("+", "/", "="):
            assert c not in ALPHABET_SET

    def test_alphabet_index_round_trip(self) -> None:
        for i, c in enumerate(ALPHABET):
            assert ALPHABET_INDEX[c] == i
            assert ALPHABET[ALPHABET_INDEX[c]] == c

    def test_char_to_index_valid(self) -> None:
        assert char_to_index("0") == 0
        assert char_to_index("9") == 9
        assert char_to_index("A") == 10
        assert char_to_index("Z") == 35
        assert char_to_index("a") == 36
        assert char_to_index("z") == 61

    def test_char_to_index_invalid(self) -> None:
        with pytest.raises(KeyError):
            char_to_index("+")
        with pytest.raises(KeyError):
            char_to_index("=")

    def test_index_to_char_valid(self) -> None:
        assert index_to_char(0) == "0"
        assert index_to_char(9) == "9"
        assert index_to_char(10) == "A"
        assert index_to_char(61) == "z"

    def test_index_to_char_invalid(self) -> None:
        with pytest.raises(IndexError):
            index_to_char(62)
        with pytest.raises(IndexError):
            index_to_char(-1)


class TestConstants:
    def test_genome_length(self) -> None:
        assert GENOME_LENGTH == 256

    def test_section_length(self) -> None:
        assert SECTION_LENGTH == 64

    def test_num_sections(self) -> None:
        assert NUM_SECTIONS == 4

    def test_mutable_length(self) -> None:
        assert MUTABLE_LENGTH == 192

    def test_sections_add_up(self) -> None:
        assert SECTION_LENGTH * NUM_SECTIONS == GENOME_LENGTH

    def test_id_tag_range(self) -> None:
        assert ID_TAG_START == 0
        assert ID_TAG_END == 8


class TestIsValidGenomeString:
    def test_valid_all_zeros(self) -> None:
        assert is_valid_genome_string("0" * 256) is True

    def test_valid_all_z(self) -> None:
        assert is_valid_genome_string("z" * 256) is True

    def test_rejects_wrong_length_short(self) -> None:
        assert is_valid_genome_string("0" * 255) is False

    def test_rejects_wrong_length_long(self) -> None:
        assert is_valid_genome_string("0" * 257) is False

    def test_rejects_empty(self) -> None:
        assert is_valid_genome_string("") is False

    def test_rejects_non_base62_plus(self) -> None:
        genome = "+" + "0" * 255
        assert is_valid_genome_string(genome) is False

    def test_rejects_non_base62_space(self) -> None:
        genome = " " + "0" * 255
        assert is_valid_genome_string(genome) is False

    def test_rejects_non_base62_equals(self) -> None:
        genome = "=" + "0" * 255
        assert is_valid_genome_string(genome) is False


class TestValidateSection:
    def test_valid_section(self) -> None:
        validate_section("0" * 64, "IDENTITY")  # must not raise

    def test_rejects_short(self) -> None:
        with pytest.raises(ValueError, match="exactly 64"):
            validate_section("0" * 63, "IDENTITY")

    def test_rejects_long(self) -> None:
        with pytest.raises(ValueError, match="exactly 64"):
            validate_section("0" * 65, "IDENTITY")

    def test_rejects_non_base62(self) -> None:
        with pytest.raises(ValueError, match="non-Base62"):
            validate_section("+" + "0" * 63, "IDENTITY")


class TestRandomGenomeChars:
    def test_length(self) -> None:
        rng = random.Random(42)
        s = random_genome_chars(rng, 256)
        assert len(s) == 256

    def test_alphabet(self) -> None:
        rng = random.Random(1)
        s = random_genome_chars(rng, 256)
        assert all(c in ALPHABET_SET for c in s)

    def test_custom_length(self) -> None:
        rng = random.Random(99)
        s = random_genome_chars(rng, 192)
        assert len(s) == 192

    def test_deterministic(self) -> None:
        s1 = random_genome_chars(random.Random(7), 256)
        s2 = random_genome_chars(random.Random(7), 256)
        assert s1 == s2

    def test_different_seeds_differ(self) -> None:
        s1 = random_genome_chars(random.Random(1), 256)
        s2 = random_genome_chars(random.Random(2), 256)
        # Astronomically unlikely to be equal
        assert s1 != s2
