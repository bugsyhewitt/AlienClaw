"""Output-contract conformance scoring for graded correctness.

The fitness `correctness` input was binary (1.0 = ran, 0.0 = errored), which gave
selection no gradient on output quality — evolution optimized tool-call efficiency
alone (the 2026-07-16 SIGNAL_PARTIAL finding). This grades a *successful* tool
output by how completely it matches its MSB OUTPUT CONTRACT: the fraction of
contract fields present and type-valid, in [0, 1].

"Quality" here means output completeness / well-formedness, NOT answer-accuracy —
these deterministic tools compute their own ground truth, and there is no labeled
task set to compare against.

Contracts are read from each brain's OUTPUT CONTRACT block in `seed/msb/*.msb`, so
the `.msb` files are the single source of truth (no hand-maintained duplicate that
can drift). Tools whose contract cannot be loaded fall through to their existing
binary correctness (`conformance_for` returns None).

The gradient only exists where the genome actually varies output completeness —
e.g. compute's `output_format` (1-5), and `field_count` (1-5) in url_fetch /
http_get, which emit progressively more contract fields. Tools whose output shape
is genome-independent score a constant conformance, which is correct and expected.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional

# OUTPUT CONTRACT block: everything up to the next ALL-CAPS section header or EOF.
_CONTRACT_RE = re.compile(
    r"^OUTPUT CONTRACT:\s*\n(.*?)(?=\n[A-Z][A-Z ]+:|\Z)", re.S | re.M
)

# Fallback contract for compute, used only if seed/msb/ cannot be read (e.g. an
# installed package without the seed tree). Mirrors seed/msb/compute.msb.
_COMPUTE_FALLBACK: dict[str, Any] = {
    "input": "any",
    "operation": "string",
    "result": "any",
    "resultType": "string",
    "precision": "string",
    "steps": ["string"],
}

# Lazily-populated cache: tool name -> contract field map (or None once loaded empty).
_CONTRACTS: Optional[dict[str, dict[str, Any]]] = None


def _seed_msb_dir() -> Path:
    """Locate seed/msb/ relative to this package, independent of CWD."""
    # src/alienclaw/fitness/conformance.py -> parents[3] is the repo root.
    return Path(__file__).resolve().parents[3] / "seed" / "msb"


def _parse_contract(text: str) -> Optional[dict[str, Any]]:
    """Parse an OUTPUT CONTRACT block into a `field name -> type decl` map.

    Handles both shapes present in seed/msb/:
      * JSON Schema — {"type": "object", "properties": {...}, "required": [...]}
        (url_fetch) — the `properties` map is flattened to its declared types.
      * Flat type map — {"field": "string", "other": ["string"]} (the other 7).
    """
    try:
        parsed = json.loads(text)
    except (ValueError, TypeError):
        return None
    if not isinstance(parsed, dict):
        return None

    # JSON Schema form: lift `properties`, reducing each to its declared type.
    if parsed.get("type") == "object" and isinstance(parsed.get("properties"), dict):
        fields: dict[str, Any] = {}
        for name, decl in parsed["properties"].items():
            if isinstance(decl, dict) and "type" in decl:
                fields[name] = decl["type"]
            else:
                fields[name] = "any"
        return fields

    return parsed


def _load_contracts() -> dict[str, dict[str, Any]]:
    """Read and cache every brain's OUTPUT CONTRACT from seed/msb/."""
    global _CONTRACTS
    if _CONTRACTS is not None:
        return _CONTRACTS

    contracts: dict[str, dict[str, Any]] = {}
    msb_dir = _seed_msb_dir()
    try:
        paths = sorted(msb_dir.glob("*.msb"))
    except OSError:
        paths = []

    for path in paths:
        try:
            match = _CONTRACT_RE.search(path.read_text(encoding="utf-8"))
        except OSError:
            continue
        if not match:
            continue
        fields = _parse_contract(match.group(1).strip())
        if fields:
            contracts[path.stem] = fields

    if not contracts:
        # Seed tree unavailable — keep compute graded rather than regressing it.
        contracts = {"compute": _COMPUTE_FALLBACK}

    _CONTRACTS = contracts
    return _CONTRACTS


def _field_valid(value: Any, decl: Any) -> bool:
    """Whether `value` satisfies a contract field's declared type.

    `decl` is either a type name ("string", "integer", "number", "boolean",
    "any"), a one-element list denoting an array of that type (["string"]), or a
    nested object map. The legacy string form "[string]" is also accepted.
    """
    # Array declarations: ["string"], [{...}] — validate element type when simple.
    if isinstance(decl, list):
        if not isinstance(value, list):
            return False
        if not decl:
            return True
        return all(_field_valid(item, decl[0]) for item in value)

    # Nested object declarations — recurse, so an incomplete inner object does not
    # count as conforming. Without this a tool whose genome drops a *nested* field
    # (e.g. extract_json omitting `found` under extracted.<path>) would score an
    # identical 1.0 to a complete output, re-flattening the correctness channel for
    # every contract whose detail lives below the top level.
    if isinstance(decl, dict):
        if not isinstance(value, dict):
            return False
        # Wildcard template — a single "<name>" key declares the shape that every
        # entry of an open-keyed map must satisfy (extract_json's "<path>").
        placeholders = [
            k for k in decl
            if isinstance(k, str) and k.startswith("<") and k.endswith(">")
        ]
        if len(decl) == 1 and placeholders:
            template = decl[placeholders[0]]
            return all(_field_valid(v, template) for v in value.values())
        # Concrete nested object — every declared sub-field must be present + valid.
        return all(
            name in value and _field_valid(value[name], sub)
            for name, sub in decl.items()
        )

    if decl == "any":
        return True
    if decl == "string":
        return isinstance(value, str)
    if decl == "[string]":  # legacy flattened array form
        return isinstance(value, list) and all(isinstance(x, str) for x in value)
    if decl == "boolean":
        return isinstance(value, bool)
    if decl == "integer":
        # bool is a subclass of int in Python; a flag is not an integer field.
        return isinstance(value, int) and not isinstance(value, bool)
    if decl == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if decl in ("object", "array"):
        return isinstance(value, dict if decl == "object" else list)
    return False


def conformance_score(contract: dict[str, Any], output: dict[str, Any]) -> float:
    """Fraction of `contract` fields present and type-valid in `output`, in [0, 1].

    An empty contract scores 1.0 (nothing to satisfy).
    """
    if not contract:
        return 1.0
    hits = sum(
        1
        for name, decl in contract.items()
        if name in output and _field_valid(output[name], decl)
    )
    return hits / len(contract)


def conformance_for(tool_name: str, output: dict[str, Any]) -> Optional[float]:
    """Graded correctness for a successful tool output.

    Returns the conformance score for a tool whose OUTPUT CONTRACT could be read
    from seed/msb/, or None if it could not (caller keeps its binary correctness).
    """
    contract = _load_contracts().get(tool_name)
    if contract is None:
        return None
    return conformance_score(contract, output)
