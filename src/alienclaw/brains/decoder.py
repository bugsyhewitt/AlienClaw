"""Decode genome bytes into typed runtime parameters per a BrainSpec.

decode_params(brain, genome) is the bridge between genome content and
runner behavior. As of Packet 15, parameters are encoded as Xcodes (2-char
Base62 pairs) within slot 1 (EXECUTION section). The Xcode value is mapped
linearly to the declared natural range [range_min, range_max].

Decode errors NEVER raise — they fall back to the field's declared
default. This keeps the summon path safe even if a genome has unusual
byte values.
"""
from __future__ import annotations

from typing import Any

from alienclaw.genome.codec import decode_xcode, xcode_to_param_value

from .types import BrainSpec


def decode_params(brain: BrainSpec, genome: str, slot_index: int = 1) -> dict[str, Any]:
    """Extract behavioral parameters from a genome per the brain's schema.

    slot_index: which genome section to read Xcodes from.
                Default=1 (EXECUTION section) for backward compat.
                Martian bridge uses slot_index = martian_slot_index + 1.

    Each parameter is read at the field's xcode_index. Xcode value mapped to
    natural range via xcode_to_param_value. Returns {} if no parameter_schema.
    Falls back to field.default on any error.
    """
    if len(genome) != 256:
        raise ValueError(f"genome must be 256 chars, got {len(genome)}")
    if not brain.parameter_schema:
        return {}
    params: dict[str, Any] = {}
    for field in brain.parameter_schema:
        try:
            xcode_val = decode_xcode(genome, slot_index, field.xcode_index)
            params[field.name] = xcode_to_param_value(xcode_val, field.range_min, field.range_max)
        except Exception:
            params[field.name] = field.default
    return params
