"""Base62 alphabet constants and structural validators.

Per GENOME_SPEC.md §3, the alphabet is the 62 characters
'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
in that exact order. Matches the TypeScript canonical implementation at
src/alienclaw/registry/genome-codec.ts:18.

Properties: filename-safe, URL-safe, shell-safe — no '+', '/', '='
from Base64. Case-sensitive: 'A' != 'a'.
"""

from __future__ import annotations

import random as _random

# ---------------------------------------------------------------------------
# Constants (mirror genome-codec.ts exactly)
# ---------------------------------------------------------------------------

ALPHABET: str = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
"""62-character Base62 alphabet. Locked by GENOME_SPEC.md §3."""

assert len(ALPHABET) == 62, "BUG: alphabet must have exactly 62 characters"

ALPHABET_SET: frozenset[str] = frozenset(ALPHABET)
"""Fast O(1) membership test for valid genome characters."""

ALPHABET_INDEX: dict[str, int] = {c: i for i, c in enumerate(ALPHABET)}
"""Reverse mapping: character → 0-based index in ALPHABET."""

GENOME_LENGTH: int = 256
"""Total genome length in characters. Locked by GENOME_SPEC.md §4."""

SECTION_LENGTH: int = 64
"""Length of each genome section. Four sections × 64 = 256 chars."""

NUM_SECTIONS: int = 4
"""Number of genome sections: IDENTITY, EXECUTION, BEHAVIOR, CHECKSUM."""

MUTABLE_LENGTH: int = SECTION_LENGTH * (NUM_SECTIONS - 1)  # 192
"""Length of the mutable portion (sections 0-2). CHECKSUM is never mutated directly."""

# Section index constants (mirror genome-codec.ts SECTION object)
SECTION_IDENTITY: int = 0
SECTION_EXECUTION: int = 1
SECTION_BEHAVIOR: int = 2
SECTION_CHECKSUM: int = 3

# ID-tag protection: the first 8 characters of the IDENTITY section
# are the Martian ID tag and MUST NOT be mutated. Per GENOME_SPEC.md §7.
ID_TAG_START: int = 0
ID_TAG_END: int = 8  # exclusive — chars 0..7


# ---------------------------------------------------------------------------
# Character-level helpers
# ---------------------------------------------------------------------------

def char_to_index(c: str) -> int:
    """Return the 0-based index of a Base62 character.

    Args:
        c: A single character from ALPHABET.

    Returns:
        Index in [0, 61].

    Raises:
        KeyError: if c is not in the alphabet.
    """
    return ALPHABET_INDEX[c]


def index_to_char(i: int) -> str:
    """Return the Base62 character at the given 0-based index.

    Args:
        i: Index in [0, 61].

    Returns:
        The corresponding character from ALPHABET.

    Raises:
        IndexError: if i is out of [0, 61].
    """
    if i < 0 or i >= len(ALPHABET):
        raise IndexError(f"index {i} is out of range [0, {len(ALPHABET) - 1}]")
    return ALPHABET[i]


# ---------------------------------------------------------------------------
# Structural validators
# ---------------------------------------------------------------------------

def is_valid_genome_string(s: str) -> bool:
    """Return True iff s is a structurally valid genome string.

    Checks only length (256) and alphabet membership. Does NOT verify
    checksum — use genome.validation.validate() for full validation.

    Args:
        s: Candidate genome string.

    Returns:
        True if length is 256 and every character is in ALPHABET.
    """
    if len(s) != GENOME_LENGTH:
        return False
    return all(c in ALPHABET_SET for c in s)


def validate_section(section: str, name: str) -> None:
    """Assert that a section string is exactly SECTION_LENGTH Base62 chars.

    Args:
        section: Candidate section string.
        name: Human-readable section name for error messages.

    Raises:
        ValueError: if section is wrong length or contains non-Base62 chars.
    """
    if len(section) != SECTION_LENGTH:
        raise ValueError(
            f"{name} section must be exactly {SECTION_LENGTH} chars; "
            f"got {len(section)}"
        )
    bad = [c for c in section if c not in ALPHABET_SET]
    if bad:
        raise ValueError(
            f"{name} section contains non-Base62 characters: "
            f"{bad[:5]!r}{'...' if len(bad) > 5 else ''}"
        )


# ---------------------------------------------------------------------------
# Random genome generator
# ---------------------------------------------------------------------------

def random_genome_chars(rng: _random.Random, length: int = GENOME_LENGTH) -> str:
    """Generate a random Base62 string of the given length using the provided RNG.

    This is the low-level helper used by operators.py. Callers that want
    a *valid* genome (with correct checksum) should use
    genome.operators.random_genome() instead.

    Args:
        rng: Seeded random.Random instance.
        length: Number of characters to generate (default: GENOME_LENGTH).

    Returns:
        A random Base62 string of the given length.
    """
    return "".join(rng.choices(ALPHABET, k=length))
