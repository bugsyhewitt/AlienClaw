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
# Step-based directional mutation (ARCHITECTURE §5)
# ---------------------------------------------------------------------------
# Per ARCHITECTURE §5.1 — locked, do not tune in this packet
_STEP_DISTRIBUTION = [(1, 0.60), (2, 0.25), (3, 0.10), (4, 0.05)]
_DIRECTION_BIAS_LOWER = 0.70   # P(negative step)
_DIRECTION_BIAS_HIGHER = 0.30  # P(negative step)
_DIRECTION_BIAS_NONE = 0.50    # P(negative step)
# Per ARCHITECTURE §5.2: 2/256 ≈ 0.78% per Xcode
PER_XCODE_MUTATION_RATE: float = 2.0 / 256.0


def _sample_step_magnitude(rng: random.Random) -> int:
    r = rng.random()
    cumulative = 0.0
    for mag, prob in _STEP_DISTRIBUTION:
        cumulative += prob
        if r < cumulative:
            return mag
    return _STEP_DISTRIBUTION[-1][0]


# ---------------------------------------------------------------------------
# Mutation
# ---------------------------------------------------------------------------

def mutate(
    genome: str,
    rng: random.Random,
    rate: float = MUTATION_RATE,
) -> str:
    """Xcode-level mutation with direction=none (no brain). Operates on slots 1 and 2.

    Backward-compatible wrapper. Each of the 62 Xcodes in slots 1+2 mutates
    with probability `rate` per Xcode. After mutation, CHECKSUM recomputed.
    ID-tag (chars 0-7) never touched (in slot 0; we only mutate slots 1+2).

    Args:
        genome: A valid 256-char Base62 genome string.
        rng:    Seeded random.Random instance for determinism.
        rate:   Per-Xcode mutation probability. Default: 1/256.

    Returns:
        A 256-char Base62 string that passes full validation.

    Raises:
        ValueError: if genome is not a valid 256-char Base62 string.
    """
    from .codec import XCODE_MAX, _XCODE_INDEX, encode_xcode

    if len(genome) != GENOME_LENGTH:
        raise ValueError(
            f"genome must be exactly {GENOME_LENGTH} chars; got {len(genome)}"
        )

    chars = list(genome[:MUTABLE_LENGTH])
    for slot_idx in (1, 2):  # EXECUTION and BEHAVIOR sections
        for xcode_idx in range(31):  # 31 Xcodes per slot
            if rng.random() < rate:
                base = slot_idx * 64 + 1 + xcode_idx * 2
                current = _XCODE_INDEX[chars[base]] * 62 + _XCODE_INDEX[chars[base + 1]]
                step_mag = _sample_step_magnitude(rng)
                step = -step_mag if rng.random() < 0.5 else step_mag
                new_val = max(0, min(XCODE_MAX, current + step))
                if new_val != current:
                    enc = encode_xcode(new_val)
                    chars[base] = enc[0]
                    chars[base + 1] = enc[1]

    new_body = "".join(chars)
    return new_body + compute_checksum(new_body)


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


# ---------------------------------------------------------------------------
# Directional Xcode mutation (uses brain PARAMETER_SCHEMA)
# ---------------------------------------------------------------------------

def _mutate_xcode_inplace(
    chars: list,
    slot_index: int,
    xcode_index: int,
    direction: str,
    range_min: int,
    range_max: int,
    rng: random.Random,
    rate: float,
) -> bool:
    """Mutate one Xcode in-place in chars list. Returns True if changed."""
    from .codec import (
        encode_xcode, xcode_to_param_value, param_value_to_xcode,
        _XCODE_INDEX,
    )
    if rng.random() >= rate:
        return False

    base = slot_index * 64 + 1 + xcode_index * 2
    current_xcode = _XCODE_INDEX[chars[base]] * 62 + _XCODE_INDEX[chars[base + 1]]
    current_param = xcode_to_param_value(current_xcode, range_min, range_max)

    step_mag = _sample_step_magnitude(rng)
    if direction == "lower":
        p_neg = _DIRECTION_BIAS_LOWER
    elif direction == "higher":
        p_neg = _DIRECTION_BIAS_HIGHER
    else:
        p_neg = _DIRECTION_BIAS_NONE
    step = -step_mag if rng.random() < p_neg else step_mag

    new_param = max(range_min, min(range_max, current_param + step))
    if new_param == current_param:
        return False

    new_xcode = param_value_to_xcode(new_param, range_min, range_max)
    new_chars = encode_xcode(new_xcode)
    chars[base] = new_chars[0]
    chars[base + 1] = new_chars[1]
    return True


def mutate_directed(
    genome: str,
    slot_brains: list,  # list[Optional[BrainSpec]], 4 entries
    rng: random.Random,
    rate: float = PER_XCODE_MUTATION_RATE,
) -> str:
    """Step-based directional mutation. Operates per-Xcode per ARCHITECTURE §5.

    For each non-None brain in slot_brains[1] or slot_brains[2] (slots 0
    and 3 are skipped to protect ID-tag and CHECKSUM), for each parameter
    in its PARAMETER_SCHEMA: with probability `rate`, apply a step mutation
    in parameter natural-range space with directional bias from
    field.direction.

    After mutation: recompute global checksum (chars 192-255).
    """
    if len(genome) != GENOME_LENGTH:
        raise ValueError(f"genome must be 256 chars, got {len(genome)}")

    chars = list(genome[:MUTABLE_LENGTH])

    # Only mutate slots 1 and 2 (EXECUTION + BEHAVIOR). Slot 0 holds the
    # ID tag, slot 3 is the checksum — never mutate those even if a brain
    # is supplied for them.
    for slot_idx in (1, 2):
        if slot_idx >= len(slot_brains):
            continue
        brain = slot_brains[slot_idx]
        if brain is None or not brain.parameter_schema:
            continue
        for field in brain.parameter_schema:
            _mutate_xcode_inplace(
                chars, slot_idx, field.xcode_index,
                field.direction, field.range_min, field.range_max,
                rng, rate,
            )

    new_body = "".join(chars)
    new_checksum = compute_checksum(new_body)
    return new_body + new_checksum
