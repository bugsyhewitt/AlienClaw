"""Genome encode/decode operations.

Mirrors the TypeScript canonical codec at
src/alienclaw/registry/genome-codec.ts (parseGenome, assembleGenome).

The codec works with raw 64-character section strings. Callers that need
to interpret sub-field semantics (retry count, escalation mode, etc.)
should use the ParsedGenome property accessors defined in types.py.

Cross-language compliance: assemble() and parse() must produce identical
results to assembleGenome() and parseGenome() in the TypeScript codec.
The shared fixture (test/fixtures/genome-spec-fixtures.json) locks this.
"""

from __future__ import annotations

from .alphabet import (
    ALPHABET_SET,
    GENOME_LENGTH,
    SECTION_LENGTH,
    validate_section,
)
from .checksum import compute_checksum, verify_checksum
from .types import ParsedGenome


def parse(genome: str) -> ParsedGenome:
    """Parse a 256-char Base62 genome string into its four sections.

    Mirrors TypeScript parseGenome() in genome-codec.ts:89-100.

    Args:
        genome: A 256-character Base62 string.

    Returns:
        ParsedGenome with four 64-character section strings.

    Raises:
        ValueError: if the genome is not 256 chars, contains non-Base62
            characters, or fails checksum validation.
    """
    if len(genome) != GENOME_LENGTH:
        raise ValueError(
            f"Genome must be exactly {GENOME_LENGTH} chars; got {len(genome)}"
        )

    bad = [c for c in genome if c not in ALPHABET_SET]
    if bad:
        raise ValueError(
            f"Genome contains non-Base62 characters: "
            f"{bad[:5]!r}{'...' if len(bad) > 5 else ''}"
        )

    if not verify_checksum(genome):
        stored = genome[192:]
        expected = compute_checksum(genome[:192])
        raise ValueError(
            f"Checksum mismatch: stored={stored!r}, expected={expected!r}"
        )

    s = SECTION_LENGTH
    return ParsedGenome(
        identity=genome[0:s],
        execution=genome[s : s * 2],
        behavior=genome[s * 2 : s * 3],
        checksum=genome[s * 3 :],
    )


def assemble(identity: str, execution: str, behavior: str) -> str:
    """Assemble a valid 256-char genome string from three mutable sections.

    Mirrors TypeScript assembleGenome() in genome-codec.ts:133-153.
    The checksum section is computed automatically — callers never supply it.

    Args:
        identity:  64-char Base62 IDENTITY section.
        execution: 64-char Base62 EXECUTION section.
        behavior:  64-char Base62 BEHAVIOR section.

    Returns:
        A 256-character genome string with a freshly-computed checksum.

    Raises:
        ValueError: if any section is not exactly 64 Base62 characters.
    """
    for section, name in (
        (identity, "IDENTITY"),
        (execution, "EXECUTION"),
        (behavior, "BEHAVIOR"),
    ):
        validate_section(section, name)

    body = identity + execution + behavior
    checksum = compute_checksum(body)
    return body + checksum


def round_trip_check(genome: str) -> bool:
    """Verify that parse(genome) re-encoded equals the original.

    A False return indicates a bug — the spec mandates that all bytes
    (including reserved padding zeros) survive a round-trip unchanged.

    Args:
        genome: A 256-character Base62 string (not pre-validated).

    Returns:
        True if encode(decode(genome)) == genome. False if round-trip fails
        OR if genome is invalid (parse() would raise).
    """
    try:
        parsed = parse(genome)
        return parsed.full() == genome
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# Xcode encoding helpers (ARCHITECTURE §3)
# ---------------------------------------------------------------------------

XCODE_MAX: int = 62 * 62 - 1  # 3843

# Re-export ALPHABET and ALPHABET_INDEX from alphabet module for Xcode use
_XCODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
_XCODE_INDEX = {c: i for i, c in enumerate(_XCODE_ALPHABET)}


def decode_xcode(genome: str, slot_index: int, xcode_index: int) -> int:
    """Read one Xcode (2 Base62 chars) from a genome slot.

    slot_index: 0..3 (which 64-char section)
    xcode_index: 0..30 (which Xcode pair within bytes 1-62 of the slot)
    Returns: int in [0, XCODE_MAX]
    """
    if not (0 <= slot_index <= 3):
        raise ValueError(f"slot_index out of range [0,3]: {slot_index}")
    if not (0 <= xcode_index <= 30):
        raise ValueError(f"xcode_index out of range [0,30]: {xcode_index}")
    base = slot_index * 64 + 1 + xcode_index * 2
    return _XCODE_INDEX[genome[base]] * 62 + _XCODE_INDEX[genome[base + 1]]


def encode_xcode(value: int) -> str:
    """Encode an int in [0, XCODE_MAX] as 2 Base62 chars."""
    if not (0 <= value <= XCODE_MAX):
        raise ValueError(f"xcode value out of range [0,{XCODE_MAX}]: {value}")
    return _XCODE_ALPHABET[value // 62] + _XCODE_ALPHABET[value % 62]


def xcode_to_param_value(xcode_value: int, range_min: int, range_max: int) -> int:
    """Map Xcode value (0..3843) to parameter value (range_min..range_max) linearly."""
    if range_min > range_max:
        raise ValueError(f"range_min > range_max: {range_min}, {range_max}")
    span = range_max - range_min + 1
    return (xcode_value * span) // (XCODE_MAX + 1) + range_min


def param_value_to_xcode(param_value: int, range_min: int, range_max: int) -> int:
    """Inverse of xcode_to_param_value (returns minimum Xcode that maps to param_value)."""
    if not (range_min <= param_value <= range_max):
        raise ValueError(f"param_value {param_value} outside [{range_min},{range_max}]")
    span = range_max - range_min + 1
    # Smallest x such that (x * span) // (XCODE_MAX+1) >= param_value - range_min
    # => x >= ceil((param_value - range_min) * (XCODE_MAX+1) / span)
    numer = (param_value - range_min) * (XCODE_MAX + 1)
    return -(-numer // span)  # ceiling division
