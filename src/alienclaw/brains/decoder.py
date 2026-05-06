"""Decode genome bytes into typed runtime parameters per a BrainSpec.

decode_params(brain, genome) is the bridge between genome content and
runner behavior. It reads bytes from the EXECUTION and BEHAVIOR sections
at the offsets declared in the brain's parameter_schema and applies the
declared encoding to produce a typed Python value.

Cross-language: the TypeScript decoder in governance/genome-decoder.ts
must produce identical dicts for the same (brain, genome) inputs.
Both are validated by test/fixtures/decoder-fixtures.json.

Decode errors NEVER raise — they fall back to the field's declared
default. This keeps the summon path safe even if a genome has unusual
byte values.
"""
from __future__ import annotations

from typing import Any

from alienclaw.genome.alphabet import SECTION_IDENTITY, SECTION_EXECUTION, SECTION_BEHAVIOR, SECTION_LENGTH
from .types import BrainSpec, ParameterSchemaField

_SECTION_OFFSETS: dict[str, int] = {
    "IDENTITY":  SECTION_IDENTITY  * SECTION_LENGTH,   # 0
    "EXECUTION": SECTION_EXECUTION * SECTION_LENGTH,   # 64
    "BEHAVIOR":  SECTION_BEHAVIOR  * SECTION_LENGTH,   # 128
}


def decode_params(brain: BrainSpec, genome: str) -> dict[str, Any]:
    """Extract behavioral parameters from a genome per the brain's schema.

    Returns an empty dict if the brain has no parameter_schema. Returns
    the field's default on any decode error. Never raises.
    """
    if len(genome) != 256:
        raise ValueError(f"genome must be 256 chars, got {len(genome)}")
    if not brain.parameter_schema:
        return {}
    params: dict[str, Any] = {}
    for field in brain.parameter_schema:
        try:
            section_start = _SECTION_OFFSETS[field.section]
            abs_pos = section_start + field.byte_offset
            char = genome[abs_pos]
            params[field.name] = _apply_encoding(char, field)
        except Exception:
            params[field.name] = field.default
    return params


def _apply_encoding(char: str, field: ParameterSchemaField) -> Any:
    """Apply the field's canonical encoding to a single genome character.

    Canonical encodings (subtract 48 from ord to align '0'→0):
      mod5_plus1       ((ord-48) % 5) + 1  → int [1..5]
      mod10_plus1      ((ord-48) % 10) + 1 → int [1..10]
      mod10_times500   ((ord-48) % 10) * 500 → int [0..4500]
      char_eq_F        char == 'F'          → bool
      char_code_even   ord(char) % 2 == 0  → bool
    """
    code = ord(char)
    rel = code - 48  # relative to '0'

    enc = field.encoding
    if enc == "mod5_plus1":
        return (rel % 5) + 1
    if enc == "mod10_plus1":
        return (rel % 10) + 1
    if enc == "mod10_times500":
        return (rel % 10) * 500
    if enc == "char_eq_F":
        return char == "F"
    if enc == "char_code_even":
        return code % 2 == 0
    # Unknown encoding → return default
    return field.default
