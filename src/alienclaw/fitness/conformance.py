"""Output-contract conformance scoring for graded correctness.

The fitness `correctness` input was binary (1.0 = ran, 0.0 = errored), which gave
selection no gradient on output quality — evolution optimized tool-call efficiency
alone (the 2026-07-16 SIGNAL_PARTIAL finding). This grades a *successful* tool
output by how completely it matches its MSB OUTPUT CONTRACT: the fraction of
contract fields present and type-valid, in [0, 1].

"Quality" here means output completeness / well-formedness, NOT answer-accuracy —
these deterministic tools compute their own ground truth, and there is no labeled
task set to compare against.

Scoped to the `compute` Martian: its genome-controlled `output_format` (1-5) emits
1/6 to 6/6 contract fields, so conformance varies with the genome (verified). Other
tools have no registered contract yet and fall through to their existing binary
correctness (see `conformance_for`). Extension path: parse each `.msb`'s OUTPUT
CONTRACT block generically.
"""
from __future__ import annotations

from typing import Any, Optional

# MSB OUTPUT CONTRACT for compute (seed/msb/compute.msb, OUTPUT CONTRACT block):
#   { input: any, operation: string, result: any, resultType: string,
#     precision: string, steps: [string] }
_COMPUTE_CONTRACT: dict[str, str] = {
    "input": "any",
    "operation": "string",
    "result": "any",
    "resultType": "string",
    "precision": "string",
    "steps": "[string]",
}

# Registered contracts by tool name. compute-only for now (proving ground).
_CONTRACTS: dict[str, dict[str, str]] = {
    "compute": _COMPUTE_CONTRACT,
}


def _field_valid(value: Any, decl: str) -> bool:
    """Whether `value` satisfies a contract field's declared type."""
    if decl == "any":
        return True
    if decl == "string":
        return isinstance(value, str)
    if decl == "[string]":
        return isinstance(value, list) and all(isinstance(x, str) for x in value)
    return False


def conformance_score(contract: dict[str, str], output: dict[str, Any]) -> float:
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

    Returns the conformance score for a tool with a registered contract, or None
    if the tool has no contract yet (caller keeps its existing binary correctness).
    """
    contract = _CONTRACTS.get(tool_name)
    if contract is None:
        return None
    return conformance_score(contract, output)
