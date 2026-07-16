"""Direct unit tests for alienclaw.genome.types (ParsedGenome).

ParsedGenome is a frozen value type over four raw 64-char sections plus
convenience accessors whose semantics are pinned by GENOME_SPEC.md
(identity layout §"Section 0", retry/backoff decode §"Section 1",
escalation mode §"Section 2").
"""
import dataclasses
import random

import pytest

from alienclaw.genome.codec import assemble, parse
from alienclaw.genome.operators import random_genome
from alienclaw.genome.types import ParsedGenome

SECTION_LENGTH = 64


def _pad(prefix: str) -> str:
    """Pad a section prefix with '0' filler to the 64-char section length."""
    assert len(prefix) <= SECTION_LENGTH
    return prefix + "0" * (SECTION_LENGTH - len(prefix))


def _make(identity="A", execution="B", behavior="C", checksum="D") -> ParsedGenome:
    return ParsedGenome(
        identity=_pad(identity),
        execution=_pad(execution),
        behavior=_pad(behavior),
        checksum=_pad(checksum),
    )


class TestBodyAndFull:
    def test_body_concatenates_the_three_mutable_sections(self):
        pg = _make()
        assert pg.body() == pg.identity + pg.execution + pg.behavior
        assert len(pg.body()) == 192

    def test_full_appends_checksum(self):
        pg = _make()
        assert pg.full() == pg.body() + pg.checksum
        assert len(pg.full()) == 256

    def test_construction_is_permissive_no_length_guards(self):
        # ParsedGenome has no __post_init__: enforcement of 64-char Base62
        # sections lives in codec.parse()/assemble(), not in the type.
        pg = ParsedGenome(identity="short", execution="", behavior="x", checksum="!!")
        assert pg.body() == "shortx"
        assert pg.full() == "shortx!!"


class TestIdentityAccessors:
    IDENTITY = "COMPUT01" + "G7" + "NamespaceX" + "F" * 44  # exactly 64 chars

    def test_id_tag_is_first_8_chars(self):
        pg = _make(identity=self.IDENTITY)
        assert pg.id_tag == "COMPUT01"

    def test_generation_marker_is_chars_8_to_10(self):
        pg = _make(identity=self.IDENTITY)
        assert pg.generation_marker == "G7"

    def test_namespace_is_chars_10_to_20(self):
        pg = _make(identity=self.IDENTITY)
        assert pg.namespace == "NamespaceX"


class TestExecutionDecoding:
    @pytest.mark.parametrize(
        ("char", "expected"),
        [
            ("0", 1),  # (48-48) % 5 + 1
            ("1", 2),
            ("3", 4),  # spec worked example 1
            ("4", 5),
            ("5", 1),  # wraps: digits map onto [1, 5] cyclically
            ("9", 5),
            ("A", 3),  # non-digit Base62 chars decode too: (65-48) % 5 + 1
            ("z", 5),
        ],
    )
    def test_retry_count_decode(self, char, expected):
        assert _make(execution=char + "0").retry_count == expected

    @pytest.mark.parametrize(
        ("char", "expected"),
        [
            ("0", 0),
            ("1", 500),
            ("9", 4500),  # top of the documented [0, 4500ms] range
            ("A", 3500),  # (65-48) % 10 * 500
            ("R", 2000),  # spec worked example 1
            ("z", 2000),
        ],
    )
    def test_backoff_ms_decode(self, char, expected):
        assert _make(execution="0" + char).backoff_ms == expected


class TestBehaviorDecoding:
    def test_fail_forward_true_for_capital_f(self):
        assert _make(behavior="F").fail_forward is True

    def test_fail_forward_false_for_escalate_std(self):
        assert _make(behavior="E").fail_forward is False

    @pytest.mark.parametrize("char", ["0", "e", "f", "z"])
    def test_fail_forward_defaults_false_for_any_other_char(self, char):
        # Case-sensitive: lowercase 'f' is NOT fail-forward.
        assert _make(behavior=char).fail_forward is False


class TestDataclassSemantics:
    def test_frozen(self):
        pg = _make()
        with pytest.raises(dataclasses.FrozenInstanceError):
            pg.identity = "X" * SECTION_LENGTH

    def test_equality_by_value(self):
        assert _make() == _make()
        assert _make(behavior="F") != _make(behavior="E")


class TestRealGenome:
    def test_parse_of_random_genome_populates_sections(self):
        genome = random_genome(random.Random(7), "WEB00001")
        pg = parse(genome)
        assert [len(s) for s in (pg.identity, pg.execution, pg.behavior, pg.checksum)] == [64] * 4
        assert pg.full() == genome
        assert pg.body() == genome[:192]
        assert pg.id_tag == "WEB00001"
        assert pg.generation_marker == "G1"
        assert pg.namespace == "AlienClaw1"

    def test_spec_worked_example_1(self):
        # GENOME_SPEC.md "Worked examples", Example 1 (MS_WEB00001).
        identity = _pad("WEB00001" + "G1" + "AlienClaw1" + "WebSearchFamily")
        execution = _pad("3RSequentialPerfBalanced")
        behavior = _pad("EscalateStdOutputJSONArray")
        pg = parse(assemble(identity, execution, behavior))
        assert pg.id_tag == "WEB00001"
        assert pg.generation_marker == "G1"
        assert pg.namespace == "AlienClaw1"
        assert pg.retry_count == 4  # (ord('3') - 48) % 5 + 1
        assert pg.backoff_ms == 2000  # (ord('R') - 48) % 10 * 500
        assert pg.fail_forward is False  # 'E' = EscalateStd
