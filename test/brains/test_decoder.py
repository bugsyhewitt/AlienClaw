"""Direct unit tests for alienclaw.brains.decoder (decode_params).

decode_params bridges genome content and runner behavior: Xcodes (2-char
Base62 pairs) are read from a genome slot (0=IDENTITY, 1=EXECUTION,
2=BEHAVIOR, 3=CHECKSUM per GENOME_SPEC.md) and mapped linearly onto each
field's declared natural range. Decode errors never raise — they fall back
to the field's default.

The genome fixture is real: minted via genome.operators.random_genome with
a seeded RNG, so every test is deterministic with no fixture files.
"""
import random

import pytest

from alienclaw.brains.decoder import decode_params
from alienclaw.brains.types import BrainSpec, GenomeSectionDocs, ParameterSchemaField
from alienclaw.genome.alphabet import ALPHABET_INDEX
from alienclaw.genome.codec import (
    assemble,
    decode_xcode,
    encode_xcode,
    xcode_to_param_value,
)
from alienclaw.genome.operators import random_genome


def _field(name="p", xcode_index=0, range_min=1, range_max=5, default=3, direction="none"):
    return ParameterSchemaField(
        name=name,
        description=f"param {name}",
        xcode_index=xcode_index,
        range_min=range_min,
        range_max=range_max,
        default=default,
        direction=direction,
    )


def _brain(*fields: ParameterSchemaField) -> BrainSpec:
    return BrainSpec(
        tool="compute",
        version="1.0",
        capabilities="c",
        limitations="l",
        failure_modes="f",
        best_practices="b",
        execution_order=("1. run",),
        output_contract='{"result": "number"}',
        genome_sections=GenomeSectionDocs(identity="i", execution="e", behavior="b", checksum="c"),
        variables={},
        parameter_schema=tuple(fields),
    )


# Xcode value 3843 maps to range_max; range 0..3843 makes decoding the
# identity mapping (span == XCODE_MAX + 1), so raw Xcodes surface exactly.
_WIDE = dict(range_min=0, range_max=3843, default=-1)


def _crafted_genome(exec_xcodes=(), behavior_xcodes=()) -> str:
    """Assemble a valid genome whose EXECUTION/BEHAVIOR Xcodes are known exactly.

    Xcode i of a slot occupies slot-local chars 1+2i..2+2i; all other
    positions are '0' filler (Xcode value 0).
    """
    identity = "COMPUT01" + "G1" + "AlienClaw1" + "0" * 44

    def build(xcodes):
        chars = ["0"] * 64
        for idx, value in xcodes:
            enc = encode_xcode(value)
            chars[1 + idx * 2] = enc[0]
            chars[2 + idx * 2] = enc[1]
        return "".join(chars)

    return assemble(identity, build(exec_xcodes), build(behavior_xcodes))


@pytest.fixture()
def genome() -> str:
    """A real, valid, fully deterministic genome (seeded RNG, pinned ID tag)."""
    return random_genome(random.Random(42), "COMPUT01")


class TestInputValidation:
    def test_short_genome_raises(self):
        with pytest.raises(ValueError, match="256"):
            decode_params(_brain(_field()), "0" * 255)

    def test_long_genome_raises(self):
        with pytest.raises(ValueError, match="256"):
            decode_params(_brain(_field()), "0" * 257)

    def test_length_checked_even_without_schema(self):
        # The length guard runs before the empty-schema shortcut.
        with pytest.raises(ValueError, match="256"):
            decode_params(_brain(), "")


class TestEmptySchema:
    def test_no_parameter_schema_returns_empty_dict(self, genome):
        assert decode_params(_brain(), genome) == {}


