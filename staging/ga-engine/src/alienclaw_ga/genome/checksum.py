"""Genome checksum computation.

Implements the dual-hash FNV-1a-inspired algorithm from GENOME_SPEC.md §9
and the canonical TypeScript codec at
src/alienclaw/registry/genome-codec.ts:60-87.

The algorithm uses TWO 32-bit rolling hash values (a, b) rather than
standard single-value FNV-1a:

    a starts at 0x811c9dc5 (standard FNV-1a offset basis)
    b starts at 0xc59d1c81 (reversed byte order of the FNV-1a offset)

For each character c in the 192-char input (sections 0-2):
    a = ((a XOR charCode(c)) * 0x01000193) mod 2^32
    b = ((b XOR (charCode(c) >> 4)) * 0x01000193) mod 2^32

Then the 64-char checksum is produced by a mixing loop:
    hi = a, lo = b
    for i in 0..63:
        idx = (hi XOR lo XOR i) mod 62
        output[i] = ALPHABET[idx]
        hi = (hi * 31 + lo + i) mod 2^32
        lo = (lo * 37 + hi) mod 2^32

Cross-language compliance: this implementation MUST produce byte-identical
output to the TypeScript for every input. The shared fixture in
test/fixtures/genome-spec-fixtures.json contains checksum test cases
that lock this invariant.
"""

from __future__ import annotations

from .alphabet import ALPHABET, MUTABLE_LENGTH, SECTION_LENGTH

# ---------------------------------------------------------------------------
# Algorithm constants (mirror genome-codec.ts exactly)
# ---------------------------------------------------------------------------

_FNV_A_INIT: int = 0x811C9DC5
_FNV_B_INIT: int = 0xC59D1C81
_FNV_PRIME: int = 0x01000193
_MASK32: int = 0xFFFFFFFF


def compute_checksum(sections012: str) -> str:
    """Compute the 64-character Base62 checksum of the 192-char mutable body.

    Args:
        sections012: The first 192 characters of a genome (IDENTITY +
            EXECUTION + BEHAVIOR sections). Must be exactly 192 chars.

    Returns:
        A 64-character Base62 checksum string.

    Raises:
        ValueError: if sections012 is not exactly 192 characters.

    Example:
        checksum = compute_checksum(genome[:192])
        assert len(checksum) == 64
    """
    expected = MUTABLE_LENGTH
    if len(sections012) != expected:
        raise ValueError(
            f"compute_checksum: expected {expected} chars, got {len(sections012)}"
        )

    # Phase 1: rolling dual-hash over every character
    a: int = _FNV_A_INIT
    b: int = _FNV_B_INIT
    for ch_val in (ord(c) for c in sections012):
        a = ((a ^ ch_val) * _FNV_PRIME) & _MASK32
        b = ((b ^ (ch_val >> 4)) * _FNV_PRIME) & _MASK32

    # Phase 2: mixing loop to produce 64 Base62 characters.
    # JavaScript's bitwise XOR converts operands to signed Int32, so (hi ^ lo ^ i)
    # may be negative when the high bit of the 32-bit result is set.
    # JavaScript's `%` operator truncates toward zero (result shares sign with dividend),
    # and `Math.abs` is then applied. This differs from Python's `%` which always
    # returns a non-negative result for a positive divisor.
    #
    # Fix: interpret the XOR result as a signed Int32, then use abs(signed_value) % 62.
    # This is equivalent to JS's `Math.abs((signed_int32_xor) % 62)`.
    digits: list[str] = []
    hi: int = a
    lo: int = b
    for i in range(SECTION_LENGTH):
        raw = (hi ^ lo ^ i) & _MASK32
        # Replicate JavaScript's signed Int32 interpretation of the XOR result:
        signed = raw if raw < 0x80000000 else raw - 0x100000000
        idx = abs(signed) % 62
        digits.append(ALPHABET[idx])
        # Update hi before lo (matches TS: hi updated first, then lo uses new hi)
        hi = (hi * 31 + lo + i) & _MASK32
        lo = (lo * 37 + hi) & _MASK32

    return "".join(digits)


def verify_checksum(genome: str) -> bool:
    """Return True iff the genome's stored checksum matches its computed checksum.

    Args:
        genome: A 256-character string (length not verified here; caller
            is responsible for ensuring correct length).

    Returns:
        True if the last 64 characters equal compute_checksum(genome[:192]).
    """
    stored = genome[192:]
    expected = compute_checksum(genome[:192])
    return stored == expected
