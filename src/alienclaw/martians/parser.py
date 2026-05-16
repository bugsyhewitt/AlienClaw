"""Parse a .martian YAML file into a MartianSpec."""
from __future__ import annotations
from pathlib import Path
from typing import Any
import yaml

from .types import InputWiring, MartianSpec, SlotDeclaration


class MartianParseError(ValueError):
    """Raised when a .martian file cannot be parsed."""


def parse_martian(content: str, source_path: str = "<string>") -> MartianSpec:
    """Parse YAML .martian file content into a MartianSpec."""
    try:
        raw = yaml.safe_load(content)
    except yaml.YAMLError as exc:
        raise MartianParseError(f"YAML error in {source_path}: {exc}")

    if not isinstance(raw, dict):
        raise MartianParseError(f"{source_path}: top-level must be a YAML mapping")

    for req in ("martian_type", "slots"):
        if req not in raw:
            raise MartianParseError(f"{source_path}: missing required field '{req}'")

    martian_type = str(raw["martian_type"])
    description = str(raw.get("description", ""))
    use_cases = tuple(str(u) for u in (raw.get("use_cases") or []))

    raw_slots = raw["slots"]
    if not isinstance(raw_slots, list) or len(raw_slots) == 0:
        raise MartianParseError(f"{source_path}: 'slots' must be a non-empty list")

    slots: list[SlotDeclaration] = []
    for i, slot_raw in enumerate(raw_slots):
        if not isinstance(slot_raw, dict):
            raise MartianParseError(f"{source_path}: slot {i} must be a mapping")
        for req in ("slot_index", "tool_name"):
            if req not in slot_raw:
                raise MartianParseError(f"{source_path}: slot {i} missing '{req}'")
        slot_index = int(slot_raw["slot_index"])
        tool_name = str(slot_raw["tool_name"])
        raw_inputs = slot_raw.get("inputs_from")
        if raw_inputs is None:
            inputs_from = None
        elif isinstance(raw_inputs, dict) and "fields" in raw_inputs:
            fields = {str(k): str(v) for k, v in (raw_inputs["fields"] or {}).items()}
            inputs_from = InputWiring(fields=fields)
        else:
            raise MartianParseError(
                f"{source_path}: slot {i} inputs_from must be null or have 'fields' mapping"
            )
        slots.append(SlotDeclaration(slot_index=slot_index, tool_name=tool_name, inputs_from=inputs_from))

    return MartianSpec(
        martian_type=martian_type,
        slots=tuple(slots),
        description=description,
        use_cases=use_cases,
    )