class TestSectionOffsets:
    def test_default_slot_is_execution_section(self, genome):
        brain = _brain(_field())
        assert decode_params(brain, genome) == decode_params(brain, genome, slot_index=1)

    def test_execution_and_behavior_slots_read_distinct_offsets(self):
        g = _crafted_genome(exec_xcodes=[(0, 1111)], behavior_xcodes=[(0, 2222)])
        brain = _brain(_field(name="raw", **_WIDE))
        assert decode_params(brain, g, slot_index=1) == {"raw": 1111}
        assert decode_params(brain, g, slot_index=2) == {"raw": 2222}

    def test_identity_slot_reads_chars_after_the_id_tag_start(self):
        g = _crafted_genome()
        brain = _brain(_field(name="raw", **_WIDE))
        # Slot 0, Xcode 0 = genome chars 1-2 = "OM" from the "COMPUT01" tag.
        expected = ALPHABET_INDEX["O"] * 62 + ALPHABET_INDEX["M"]
        assert decode_params(brain, g, slot_index=0) == {"raw": expected}

    def test_checksum_slot_is_addressable(self, genome):
        brain = _brain(_field(name="raw", **_WIDE))
        # Slot 3, Xcode 0 = genome chars 193-194 (inside the CHECKSUM section).
        expected = ALPHABET_INDEX[genome[193]] * 62 + ALPHABET_INDEX[genome[194]]
        assert decode_params(brain, genome, slot_index=3) == {"raw": expected}


class TestParameterMapping:
    def test_xcode_zero_maps_to_range_min(self):
        g = _crafted_genome()  # every Xcode is 0
        params = decode_params(_brain(_field(range_min=1, range_max=5, default=9)), g)
        assert params == {"p": 1}  # default=9 proves this decoded, not fell back

    def test_xcode_max_maps_to_range_max(self):
        g = _crafted_genome(exec_xcodes=[(0, 3843)])
        params = decode_params(_brain(_field(range_min=1, range_max=5, default=9)), g)
        assert params == {"p": 5}

    def test_all_31_xcode_indexes_decode_within_declared_range(self, genome):
        fields = [
            _field(name=f"p{i}", xcode_index=i, range_min=2, range_max=7, default=0)
            for i in range(31)
        ]
        params = decode_params(_brain(*fields), genome)
        assert set(params) == {f.name for f in fields}
        assert all(2 <= v <= 7 for v in params.values())

    def test_matches_manual_decode_of_real_genome(self, genome):
        fields = [
            _field(name="a", xcode_index=0, range_min=1, range_max=5, default=0),
            _field(name="b", xcode_index=7, range_min=0, range_max=100, default=0),
            _field(name="c", xcode_index=30, range_min=10, range_max=20, default=0),
        ]
        params = decode_params(_brain(*fields), genome)
        for f in fields:
            raw = decode_xcode(genome, 1, f.xcode_index)
            assert params[f.name] == xcode_to_param_value(raw, f.range_min, f.range_max)


class TestFallbackToDefault:
    def test_xcode_index_out_of_range_falls_back(self, genome):
        params = decode_params(_brain(_field(xcode_index=31, default=42)), genome)
        assert params == {"p": 42}

    def test_slot_index_out_of_range_falls_back(self, genome):
        params = decode_params(_brain(_field(default=42)), genome, slot_index=4)
        assert params == {"p": 42}

    def test_negative_slot_index_falls_back(self, genome):
        params = decode_params(_brain(_field(default=42)), genome, slot_index=-1)
        assert params == {"p": 42}

    def test_non_base62_genome_falls_back_per_field(self):
        # decode_params validates only length; bad characters surface as
        # per-field decode errors, which never raise.
        garbage = "!" * 256
        brain = _brain(_field(name="x", default=5), _field(name="y", xcode_index=1, default=7))
        assert decode_params(brain, garbage) == {"x": 5, "y": 7}

    def test_good_and_bad_fields_decode_independently(self, genome):
        good = _field(name="good", **_WIDE)
        bad = _field(name="bad", xcode_index=31, default=42)
        params = decode_params(_brain(good, bad), genome)
        assert params["bad"] == 42
        assert params["good"] == decode_xcode(genome, 1, 0)
