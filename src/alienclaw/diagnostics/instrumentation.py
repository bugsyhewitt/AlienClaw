"""Opt-in instrumentation for the bridge → runner → fitness chain.

ENABLED ONLY when ALIENCLAW_DIAGNOSTICS=1 (any other value = off).
Production paths are byte-identical when the flag is absent.

Usage:
    import os; os.environ["ALIENCLAW_DIAGNOSTICS"] = "1"
    with CaptureHook() as hook:
        resp = handle(raw_request_bytes)
    trace = hook.trace()
    print(trace.genome, trace.correctness, trace.fitness)

The hook installs a thread-local capture point that bridge/server.py
checks before recording. When diagnostics are off, the check is a
single `if _current is not None` guard — zero allocation, zero cost.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Generator


def is_enabled() -> bool:
    return os.environ.get("ALIENCLAW_DIAGNOSTICS") == "1"


@dataclass
class CaptureTrace:
    genome: str = ""
    martian_type: str = ""
    inputs: dict[str, Any] = field(default_factory=dict)
    runner_output: dict[str, Any] = field(default_factory=dict)
    runner_error: str | None = None
    correctness: float = 0.0
    tool_calls: int = 0
    fitness: float = 0.0
    genome_passed_to_runner: bool = False


_current: CaptureTrace | None = None


class _Capturer:
    def __init__(self, trace: CaptureTrace):
        self._trace = trace

    def trace(self) -> CaptureTrace:
        return self._trace


@contextmanager
def CaptureHook() -> Generator[_Capturer, None, None]:
    """Context manager that activates capture for bridge calls within the block."""
    global _current
    trace = CaptureTrace()
    if is_enabled():
        _current = trace
    try:
        yield _Capturer(trace)
    finally:
        _current = None


def record_genome(genome: str, martian_type: str, inputs: dict[str, Any]) -> None:
    """Called by bridge/server.py after genome validation. No-op when off."""
    if _current is not None:
        _current.genome = genome
        _current.martian_type = martian_type
        _current.inputs = dict(inputs)


def record_runner_call(genome_passed: bool) -> None:
    """Records whether the genome was passed to the runner. Always False in v1.0."""
    if _current is not None:
        _current.genome_passed_to_runner = genome_passed


def record_runner_result(output: dict[str, Any], error: str | None,
                         correctness: float, tool_calls: int) -> None:
    if _current is not None:
        _current.runner_output = dict(output)
        _current.runner_error = error
        _current.correctness = correctness
        _current.tool_calls = tool_calls


def record_fitness(fitness: float) -> None:
    if _current is not None:
        _current.fitness = fitness
