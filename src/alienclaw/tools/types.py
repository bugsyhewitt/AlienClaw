from dataclasses import dataclass, field
from typing import Any


@dataclass
class RunResult:
    ok: bool
    output: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    tool_calls: int = 1
    correctness: float = 1.0
