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


def test_tool_with_no_contract_returns_none():
    # A tool with no OUTPUT CONTRACT in seed/msb/ falls through to binary correctness.
    assert conformance_for("no_such_tool", {"content": "x"}) is None


def test_empty_contract_scores_one():
    assert conformance_score({}, {"anything": 1}) == pytest.approx(1.0)


# ── Generic contract loading (all 8 brains, not just compute) ─────────────────


def test_all_seed_brains_have_loadable_contracts():
    # Every brain in seed/msb/ must yield a usable contract; a parse regression
    # would silently drop that tool back to binary correctness.
    for tool in [
        "compute", "extract_json", "file_read", "file_write",
        "http_get", "search_text", "url_fetch", "web_search",
    ]:
        assert conformance_for(tool, {}) is not None, f"{tool} contract failed to load"


@pytest.mark.parametrize(
    "output,expected",
    [
        ({"url": "u"}, 1 / 4),                                                   # field_count=1
        ({"url": "u", "statusCode": 200}, 2 / 4),                                # field_count=2
        ({"url": "u", "statusCode": 200, "content": "c"}, 3 / 4),                # field_count=3
        ({"url": "u", "statusCode": 200, "content": "c",
          "contentType": "text/html"}, 4 / 4),                                   # field_count=5
    ],
)
def test_url_fetch_gradient_from_json_schema_contract(output, expected):
    # url_fetch's contract is JSON Schema shaped (not a flat type map); its
    # genome-controlled field_count must still produce a conformance gradient.
    assert conformance_for("url_fetch", output) == pytest.approx(expected)


def test_integer_and_boolean_types_are_enforced():
    # http_get declares statusCode/bytesReturned as integer and truncated as boolean.
    ok = conformance_for("http_get", {"statusCode": 200, "truncated": False})
    bad = conformance_for("http_get", {"statusCode": "200", "truncated": "no"})
    assert ok > bad


def test_bool_does_not_satisfy_integer():
    # bool subclasses int in Python; a flag must not count as an integer field.
    from alienclaw.fitness.conformance import _field_valid
    assert _field_valid(True, "boolean") is True
    assert _field_valid(True, "integer") is False
    assert _field_valid(1, "integer") is True
