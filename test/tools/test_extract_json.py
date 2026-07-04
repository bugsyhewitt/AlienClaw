"""Tests for alienclaw.tools.extract_json.run() — MSB OUTPUT CONTRACT compliance + edge cases.

MSB OUTPUT CONTRACT (seed/msb/extract_json.msb):
    {
      "extracted": { "<path>": { "value": "any", "type": "string", "found": "boolean" } },
      "inputKeys":  ["string"]
    }
"""
from __future__ import annotations

import pytest

from alienclaw.tools.extract_json import run


# ── Missing-input guard ─────────────────────────────────────────────────────

class TestMissingInput:
    def test_empty_inputs_returns_failure(self):
        r = run({})
        assert r.ok is False
        assert r.correctness == 0.0
        assert "Missing 'json'" in r.error

    def test_explicit_none_json(self):
        r = run({"json": None, "path": "x"})
        assert r.ok is False
        assert "Missing 'json'" in r.error


# ── MSB OUTPUT CONTRACT compliance ─────────────────────────────────────────

class TestMsbOutputContract:
    """Verify the OUTPUT CONTRACT from seed/msb/extract_json.msb."""

    def test_top_level_key_uses_extracted_wrapper(self):
        r = run({"json": '{"name": "alice"}', "path": "name"})
        assert r.ok is True
        assert "extracted" in r.output
        assert "inputKeys" in r.output
        # Top-level snake_case 'value'/'type' must be GONE
        assert "value" not in r.output
        assert "type" not in r.output
        assert "path" not in r.output
        assert r.output["extracted"] == {"name": {"value": "alice", "type": "str"}}

    def test_nested_key_uses_dot_path_as_key(self):
        r = run({"json": '{"user": {"id": 99}}', "path": "user.id"})
        assert r.ok is True
        assert r.output["extracted"] == {"user.id": {"value": 99, "type": "int"}}
        assert r.output["inputKeys"] == ["user"]

    def test_array_index_uses_bracket_path_as_key(self):
        r = run({"json": '{"items": ["first", "second"]}', "path": "items[0]"})
        assert r.ok is True
        assert r.output["extracted"] == {"items[0]": {"value": "first", "type": "str"}}
        assert r.output["inputKeys"] == ["items"]

    def test_inputKeys_is_sorted_object_keys(self):
        r = run({"json": '{"b": 2, "a": 1, "c": 3}', "path": "a"})
        assert r.ok is True
        assert r.output["inputKeys"] == ["a", "b", "c"]

    def test_inputKeys_empty_for_array_input(self):
        r = run({"json": "[1, 2, 3]", "path": ""})
        assert r.ok is True
        assert r.output["inputKeys"] == []

    def test_inputKeys_empty_for_scalar_input(self):
        r = run({"json": '"hello"', "path": ""})
        assert r.ok is True
        assert r.output["inputKeys"] == []

    def test_empty_path_returns_empty_extracted_and_inputKeys(self):
        r = run({"json": '{"a": 1, "b": 2}', "path": ""})
        assert r.ok is True
        assert r.output["extracted"] == {}
        assert r.output["inputKeys"] == ["a", "b"]

    def test_path_with_leading_dot_skips_empty_segment(self):
        # re.split(r"\.|(?=\[)", ".foo") → ['', 'foo']
        # L13: the empty '' part must be silently skipped, not raise KeyError
        r = run({"json": '{"foo": 42}', "path": ".foo"}, {})
        assert r.ok is True
        assert r.output["extracted"][".foo"]["value"] == 42


# ── result_format gating (fitness-control parameter) ───────────────────────

