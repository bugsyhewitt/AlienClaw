"""Genome validation module.

Provides a single validate() entry point that runs all spec-mandated
checks and returns a structured ValidationResult. Used by:
- Leaderboard server (Packet 10) before accepting genome submissions
- operators.py post-mutation/crossover sanity checks
- Anywhere a genome arrives from an untrusted source

Checks performed (per GENOME_SPEC.md §10):
1. Length must be exactly 256 characters
2. All characters must be in the Base62 alphabet
3. Checksum must match compute_checksum(genome[:192])
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .alphabet import ALPHABET_SET, GENOME_LENGTH
from .checksum import compute_checksum


@dataclass(frozen=True)
class ValidationResult:
    """Result of genome validation.

    Attributes:
        valid:  True iff all validation checks passed.
        errors: List of human-readable error descriptions. Empty if valid.
    """

    valid: bool
    errors: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.valid


def validate(genome: str) -> ValidationResult:
    """Validate a genome string against GENOME_SPEC.md §10.

    Mirrors TypeScript validateGenome() in genome-codec.ts:102-127.

    Args:
        genome: Candidate genome string (any length, any content).

    Returns:
        ValidationResult with valid=True and empty errors on success,
        or valid=False with one or more error descriptions on failure.

    Example:
        result = validate(some_string)
        if not result:
            print(result.errors)
    """
    errors: list[str] = []

    if not isinstance(genome, str):
        return ValidationResult(valid=False, errors=["Genome must be a string"])

    if len(genome) != GENOME_LENGTH:
        errors.append(
            f"Length must be {GENOME_LENGTH}, got {len(genome)}"
        )
        return ValidationResult(valid=False, errors=errors)

    bad = [c for c in genome if c not in ALPHABET_SET]
    if bad:
        errors.append(
            "Genome must contain only Base62 characters (0-9, A-Z, a-z); "
            f"found: {bad[:5]!r}{'...' if len(bad) > 5 else ''}"
        )

    if not errors:
        body = genome[:192]
        stored = genome[192:]
        expected = compute_checksum(body)
        if stored != expected:
            errors.append(
                f'Checksum mismatch: stored="{stored}", expected="{expected}"'
            )

    return ValidationResult(valid=len(errors) == 0, errors=errors)
