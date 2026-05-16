from .types import FitnessInputs, FitnessResult


_ALPHA = 0.1  # Bayesian-optimized in Packet 27; hardcoded per Packet 28 decision


def evaluate(inputs: FitnessInputs) -> FitnessResult:
    """Compute fitness using Option C-prime formula (adopted in Packet 28).

    Formula: fitness = correctness × 1 / (1 + α × max(0, tool_calls - slot_count))

    The first slot_count tool calls are "free" — one per slot is the architectural
    minimum. Each excess call applies a gentle multiplicative penalty (α = 0.1).
    A perfectly-orchestrating composition of any k slots achieves fitness = correctness,
    eliminating the 1/k ceiling of the prior formula.

    α = 0.1 (hardcoded; Bayesian optimization in Packet 27 converged to this value).
    """
    if inputs.error is not None:
        return FitnessResult(fitness=0.0, correctness=inputs.correctness, efficiency=0.0,
                             formula_version="v2.0")

    correctness = max(0.0, min(1.0, inputs.correctness))
    excess = max(0, inputs.tool_calls - inputs.slot_count)
    efficiency = 1.0 / (1.0 + _ALPHA * excess)
    fitness = max(0.0, min(1.0, correctness * efficiency))
    return FitnessResult(fitness=fitness, correctness=correctness, efficiency=efficiency,
                         formula_version="v2.0")
