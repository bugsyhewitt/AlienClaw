from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class FitnessInputs:
    correctness: float
    tool_calls: int
    error: Optional[str] = None
    slot_count: int = 1


@dataclass(frozen=True)
class FitnessResult:
    fitness: float
    correctness: float
    efficiency: float
    formula_version: str = "v1.0"
