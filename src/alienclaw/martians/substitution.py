"""Pure variable substitution for Martian input wiring.

Templates support exactly two namespaces:
  ${slot[N].output.field} — output of slot N (top-level field access only)
  ${campaign.field}       — top-level campaign input

Non-string values are auto-serialized to JSON string via json.dumps().
Substitution is mechanical: same template + same context → same output.
"""
from __future__ import annotations
import json
import re
from typing import Any

_PATTERN = re.compile(
    r"\$\{(slot\[(\d+)\]\.output|campaign)\.([a-zA-Z_][a-zA-Z0-9_]*)\}"
)


def _coerce_to_str(value: Any) -> str:
    """Convert value to string; non-strings are JSON-serialized."""
    if isinstance(value, str):
        return value
    return json.dumps(value)


def substitute(
    template: str,
    slot_outputs: list[dict[str, Any]],
    campaign_inputs: dict[str, Any],
) -> str:
    """Replace all ${...} tokens in template.

    Args:
        template: The input string with ${...} tokens.
        slot_outputs: Output dicts from prior slots (slot_outputs[N] = slot N's output).
        campaign_inputs: Top-level campaign-provided inputs.

    Returns:
        The resolved string.

    Raises:
        ValueError: If a slot index is out of range, a field doesn't exist,
                    or a forward reference is detected.
    """
    def replace(match: re.Match) -> str:
        namespace = match.group(1)
        slot_num_str = match.group(2)  # None if campaign
        field_name = match.group(3)

        if slot_num_str is not None:
            slot_n = int(slot_num_str)
            if slot_n >= len(slot_outputs):
                raise ValueError(
                    f"Substitution references slot[{slot_n}].output.{field_name} "
                    f"but only {len(slot_outputs)} prior slot(s) have output."
                )
            out = slot_outputs[slot_n]
            if field_name not in out:
                raise ValueError(
                    f"Slot {slot_n} output has no field '{field_name}'. "
                    f"Available: {sorted(out.keys())}"
                )
            return _coerce_to_str(out[field_name])
        else:
            if field_name not in campaign_inputs:
                raise ValueError(
                    f"Campaign inputs has no field '{field_name}'. "
                    f"Available: {sorted(campaign_inputs.keys())}"
                )
            return _coerce_to_str(campaign_inputs[field_name])

    return _PATTERN.sub(replace, template)


def resolve_inputs(
    wiring: "InputWiring | None",
    slot_outputs: list[dict[str, Any]],
    campaign_inputs: dict[str, Any],
) -> dict[str, Any]:
    """Resolve an InputWiring's field templates into a concrete inputs dict.

    If wiring is None, returns campaign_inputs directly (slot uses campaign).
    Otherwise, returns a dict of resolved field values.
    """
    from .types import InputWiring  # avoid circular
    if wiring is None:
        return dict(campaign_inputs)
    return {
        field: substitute(template, slot_outputs, campaign_inputs)
        for field, template in wiring.fields.items()
    }
