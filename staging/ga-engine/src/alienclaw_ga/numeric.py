"""Numeric helpers shared by the GA engine.

``clamp01`` is copied verbatim from ``alienclaw.fitness.function``. That module
also holds the retired Martian-composition scorer (``evaluate``, Option C-PRIME
over tool_calls/slot_count), which SALVAGE.md marks DROP; only the clamp is
needed by the engine (``evolution.generation`` and three diagnostics).
"""


def clamp01(value: float) -> float:
    """Clamp a value into the closed unit interval [0.0, 1.0]."""
    return max(0.0, min(1.0, value))