class TestResultFormat:
    """result_format 1..3 gates which sub-fields appear in extracted[path]."""

    def test_result_format_1_emits_only_value(self):
        r = run({"json": '{"a": 1}', "path": "a"}, {"result_format": 1})
        assert r.ok is True
        assert r.output["extracted"] == {"a": {"value": 1}}

    def test_result_format_2_emits_value_and_type(self):
        r = run({"json": '{"a": 1}', "path": "a"}, {"result_format": 2})
        assert r.ok is True
        assert r.output["extracted"] == {"a": {"value": 1, "type": "int"}}

    def test_result_format_3_emits_value_type_found(self):
        r = run({"json": '{"a": 1}', "path": "a"}, {"result_format": 3})
        assert r.ok is True
        assert r.output["extracted"] == {"a": {"value": 1, "type": "int", "found": True}}

    def test_result_format_clamped_to_1_3(self):
        # result_format 0 -> clamped to 1 (value only)
        r = run({"json": '{"a": 1}', "path": "a"}, {"result_format": 0})
        assert r.ok is True
        assert r.output["extracted"]["a"] == {"value": 1}
        # result_format 4 -> clamped to 3 (value + type + found)
        r = run({"json": '{"a": 1}', "path": "a"}, {"result_format": 4})
        assert r.ok is True
        assert r.output["extracted"]["a"]["found"] is True
        # result_format 99 -> clamped to 3
        r = run({"json": '{"a": 1}', "path": "a"}, {"result_format": 99})
        assert r.ok is True
        assert r.output["extracted"]["a"]["found"] is True
        # result_format -1 -> clamped to 1 (value only)
        r = run({"json": '{"a": 1}', "path": "a"}, {"result_format": -1})
        assert r.ok is True
        assert r.output["extracted"]["a"] == {"value": 1}


# ── extraction_passes drives tool_calls ────────────────────────────────────

class TestExtractionPasses:
    def test_default_extraction_passes_1(self):
        r = run({"json": '{"a": 1}', "path": "a"})
        assert r.tool_calls == 1

    def test_extraction_passes_3(self):
        r = run({"json": '{"a": 1}', "path": "a"}, {"extraction_passes": 3})
        assert r.tool_calls == 3

    def test_extraction_passes_clamped_to_1_5(self):
        r = run({"json": '{"a": 1}', "path": "a"}, {"extraction_passes": 99})
        assert r.tool_calls == 5


# ── Error paths ────────────────────────────────────────────────────────────

class TestErrorPaths:
    def test_bad_json_returns_parse_error(self):
        r = run({"json": "not_json", "path": "x"})
        assert r.ok is False
        assert "JSON parse error" in r.error
        assert r.correctness == 0.0

    def test_missing_path_returns_path_not_found(self):
        r = run({"json": '{"a": 1}', "path": "missing"})
        assert r.ok is False
        assert "Path not found" in r.error
        assert r.correctness == 0.0

    def test_array_index_out_of_range(self):
        r = run({"json": '{"items": ["a"]}', "path": "items[5]"})
        assert r.ok is False
        assert "out of range" in r.error

    def test_10mb_size_limit(self):
        big = "x" * (11 * 1024 * 1024)
        r = run({"json": big, "path": "x"})
        assert r.ok is False
        assert "10 MB" in r.error

    def test_alt_input_field_name(self):
        """`input` is accepted as alias for `json` (per existing fixture case)."""
        r = run({"input": '{"a": 1}', "path": "a"})
        assert r.ok is True
        assert r.output["extracted"]["a"]["value"] == 1


# ── Wall-clean meta-check ─────────────────────────────────────────────────

class TestWallClean:
    """The test file itself must contain zero banned terms on a single line.

    The pattern is constructed from concatenated fragments so that no single
    line of this file contains a literal banned token (the static wall-check
    scanner in test/wall-check.test.ts scans line-by-line). The runtime regex
    reconstructs the equivalent compound-word pattern.
    """

    def test_no_banned_terms(self):
        # Fragment the banned tokens so no single line contains them whole.
        f1, f2 = "meese", "eks"
        f3, f4, f5 = "five", "-", "layer"
        f6, f7 = "Spec", "ialist"
        compound = f1 + f2 + "|" + f3 + f4 + f5 + "|" + f6 + f7
        pattern = "\\b(" + compound + ")\\b"
        import re as _re
        with open(__file__, "r") as f:
            body = f.read()
        matches = _re.findall(pattern, body)
        assert matches == [], f"banned compound terms found in test file: {matches}"
