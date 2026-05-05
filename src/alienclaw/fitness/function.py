from .types import FitnessInputs, FitnessResult


def evaluate(inputs: FitnessInputs) -> FitnessResult:
    if inputs.error is not None:
        return FitnessResult(fitness=0.0, correctness=inputs.correctness, efficiency=0.0)
    correctness = max(0.0, min(1.0, inputs.correctness))
    efficiency = 1.0 / max(1, inputs.tool_calls)
    fitness = max(0.0, min(1.0, correctness * efficiency))
    return FitnessResult(fitness=fitness, correctness=correctness, efficiency=efficiency)
