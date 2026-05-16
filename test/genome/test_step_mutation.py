"""Tests for step-based directional mutation (Packet 15)."""

from __future__ import annotations

import random

import pytest

from alienclaw.brains.types import BrainSpec, GenomeSectionDocs, ParameterSchemaField
from alienclaw.genome.codec import (
    decode_xcode,
    encode_xcode,
    param_value_to_xcode,
    xcode_to_param_value,
)
from alienclaw.genome.checksum import compute_checksum
from alienclaw.genome.operators import (
    PER_XCODE_MUTATION_RATE,
    mutate_directed,
    random_genome,
)
from alienclaw.genome.validation import validate


def make_brain(params: list[ParameterSchemaField], tool: str = "test_tool") -> BrainSpec:
    """Minimal BrainSpec for testing mutate_directed."""
    return BrainSpec(
        tool=tool,
        version="1.0",
        capabilities="",
        limitations="",
        failure_modes="",
        best_practices="",
        execution_order=(),
        output_contract="",
        genome_sections=GenomeSectionDocs(identity="", execution="", behavior="", checksum=""),
        variables={},
        parameter_schema=tuple(params),
        source_path="",
    )


def _set_xcode(genome: str, slot_index: int, xcode_index: int, value: int) -> str:
    """Return a copy of genome with one Xcode replaced and a fresh checksum."""
    chars = list(genome[:192])
    enc = encode_xcode(value)
    base = slot_index * 64 + 1 + xcode_index * 2
    chars[base] = enc[0]
    chars[base + 1] = enc[1]
    body = "".join(chars)
    return body + compute_checksum(body)


_BASE_GENOME = random_genome(random.Random(0), "TEST0001")


class TestEmptyBrains:
    def test_all_none_brains_unchanged(self) -> None:
        result = mutate_directed(_BASE_GENOME, [None, None, None, None], random.Random(1))
        assert result == _BASE_GENOME

    def test_brain_with_no_params_unchanged(self) -> None:
        brain = make_brain([])
        result = mutate_directed(_BASE_GENOME, [None, brain, None, None], random.Random(1))
        assert result == _BASE_GENOME


class TestValidity:
    def test_result_is_valid(self) -> None:
        brain = make_brain([
            ParameterSchemaField("a", "x", 0, 1, 5, 1, "lower"),
            ParameterSchemaField("b", "y", 1, 1, 10, 5, "none"),
        ])
        result = mutate_directed(_BASE_GENOME, [None, brain, None, None], random.Random(2), rate=1.0)
        assert validate(result).valid


class TestDeterminism:
    def test_same_seed_same_result(self) -> None:
        brain = make_brain([ParameterSchemaField("a", "x", 0, 1, 100, 50, "none")])
        results = {
            mutate_directed(_BASE_GENOME, [None, brain, None, None], random.Random(42))
            for _ in range(20)
        }
        assert len(results) == 1


class TestIDTagProtection:
    def test_slot_0_brain_does_not_mutate_id_tag(self) -> None:
        # Even with a brain in slot 0 and rate=1.0, slot 0 must not be touched.
        brain = make_brain([
            ParameterSchemaField("a", "x", i, 1, 5, 1, "none") for i in range(10)
        ])
        result = mutate_directed(_BASE_GENOME, [brain, None, None, None], random.Random(7), rate=1.0)
        # Slot 0 should be entirely unchanged (incl. ID tag at chars 0-7).
        assert result[:64] == _BASE_GENOME[:64]
        assert result[:8] == _BASE_GENOME[:8]

    def test_slot_3_brain_does_not_mutate_checksum(self) -> None:
        brain = make_brain([ParameterSchemaField("a", "x", 0, 1, 5, 1, "none")])
        result = mutate_directed(_BASE_GENOME, [None, None, None, brain], random.Random(7), rate=1.0)
        # Slot 3 (the checksum) should be a freshly computed one over the same body.
        assert result[:192] == _BASE_GENOME[:192]


