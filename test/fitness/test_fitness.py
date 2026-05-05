import pytest
from alienclaw.fitness import evaluate, FitnessInputs


class TestEvaluate:
    def test_error_returns_zero_fitness(self):
        result = evaluate(FitnessInputs(correctness=0.9, tool_calls=1, error="failed"))
        assert result.fitness == 0.0
        assert result.efficiency == 0.0

    def test_one_tool_call_full_correctness(self):
        result = evaluate(FitnessInputs(correctness=1.0, tool_calls=1))
        assert result.fitness == pytest.approx(1.0)
        assert result.correctness == pytest.approx(1.0)
        assert result.efficiency == pytest.approx(1.0)

    def test_efficiency_decreases_with_more_tool_calls(self):
        r1 = evaluate(FitnessInputs(correctness=1.0, tool_calls=1))
        r2 = evaluate(FitnessInputs(correctness=1.0, tool_calls=2))
        r4 = evaluate(FitnessInputs(correctness=1.0, tool_calls=4))
        assert r1.fitness > r2.fitness > r4.fitness

    def test_fitness_formula_correctness_times_efficiency(self):
        result = evaluate(FitnessInputs(correctness=0.8, tool_calls=2))
        assert result.fitness == pytest.approx(0.8 * 0.5)
        assert result.efficiency == pytest.approx(0.5)

    def test_zero_tool_calls_treated_as_one(self):
        r0 = evaluate(FitnessInputs(correctness=1.0, tool_calls=0))
        r1 = evaluate(FitnessInputs(correctness=1.0, tool_calls=1))
        assert r0.fitness == pytest.approx(r1.fitness)

    def test_correctness_clamped_above_one(self):
        result = evaluate(FitnessInputs(correctness=1.5, tool_calls=1))
        assert result.correctness == pytest.approx(1.0)
        assert result.fitness == pytest.approx(1.0)

    def test_correctness_clamped_below_zero(self):
        result = evaluate(FitnessInputs(correctness=-0.5, tool_calls=1))
        assert result.correctness == pytest.approx(0.0)
        assert result.fitness == pytest.approx(0.0)

    def test_formula_version_is_v1(self):
        result = evaluate(FitnessInputs(correctness=1.0, tool_calls=1))
        assert result.formula_version == "v1.0"

    def test_partial_correctness_with_many_calls(self):
        result = evaluate(FitnessInputs(correctness=0.75, tool_calls=1))
        assert result.fitness == pytest.approx(0.75)

    def test_error_with_zero_correctness(self):
        result = evaluate(FitnessInputs(correctness=0.0, tool_calls=0, error="crash"))
        assert result.fitness == 0.0
        assert result.efficiency == 0.0
