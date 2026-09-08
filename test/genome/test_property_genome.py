"""test_property_genome.py — Property-based genome codec tests (T9, PKT-P1).

Uses Hypothesis to verify:
1. decode(encode(x)) == x (round-trip)
2. Any single-char change to the mutable body fails checksum
3. Every ±1 mutation yields either a valid genome or an explicit typed error

Runtime target: < 30 seconds in CI.
"""

from __future__ import annotations

import pytest
from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st

from alienclaw.genome.alphabet import ALPHABET, GENOME_LENGTH, SECTION_LENGTH
from alienclaw.genome.codec import assemble, parse, round_trip_check
from alienclaw.genome.checksum import compute_checksum, verify_checksum

ALPHABET_STR = ALPHABET

# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

@st.composite
def section64(draw: st.DrawFn) -> str:
    return "".join(draw(st.sampled_from(ALPHABET_STR)) for _ in range(SECTION_LENGTH))


@st.composite
def valid_genome(draw: st.DrawFn) -> str:
    identity = draw(section64())
    execution = draw(section64())
    behavior = draw(section64())
    return assemble(identity, execution, behavior)


# ---------------------------------------------------------------------------
# Property 1: round-trip
# ---------------------------------------------------------------------------

@given(section64(), section64(), section64())
@settings(max_examples=200, deadline=None, suppress_health_check=[HealthCheck.too_slow])
def test_roundtrip_encode_decode(identity: str, execution: str, behavior: str) -> None:
    """assemble then parse should recover the original three sections."""
    genome = assemble(identity, execution, behavior)
    parsed = parse(genome)
    assert parsed.identity  == identity
    assert parsed.execution == execution
    assert parsed.behavior  == behavior


@given(valid_genome())
@settings(max_examples=200, deadline=None)
def test_roundtrip_full(genome: str) -> None:
    """round_trip_check must be True for any assembled genome."""
    assert round_trip_check(genome)


# ---------------------------------------------------------------------------
# Property 2: single-char body mutation fails checksum
# ---------------------------------------------------------------------------

@given(valid_genome(), st.integers(min_value=0, max_value=191))
@settings(max_examples=200, deadline=None)
def test_body_mutation_invalidates_checksum(genome: str, position: int) -> None:
    """Flipping any char in positions 0..191 must produce a checksum mismatch."""
    idx = ALPHABET_STR.index(genome[position])
    next_char = ALPHABET_STR[(idx + 1) % len(ALPHABET_STR)]
    mutated = genome[:position] + next_char + genome[position + 1:]
    assert len(mutated) == GENOME_LENGTH
    # The checksum must no longer verify
    assert not verify_checksum(mutated), (
        f"Mutation at position {position} did not invalidate checksum\n"
        f"original={genome!r}\nmutated={mutated!r}"
    )


# ---------------------------------------------------------------------------
# Property 3: ±1 mutation yields valid genome OR explicit ValueError
# ---------------------------------------------------------------------------

@given(valid_genome(), st.integers(min_value=0, max_value=GENOME_LENGTH - 1))
@settings(max_examples=200, deadline=None)
def test_mutation_yields_valid_or_explicit_error(genome: str, position: int) -> None:
    """Every ±1 mutation either produces a valid genome or raises ValueError."""
    idx = ALPHABET_STR.index(genome[position])
    next_char = ALPHABET_STR[(idx + 1) % len(ALPHABET_STR)]
    mutated = genome[:position] + next_char + genome[position + 1:]

    try:
        parsed = parse(mutated)
        # If parse succeeds, the genome must actually have a valid checksum
        assert verify_checksum(mutated)
        # And parse must be deterministic
        parsed2 = parse(mutated)
        assert parsed.identity  == parsed2.identity
        assert parsed.execution == parsed2.execution
        assert parsed.behavior  == parsed2.behavior
    except ValueError:
        # Explicit error is acceptable
        pass


# ---------------------------------------------------------------------------
# Property: non-Base62 chars are always rejected
# ---------------------------------------------------------------------------

NON_BASE62 = ["!", "@", " ", "\n", "\0", "+", "/", "="]


@given(valid_genome(), st.integers(min_value=0, max_value=GENOME_LENGTH - 1),
       st.sampled_from(NON_BASE62))
@settings(max_examples=200, deadline=None)
def test_non_base62_always_rejected(genome: str, position: int, bad_char: str) -> None:
    """Inserting any non-Base62 character must cause parse() to raise ValueError."""
    mutated = genome[:position] + bad_char + genome[position + 1:]
    with pytest.raises(ValueError):
        parse(mutated)


# ---------------------------------------------------------------------------
# Property: wrong-length inputs always rejected
# ---------------------------------------------------------------------------

@given(st.text(alphabet=ALPHABET_STR, min_size=0, max_size=255))
@settings(max_examples=100, deadline=None)
def test_short_genome_rejected(short: str) -> None:
    with pytest.raises(ValueError, match="256"):
        parse(short)


@given(st.text(alphabet=ALPHABET_STR, min_size=257, max_size=300))
@settings(max_examples=100, deadline=None)
def test_long_genome_rejected(long: str) -> None:
    with pytest.raises(ValueError, match="256"):
        parse(long)


# ---------------------------------------------------------------------------
# Cross-language consistency note
#
# Both TS and Python codecs are tested against the shared fixture file at
# test/fixtures/genome-spec-fixtures.json. The property tests above verify
# the Python codec's invariants. For cross-language equivalence, the fixture
# runner tests (test/genome/ts-fixture-runner.test.ts + test_fixtures.py)
# assert that both codecs produce identical results for every fixture case.
# ---------------------------------------------------------------------------
