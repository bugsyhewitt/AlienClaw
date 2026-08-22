"""Parse a .martian YAML file into a MartianSpec."""
from __future__ import annotations

import re
from typing import Any

import yaml

from .types import InputWiring, MartianSpec, SlotDeclaration


class MartianParseError(ValueError):
    """Raised when a .martian file cannot be parsed."""


_STRICT_SLOT_INDEX_RE = re.compile(r"-?\d+$")


def _parse_strict_slot_index(raw: Any, source_path: str, slot_num: int) -> int:
    """Mirror TS _parseStrictSlotIndex (parser.ts:242-258). Accept native int,
    reject bool, else accept digit-string via re.fullmatch(r"-?\\d+", s)."""
    if isinstance(raw, bool):
        raise MartianParseError(
            f"{source_path}: slot {slot_num} slot_index must be a finite integer, "
            f"got {type(raw).__name__} ({raw!r})"
        )
    if isinstance(raw, int):
        return raw
    s = str(raw).strip()
    if not _STRICT_SLOT_INDEX_RE.fullmatch(s):
        raise MartianParseError(
            f"{source_path}: slot {slot_num} slot_index must be a finite integer, "
            f"got {type(raw).__name__} ({raw!r})"
        )
    return int(s)


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

    mt_raw = raw["martian_type"]
    if not isinstance(mt_raw, str):
        raise MartianParseError(
            f"{source_path}: martian_type must be a string, got "
            f"{type(mt_raw).__name__} ({mt_raw!r})"
        )
    martian_type = mt_raw
    description = str(raw.get("description", ""))
    uc_raw = raw.get("use_cases")
    if uc_raw is None:
        uc_raw = []
    if not isinstance(uc_raw, list):
        raise MartianParseError(
            f"{source_path}: use_cases must be a list of strings, got {type(uc_raw).__name__}"
        )
    use_cases_list: list[str] = []
    for i, u in enumerate(uc_raw):
        if not isinstance(u, str):
            raise MartianParseError(
                f"{source_path}: use_cases[{i}] must be a string, got "
                f"{type(u).__name__} ({u!r})"
            )
        use_cases_list.append(u)
    use_cases = tuple(use_cases_list)

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
        slot_index = _parse_strict_slot_index(slot_raw["slot_index"], source_path, i)
        raw_tool_name = slot_raw["tool_name"]
        if isinstance(raw_tool_name, bool) or not isinstance(raw_tool_name, str):
            raise MartianParseError(
                f"{source_path}: slot {i} tool_name must be a string; got {raw_tool_name!r}"
            )
        tool_name = raw_tool_name
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
