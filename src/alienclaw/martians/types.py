"""Martian composition types for Packet 16."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional

# ARCHITECTURE §Packet 16 — Tool ID table. Assigned alphabetically.
# Hardcoded; IDs never change once assigned; new tools get next unused ID.
TOOL_ID_TABLE: dict[str, int] = {
    "compute":      1,
    "extract_json": 2,
    "file_read":    3,
    "file_write":   4,
    "http_get":     5,
    "search_text":  6,
    "url_fetch":    7,
    "web_search":   8,
}
EMPTY_SLOT_ID: int = 0


@dataclass(frozen=True)
class InputWiring:
    """Maps input field names to substitution templates.

    fields: {"field_name": "${slot[0].output.body}", ...}
    """
    fields: dict[str, str]


@dataclass(frozen=True)
class SlotDeclaration:
    """One tool slot in a Martian composition."""
    slot_index: int           # 0 or 1 (max 2 slots in Packet 16)
    tool_name: str            # must be in TOOL_ID_TABLE
    inputs_from: Optional[InputWiring]  # None = use campaign inputs directly


@dataclass(frozen=True)
class MartianSpec:
    """A Martian type — name + ordered tool composition."""
    martian_type: str
    slots: tuple[SlotDeclaration, ...]  # 1-2 entries; immutable
    description: str
    use_cases: tuple[str, ...]
