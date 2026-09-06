"""Branch coverage for _field_valid and _parse_contract in conformance.py.

Existing test_conformance.py covers scalar types (string, integer, boolean) and
the basic list-of-strings case well.  This file targets the branches that were
left uncovered:

  * Nested dict declarations (concrete sub-fields)  — search_text matches shape
  * Wildcard template (<key>)                        — extract_json <path> shape
  * Non-dict value against a dict declaration
  * number, object, array type strings
  * Empty list declaration (any value validates)
  * List-of-dicts  (matches: [{...}] shape)
  * Unknown/unrecognized type string  (returns False)
  * Legacy "[string]" flat-array form
  * _parse_contract error paths (invalid JSON, non-dict JSON)
"""
import pytest
from alienclaw.fitness.conformance import (
    _field_valid,
    _parse_contract,
    conformance_score,
)


# ── Nested concrete dict ─────────────────────────────────────────────────────

MATCH_DECL = {
    "matchText": "string",
    "lineNumber": "integer",
    "startOffset": "integer",
    "endOffset": "integer",
}

VALID_MATCH = {"matchText": "fox", "lineNumber": 3, "startOffset": 4, "endOffset": 7}


class TestNestedConcreteDict:
    def test_all_sub_fields_valid(self):
        assert _field_valid(VALID_MATCH, MATCH_DECL) is True

    def test_missing_sub_field_fails(self):
        partial = {k: v for k, v in VALID_MATCH.items() if k != "endOffset"}
        assert _field_valid(partial, MATCH_DECL) is False

    def test_wrong_sub_field_type_fails(self):
        bad = {**VALID_MATCH, "lineNumber": "three"}  # integer field has string value
        assert _field_valid(bad, MATCH_DECL) is False

    def test_non_dict_value_against_dict_decl_fails(self):
        assert _field_valid("not-a-dict", MATCH_DECL) is False
        assert _field_valid(42, MATCH_DECL) is False
        assert _field_valid(None, MATCH_DECL) is False

    def test_empty_value_dict_against_non_empty_decl_fails(self):
        assert _field_valid({}, MATCH_DECL) is False


# ── Wildcard template (<path> pattern) ───────────────────────────────────────

PATH_TEMPLATE = {"<path>": {"value": "any", "type": "string", "found": "boolean"}}

VALID_EXTRACTED = {
    "name": {"value": "Alice", "type": "string", "found": True},
    "score": {"value": 99, "type": "number", "found": True},
}


class TestWildcardTemplate:
    def test_all_entries_conforming(self):
        assert _field_valid(VALID_EXTRACTED, PATH_TEMPLATE) is True

    def test_empty_dict_against_wildcard_passes(self):
        # No entries → vacuously True
        assert _field_valid({}, PATH_TEMPLATE) is True

    def test_one_bad_entry_fails(self):
        bad = {
            "name": {"value": "Alice", "type": "string", "found": True},
            "score": {"value": 99, "type": 42, "found": True},  # type should be string
        }
        assert _field_valid(bad, PATH_TEMPLATE) is False

    def test_non_dict_value_against_wildcard_fails(self):
        assert _field_valid(["name"], PATH_TEMPLATE) is False

    def test_single_entry_wildcard(self):
        single = {"age": {"value": 30, "type": "integer", "found": True}}
        assert _field_valid(single, PATH_TEMPLATE) is True


# ── List-of-dicts (search_text matches shape) ────────────────────────────────

MATCHES_DECL = [MATCH_DECL]  # [{matchText: string, lineNumber: integer, ...}]


class TestListOfDicts:
    def test_list_of_valid_matches(self):
        matches = [VALID_MATCH, {**VALID_MATCH, "lineNumber": 7, "startOffset": 8, "endOffset": 12}]
        assert _field_valid(matches, MATCHES_DECL) is True

    def test_empty_list_of_dicts_passes(self):
        assert _field_valid([], MATCHES_DECL) is True

    def test_one_invalid_dict_in_list_fails(self):
        bad_item = {**VALID_MATCH, "matchText": 999}  # wrong type
        assert _field_valid([VALID_MATCH, bad_item], MATCHES_DECL) is False

    def test_non_list_against_list_of_dicts_fails(self):
        assert _field_valid(VALID_MATCH, MATCHES_DECL) is False


# ── Empty list declaration ────────────────────────────────────────────────────

