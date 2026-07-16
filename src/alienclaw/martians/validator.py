"""Validate a parsed MartianSpec against the brain registry."""
from __future__ import annotations
from dataclasses import dataclass
from typing import Any

from .substitution import SUBSTITUTION_TOKEN_RE
from .types import MAX_MARTIAN_SLOTS, MartianSpec, TOOL_ID_TABLE


@dataclass
class MartianValidationResult:
    valid: bool
    errors: tuple[str, ...]

    @classmethod
    def ok(cls) -> "MartianValidationResult":
        return cls(valid=True, errors=())

    @classmethod
    def fail(cls, *errors: str) -> "MartianValidationResult":
        return cls(valid=False, errors=tuple(errors))


def validate_martian(
    spec: MartianSpec,
    brain_registry: Any,  # BrainRegistry
) -> MartianValidationResult:
    """Validate a MartianSpec. Returns a result with errors (never raises)."""
    errors: list[str] = []

    if not spec.slots:
        return MartianValidationResult.fail("MartianSpec must have at least one slot.")

    indices = [s.slot_index for s in spec.slots]
    if len(set(indices)) != len(indices):
        errors.append(f"Duplicate slot_index values: {sorted(indices)}")
    if sorted(indices) != list(range(len(indices))):
        errors.append(
            f"slot_index values must be contiguous starting at 0. Got: {sorted(indices)}"
        )
    for s in spec.slots:
        if s.slot_index >= MAX_MARTIAN_SLOTS:
            errors.append(
                f"slot_index={s.slot_index} exceeds max 1 (only 2 parameter sections available in Packet 16)."
            )

    for s in spec.slots:
        if s.tool_name not in TOOL_ID_TABLE:
            errors.append(f"Tool '{s.tool_name}' not in TOOL_ID_TABLE.")
        if brain_registry.lookup_by_name(s.tool_name) is None:
            errors.append(f"Tool '{s.tool_name}' not in brain registry.")

    for s in spec.slots:
        if s.inputs_from is None:
            continue
        for field, template in s.inputs_from.fields.items():
            for m in SUBSTITUTION_TOKEN_RE.finditer(template):
                slot_num_str = m.group(2)
                if slot_num_str is not None:
                    ref_slot = int(slot_num_str)
                    if ref_slot >= s.slot_index:
                        errors.append(
                            f"Slot {s.slot_index} field '{field}': "
                            f"forward reference to slot[{ref_slot}] (must be < {s.slot_index})."
                        )
            remaining = SUBSTITUTION_TOKEN_RE.sub("", template)
            if "${" in remaining:
                errors.append(
                    f"Slot {s.slot_index} field '{field}': malformed substitution token in {template!r}"
                )

    if errors:
        return MartianValidationResult(valid=False, errors=tuple(errors))
    return MartianValidationResult.ok()
