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