class TestStepDistribution:
    def test_step_magnitudes_match_distribution(self) -> None:
        """Empirically verify ±1/±2/±3/±4 frequencies (direction=none)."""
        # Param range wide enough that steps rarely clamp.
        brain = make_brain([ParameterSchemaField("p", "x", 0, 0, 3843, 1922, "none")])
        # Set genome so xcode 0 of slot 1 maps to mid-range param=1922.
        start = _set_xcode(_BASE_GENOME, 1, 0, param_value_to_xcode(1922, 0, 3843))
        rng = random.Random(123)
        counts = {1: 0, 2: 0, 3: 0, 4: 0}
        n = 10000
        for _ in range(n):
            res = mutate_directed(start, [None, brain, None, None], rng, rate=1.0)
            new_param = xcode_to_param_value(decode_xcode(res, 1, 0), 0, 3843)
            diff = abs(new_param - 1922)
            if diff in counts:
                counts[diff] += 1
        # Counts may be slightly off due to clamping near boundaries, but mid-range here.
        f1 = counts[1] / n
        f2 = counts[2] / n
        f3 = counts[3] / n
        f4 = counts[4] / n
        assert 0.55 < f1 < 0.65, f"|step|=1 frequency {f1:.3f} outside [0.55,0.65]"
        assert 0.21 < f2 < 0.29, f"|step|=2 frequency {f2:.3f} outside [0.21,0.29]"
        assert 0.07 < f3 < 0.13, f"|step|=3 frequency {f3:.3f} outside [0.07,0.13]"
        assert 0.03 < f4 < 0.07, f"|step|=4 frequency {f4:.3f} outside [0.03,0.07]"


class TestDirectionBias:
    def test_lower_bias_decreases(self) -> None:
        brain = make_brain([ParameterSchemaField("p", "x", 0, 0, 3843, 1922, "lower")])
        start = _set_xcode(_BASE_GENOME, 1, 0, param_value_to_xcode(1922, 0, 3843))
        rng = random.Random(7)
        decreased = 0
        n = 10000
        for _ in range(n):
            res = mutate_directed(start, [None, brain, None, None], rng, rate=1.0)
            new_param = xcode_to_param_value(decode_xcode(res, 1, 0), 0, 3843)
            if new_param < 1922:
                decreased += 1
        frac = decreased / n
        assert 0.68 < frac < 0.72, f"lower-bias decreased fraction {frac:.3f} outside [0.68,0.72]"

    def test_higher_bias_increases(self) -> None:
        brain = make_brain([ParameterSchemaField("p", "x", 0, 0, 3843, 1922, "higher")])
        start = _set_xcode(_BASE_GENOME, 1, 0, param_value_to_xcode(1922, 0, 3843))
        rng = random.Random(8)
        increased = 0
        n = 10000
        for _ in range(n):
            res = mutate_directed(start, [None, brain, None, None], rng, rate=1.0)
            new_param = xcode_to_param_value(decode_xcode(res, 1, 0), 0, 3843)
            if new_param > 1922:
                increased += 1
        frac = increased / n
        assert 0.68 < frac < 0.72, f"higher-bias increased fraction {frac:.3f} outside [0.68,0.72]"


class TestBoundaryClamping:
    def test_clamp_at_lower_bound(self) -> None:
        brain = make_brain([ParameterSchemaField("p", "x", 0, 1, 5, 1, "lower")])
        start = _set_xcode(_BASE_GENOME, 1, 0, param_value_to_xcode(1, 1, 5))
        rng = random.Random(9)
        for _ in range(1000):
            res = mutate_directed(start, [None, brain, None, None], rng, rate=1.0)
            new_param = xcode_to_param_value(decode_xcode(res, 1, 0), 1, 5)
            assert new_param >= 1

    def test_clamp_at_upper_bound(self) -> None:
        brain = make_brain([ParameterSchemaField("p", "x", 0, 1, 5, 5, "higher")])
        start = _set_xcode(_BASE_GENOME, 1, 0, param_value_to_xcode(5, 1, 5))
        rng = random.Random(10)
        for _ in range(1000):
            res = mutate_directed(start, [None, brain, None, None], rng, rate=1.0)
            new_param = xcode_to_param_value(decode_xcode(res, 1, 0), 1, 5)
            assert new_param <= 5


class TestPerXcodeIsolation:
    def test_unschemaed_xcodes_unchanged(self) -> None:
        """A schema referencing only xcode 5 must not change xcode 3."""
        brain = make_brain([ParameterSchemaField("p", "x", 5, 0, 3843, 100, "none")])
        # Pin xcode 3 of slot 1 to a known value.
        start = _set_xcode(_BASE_GENOME, 1, 3, 1234)
        rng = random.Random(11)
        for _ in range(50):
            res = mutate_directed(start, [None, brain, None, None], rng, rate=1.0)
            assert decode_xcode(res, 1, 3) == 1234


class TestChecksumValidAfterMutation:
    def test_validity_at_max_rate(self) -> None:
        brain = make_brain([
            ParameterSchemaField(f"p{i}", "x", i, 1, 100, 50, "none") for i in range(5)
        ])
        rng = random.Random(13)
        for _ in range(20):
            res = mutate_directed(_BASE_GENOME, [None, brain, None, None], rng, rate=1.0)
            assert validate(res).valid
