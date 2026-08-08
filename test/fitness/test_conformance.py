"""Unit tests for output-contract conformance scoring (graded correctness)."""
import pytest

from alienclaw.fitness.conformance import conformance_for, conformance_score

# The compute OUTPUT CONTRACT, mirroring compute.py's output_format 1-5 emission.
FULL_COMPUTE_OUTPUT = {
    "result": 4,
    "input": "2+2",
    "resultType": "int",
    "operation": "eval",
    "precision": "6",
    "steps": ["parse", "evaluate", "round"],
}


def test_full_conformance_scores_one():
    assert conformance_for("compute", FULL_COMPUTE_OUTPUT) == pytest.approx(1.0)


def test_result_only_scores_one_sixth():
    # output_format=1 emits {result} only → 1 of 6 contract fields.
    assert conformance_for("compute", {"result": 4}) == pytest.approx(1 / 6)


@pytest.mark.parametrize(
    "output,expected",
    [
        ({"result": 4}, 1 / 6),                                              # fmt 1
        ({"result": 4, "input": "2+2"}, 2 / 6),                              # fmt 2
        ({"result": 4, "input": "2+2", "resultType": "int"}, 3 / 6),        # fmt 3
        ({"result": 4, "input": "2+2", "resultType": "int",
          "operation": "eval"}, 4 / 6),                                      # fmt 4
        (FULL_COMPUTE_OUTPUT, 6 / 6),                                        # fmt 5
    ],
)
def test_gradient_across_output_formats(output, expected):
    assert conformance_for("compute", output) == pytest.approx(expected)


def test_type_invalid_fields_do_not_count():
    # resultType must be a string; steps must be a list of strings.
    bad = {
        "result": 4,
        "input": "2+2",
        "resultType": 123,             # not a string → invalid
        "operation": "eval",
        "precision": "6",
        "steps": "not-a-list",         # not a list → invalid
    }
    # 4 valid of 6 (result, input, operation, precision).
    assert conformance_for("compute", bad) == pytest.approx(4 / 6)


def test_empty_output_scores_zero():
    assert conformance_for("compute", {}) == pytest.approx(0.0)


def test_unregistered_tool_returns_none():
    # Tools without a contract fall through to their existing binary correctness.
    assert conformance_for("file_read", {"content": "x"}) is None


def test_empty_contract_scores_one():
    assert conformance_score({}, {"anything": 1}) == pytest.approx(1.0)
