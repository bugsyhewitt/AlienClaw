"""DROP-free parameter schema for directed (step-based) Xcode mutation.

Staged replacement for the two types the in-tree engine borrowed from
``alienclaw.brains.types`` (a DROP module): ``ParameterSchemaField`` (copied
field-for-field below) and ``BrainSpec`` (replaced by the ``DirectedMutationSpec``
protocol and the minimal concrete ``MutationSchema``).

``genome.operators.mutate_directed`` and ``EvolutionConfig.brain`` only ever read
``spec.parameter_schema`` and, per field, ``xcode_index``, ``direction``,
``range_min`` and ``range_max``. Both are duck-typed, so any object with that
shape works — including the in-tree ``BrainSpec``. No runtime behavior changes.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Sequence


@dataclass(frozen=True)
class ParameterSchemaField:
    """One machine-readable parameter declaration for directed mutation.

    Field-for-field copy of ``alienclaw.brains.types.ParameterSchemaField``:
        name:        Parameter name (e.g. 'max_attempts').
        description: Human-readable description.
        xcode_index: Index of the Xcode pair (0..30) within the slot.
        range_min:   Natural value range minimum (inclusive).
        range_max:   Natural value range maximum (inclusive).
        default:     Value used when decoding fails or slot is absent.
        direction:   Mutation bias: 'lower' | 'higher' | 'none'.
    """
    name: str
    description: str
    xcode_index: int
    range_min: int
    range_max: int
    default: int
    direction: str  # "lower" | "higher" | "none"


class ParameterFieldLike(Protocol):
    """The four attributes ``mutate_directed`` reads from each schema field."""

    @property
    def xcode_index(self) -> int: ...

    @property
    def range_min(self) -> int: ...

    @property
    def range_max(self) -> int: ...

    @property
    def direction(self) -> str: ...


class DirectedMutationSpec(Protocol):
    """Anything carrying a ``parameter_schema`` (the old ``BrainSpec`` role)."""

    @property
    def parameter_schema(self) -> Sequence[ParameterFieldLike]: ...


@dataclass(frozen=True)
class MutationSchema:
    """Minimal concrete ``DirectedMutationSpec`` for tuners and tests."""
    parameter_schema: tuple[ParameterSchemaField, ...] = ()
    name: str = ""
