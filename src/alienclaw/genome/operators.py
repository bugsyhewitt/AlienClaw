"""Genome mutation and crossover operators.

Implements GENOME_SPEC.md §7 (mutation) and §8 (crossover).

Both operators require an explicit random.Random instance for determinism.
Tests seed the RNG; production code passes a properly-seeded RNG.

Mutation:
    Per-character random Base62 substitution at rate 1/256 per character
    per generation (MUTATION_RATE). The ID-tag positions (chars 0-7 of the
    IDENTITY section) are NEVER mutated — they are the stable Martian
    identifier. After substitution, the CHECKSUM section is recomputed so
    the result is always a valid genome.

Crossover:
    Section-boundary single-point crossover between two parent genomes.
    Each of the three mutable sections (IDENTITY, EXECUTION, BEHAVIOR) is
    independently chosen from parent_a or parent_b with 50/50 probability.
    The CHECKSUM section is always recomputed for the child — it is NEVER
    inherited from either parent. Yields 2^3 = 8 possible section assignment
    patterns per parent pair.

Population seeding:
    random_genome() generates a complete valid genome from random section
    content. The ID-tag field is NOT randomized — callers must provide a
    valid ID tag and namespace prefix.
"""

from __future__ import annotations

import random

from .alphabet import (
    ALPHABET,
    GENOME_LENGTH,
    ID_TAG_END,
    MUTABLE_LENGTH,
    SECTION_LENGTH,
    random_genome_chars,
)
from .checksum import compute_checksum
from .codec import assemble

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MUTATION_RATE: float = 1.0 / 256.0
"""Per-character mutation probability per generation. GENOME_SPEC.md §7."""

# Mutable range within the genome body: chars 8..191 (excluding ID tag 0..7)
_MUTABLE_START: int = ID_TAG_END     # 8  (first mutable position after ID tag)
_MUTABLE_END: int = MUTABLE_LENGTH   # 192


# ---------------------------------------------------------------------------
# Mutation
# ---------------------------------------------------------------------------

def mutate(
    genome: str,
    rng: random.Random,
    rate: float = MUTATION_RATE,
) -> str:
    """Apply per-character Base62 mutation at the given rate.

    The ID-tag positions (chars 0-7 of IDENTITY) are protected and NEVER
    mutated. After any substitutions, the CHECKSUM section (chars 192-255)
    is recomputed so the result is always a valid genome.

    Args:
        genome: A valid 256-char Base62 genome string.
        rng:    Seeded random.Random instance for determinism.
        rate:   Per-character mutation probability. Default: 1/256.

    Returns:
        A 256-char Base62 string that passes full validation. May be
        identical to the input if no characters were flipped.

    Raises:
        ValueError: if genome is not a valid 256-char Base62 string.
    """
    if len(genome) != GENOME_LENGTH:
        raise ValueError(
            f"genome must be exactly {GENOME_LENGTH} chars; got {len(genome)}"
        )

    body = list(genome[:MUTABLE_LENGTH])

    # Mutate chars 8..191 only (ID-tag chars 0..7 are protected)
    for i in range(_MUTABLE_START, _MUTABLE_END):
        if rng.random() < rate:
            body[i] = rng.choice(ALPHABET)

    new_body = "".join(body)
    new_checksum = compute_checksum(new_body)
    return new_body + new_checksum


# ---------------------------------------------------------------------------
# Crossover
# ---------------------------------------------------------------------------

def crossover(
    parent_a: str,
    parent_b: str,
    rng: random.Random,
) -> str:
    """Produce a child genome via section-boundary crossover.

    Each of the three mutable sections (IDENTITY, EXECUTION, BEHAVIOR) is
    independently chosen from parent_a or parent_b with 50/50 probability.
    The CHECKSUM is always recomputed for the child.

    Args:
        parent_a: A valid 256-char Base62 genome string.
        parent_b: A valid 256-char Base62 genome string.
        rng:      Seeded random.Random instance.

    Returns:
        A 256-char Base62 child genome that passes full validation.

    Raises:
        ValueError: if either parent is not 256 chars.
    """
    if len(parent_a) != GENOME_LENGTH or len(parent_b) != GENOME_LENGTH:
        raise ValueError(
            f"Both parents must be {GENOME_LENGTH} chars; "
            f"got {len(parent_a)} and {len(parent_b)}"
        )

    s = SECTION_LENGTH
    child_sections: list[str] = []
    for i in range(3):  # sections 0, 1, 2 (not checksum)
        start = i * s
        end = start + s
        if rng.random() < 0.5:
            child_sections.append(parent_a[start:end])
        else:
            child_sections.append(parent_b[start:end])

    identity, execution, behavior = child_sections
    return assemble(identity, execution, behavior)


# ---------------------------------------------------------------------------
# Population seeding
# ---------------------------------------------------------------------------

def random_genome(
    rng: random.Random,
    id_tag: str,
    namespace: str = "AlienClaw1",
) -> str:
    """Generate a random but valid genome for use in new population seeding.

    The ID tag and namespace are pinned; all other positions in all three
    mutable sections are randomized. The CHECKSUM is computed fresh.

    Args:
        rng:       Seeded random.Random instance.
        id_tag:    8-char Base62 Martian ID tag (e.g. 'WEB00001').
        namespace: 10-char origin namespace (default: 'AlienClaw1').

    Returns:
        A valid 256-char genome string.

    Raises:
        ValueError: if id_tag is not 8 chars or namespace is not 10 chars.
    """
    if len(id_tag) != 8:
        raise ValueError(f"id_tag must be 8 chars; got {len(id_tag)!r}")
    if len(namespace) != 10:
        raise ValueError(f"namespace must be 10 chars; got {len(namespace)!r}")

    # IDENTITY: fixed prefix (id_tag 8 + generation 2 + namespace 10 = 20 chars)
    # then random Base62 for the remaining 44 chars
    generation = "G1"
    identity_prefix = id_tag + generation + namespace
    identity_tail = random_genome_chars(rng, SECTION_LENGTH - len(identity_prefix))
    identity = identity_prefix + identity_tail

    execution = random_genome_chars(rng, SECTION_LENGTH)
    behavior = random_genome_chars(rng, SECTION_LENGTH)

    return assemble(identity, execution, behavior)
