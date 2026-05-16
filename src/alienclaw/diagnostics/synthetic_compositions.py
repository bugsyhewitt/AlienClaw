"""Build synthetic Martian compositions for scaling research.

Creates in-memory MartianSpec objects for k-slot compositions not in the
canonical registry. Used only for Packet 27 research; NOT committed to seed/martians/.

For k=4 and k=8 compute-chains: each slot is compute, chained sequentially:
  Slot 0: inputs from campaign
  Slot N (N>0): inputs = {"input": "${slot[N-1].output.result}"}

Registry injection: synthetic specs are registered in the bridge's live registry
at experiment time and deregistered after to leave no residue.

NOTE: decode_xcode only supports slot_index ∈ [0,3]. For synthetic slots with
index ≥ 3, the decoder falls back to default parameter values (decode_params catches
the ValueError and returns defaults). This is expected behavior for synthetic research.
"""
from __future__ import annotations

from alienclaw.martians.types import MartianSpec, SlotDeclaration, InputWiring


def build_compute_chain(k: int, name: str | None = None) -> MartianSpec:
    """Build a k-slot compute-chain MartianSpec.

    Each slot is the `compute` tool. Slot 0 receives campaign inputs;
    slot N (N>0) receives `{"input": str(slot[N-1].output.result)}`.

    Args:
        k: number of slots (1-8 supported)
        name: Martian type name; defaults to f"synthetic_compute_k{k}"

    Returns:
        MartianSpec (not registered in registry; in-memory only)
    """
    if k < 1:
        raise ValueError(f"k must be ≥ 1, got {k}")
    if name is None:
        name = f"synthetic_compute_k{k}"

    slots = []
    for idx in range(k):
        if idx == 0:
            wiring = None  # campaign inputs
        else:
            # Chain from previous slot's result
            wiring = InputWiring(fields={"input": f"${{slot[{idx - 1}].output.result}}"})
        slots.append(SlotDeclaration(
            slot_index=idx,
            tool_name="compute",
            inputs_from=wiring,
        ))

    return MartianSpec(
        martian_type=name,
        slots=tuple(slots),
        description=f"Synthetic {k}-slot compute chain for scaling research.",
        use_cases=(f"Packet 27 scaling research at k={k}",),
    )


def register_synthetic_composition(spec: MartianSpec) -> None:
    """Register a synthetic MartianSpec in the bridge's live registry.

    Must be called before running experiments. The bridge's _martian_registry
    is a module-level singleton; we add the spec directly to its _by_type dict.

    Call deregister_synthetic_composition() after experiments to avoid leaking
    state between tests.
    """
    from alienclaw.bridge.server import _get_martian_registry
    registry = _get_martian_registry()
    registry._by_type[spec.martian_type] = spec


def deregister_synthetic_composition(martian_type: str) -> None:
    """Remove a synthetic MartianSpec from the bridge's live registry.

    No-op if the type is not registered.
    """
    from alienclaw.bridge.server import _get_martian_registry
    registry = _get_martian_registry()
    registry._by_type.pop(martian_type, None)