class TestEmptyListDecl:
    def test_empty_decl_accepts_any_list(self):
        assert _field_valid(["a", "b"], []) is True
        assert _field_valid([1, None], []) is True

    def test_empty_decl_rejects_non_list(self):
        assert _field_valid("string", []) is False
        assert _field_valid(42, []) is False


# ── number type string ────────────────────────────────────────────────────────

class TestNumberType:
    def test_int_satisfies_number(self):
        assert _field_valid(42, "number") is True

    def test_float_satisfies_number(self):
        assert _field_valid(3.14, "number") is True

    def test_bool_does_not_satisfy_number(self):
        # bool subclasses int — a flag is not a number field
        assert _field_valid(True, "number") is False
        assert _field_valid(False, "number") is False

    def test_string_does_not_satisfy_number(self):
        assert _field_valid("42", "number") is False


# ── object and array type strings ─────────────────────────────────────────────

class TestObjectAndArrayTypes:
    def test_dict_satisfies_object(self):
        assert _field_valid({"key": "val"}, "object") is True

    def test_non_dict_does_not_satisfy_object(self):
        assert _field_valid([1, 2], "object") is False
        assert _field_valid("str", "object") is False

    def test_list_satisfies_array(self):
        assert _field_valid([1, 2, 3], "array") is True
        assert _field_valid([], "array") is True

    def test_non_list_does_not_satisfy_array(self):
        assert _field_valid({"k": "v"}, "array") is False
        assert _field_valid("list", "array") is False


# ── Legacy "[string]" flat-array form ─────────────────────────────────────────

class TestLegacyStringArrayForm:
    def test_list_of_strings_valid(self):
        assert _field_valid(["a", "b", "c"], "[string]") is True

    def test_empty_list_valid(self):
        assert _field_valid([], "[string]") is True

    def test_list_with_non_string_invalid(self):
        assert _field_valid(["a", 2], "[string]") is False

    def test_non_list_invalid(self):
        assert _field_valid("a,b,c", "[string]") is False


# ── Unknown type string ───────────────────────────────────────────────────────

class TestUnknownType:
    def test_unknown_type_always_false(self):
        assert _field_valid("anything", "uuid") is False
        assert _field_valid(42, "timestamp") is False
        assert _field_valid({}, "record") is False


# ── _parse_contract error paths ───────────────────────────────────────────────

class TestParseContract:
    def test_invalid_json_returns_none(self):
        assert _parse_contract("{not valid json}") is None

    def test_non_dict_json_returns_none(self):
        # JSON array is valid JSON but not a dict
        assert _parse_contract('["a", "b"]') is None
        # JSON number
        assert _parse_contract("42") is None

    def test_flat_type_map_returns_dict(self):
        result = _parse_contract('{"result": "any", "operation": "string"}')
        assert result == {"result": "any", "operation": "string"}

    def test_json_schema_form_lifts_properties(self):
        schema = '{"type": "object", "properties": {"url": {"type": "string"}, "statusCode": {"type": "integer"}}}'
        result = _parse_contract(schema)
        assert result == {"url": "string", "statusCode": "integer"}

    def test_json_schema_property_without_type_gets_any(self):
        schema = '{"type": "object", "properties": {"meta": {"description": "stuff"}}}'
        result = _parse_contract(schema)
        assert result == {"meta": "any"}


# ── conformance_score with nested contract (extract_json shape) ───────────────

EXTRACT_CONTRACT = {
    "extracted": {"<path>": {"value": "any", "type": "string", "found": "boolean"}},
    "inputKeys": ["string"],
}


class TestConformanceScoreNested:
    def test_full_extract_json_output_scores_one(self):
        output = {
            "extracted": {"name": {"value": "Alice", "type": "string", "found": True}},
            "inputKeys": ["name"],
        }
        assert conformance_score(EXTRACT_CONTRACT, output) == pytest.approx(1.0)

    def test_missing_inputKeys_scores_half(self):
        output = {
            "extracted": {"name": {"value": "Alice", "type": "string", "found": True}},
        }
        assert conformance_score(EXTRACT_CONTRACT, output) == pytest.approx(1 / 2)

    def test_malformed_extracted_entry_scores_half(self):
        # extracted present but inner entry missing required sub-field → not valid
        output = {
            "extracted": {"name": {"value": "Alice"}},  # missing type and found
            "inputKeys": ["name"],
        }
        assert conformance_score(EXTRACT_CONTRACT, output) == pytest.approx(1 / 2)
