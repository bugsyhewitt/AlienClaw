import pytest
from alienclaw.martians.parser import parse_martian, MartianParseError

VALID_SINGLE_SLOT = """
martian_type: test_martian
description: "Test"
use_cases:
  - "Testing"
slots:
  - slot_index: 0
    tool_name: compute
    inputs_from: null
"""

VALID_TWO_SLOT = """
martian_type: two_slot
description: "Two slots"
use_cases: []
slots:
  - slot_index: 0
    tool_name: http_get
    inputs_from: null
  - slot_index: 1
    tool_name: extract_json
    inputs_from:
      fields:
        json: "${slot[0].output.body}"
"""


class TestParseMartian:
    def test_valid_single_slot(self):
        spec = parse_martian(VALID_SINGLE_SLOT)
        assert spec.martian_type == "test_martian"
        assert len(spec.slots) == 1
        assert spec.slots[0].tool_name == "compute"
        assert spec.slots[0].slot_index == 0
        assert spec.slots[0].inputs_from is None

    def test_valid_two_slot(self):
        spec = parse_martian(VALID_TWO_SLOT)
        assert len(spec.slots) == 2
        assert spec.slots[1].inputs_from is not None
        assert "${slot[0].output.body}" in spec.slots[1].inputs_from.fields.values()

    def test_missing_martian_type_raises(self):
        with pytest.raises(MartianParseError, match="martian_type"):
            parse_martian("slots:\n  - slot_index: 0\n    tool_name: compute\n    inputs_from: null\n")

    def test_missing_slots_raises(self):
        with pytest.raises(MartianParseError, match="slots"):
            parse_martian("martian_type: foo\n")

    def test_bad_yaml_raises(self):
        with pytest.raises(MartianParseError, match="YAML"):
            parse_martian("{bad: yaml: content: [}")

    def test_non_dict_top_level_raises(self):
        with pytest.raises(MartianParseError, match="mapping"):
            parse_martian("- item1\n- item2\n")

    def test_empty_slots_raises(self):
        with pytest.raises(MartianParseError, match="non-empty"):
            parse_martian("martian_type: foo\nslots: []\n")

    def test_slot_not_a_mapping_raises(self):
        """Line 39: slot entry is a scalar, not a dict."""
        with pytest.raises(MartianParseError, match="must be a mapping"):
            parse_martian("martian_type: foo\nslots:\n  - string_not_dict\n")

    def test_slot_missing_required_field_raises(self):
        """Line 42: slot_index and tool_name are both required."""
        with pytest.raises(MartianParseError, match="missing 'slot_index'"):
            parse_martian("martian_type: foo\nslots:\n  - tool_name: compute\n")
        with pytest.raises(MartianParseError, match="missing 'tool_name'"):
            parse_martian("martian_type: foo\nslots:\n  - slot_index: 0\n")

    def test_inputs_from_without_fields_key_raises(self):
        """Line 52: inputs_from must be null or have a 'fields' mapping."""
        yaml = (
            "martian_type: foo\nslots:\n"
            "  - slot_index: 0\n    tool_name: compute\n"
            "    inputs_from:\n      wrong_key: bar\n"
        )
        with pytest.raises(MartianParseError, match="inputs_from must be null or have"):
            parse_martian(yaml)

    # PKT-500 type-guard cases
    def test_martian_type_int_raises(self):
        with pytest.raises(MartianParseError, match="martian_type must be a string"):
            parse_martian("martian_type: 42\nslots:\n  - slot_index: 0\n    tool_name: compute\n    inputs_from: null\n")

    def test_martian_type_bool_raises(self):
        with pytest.raises(MartianParseError, match="martian_type must be a string"):
            parse_martian("martian_type: true\nslots:\n  - slot_index: 0\n    tool_name: compute\n    inputs_from: null\n")

    def test_use_cases_nested_mapping_raises(self):
        with pytest.raises(MartianParseError, match="use_cases"):
            parse_martian(
                "martian_type: foo\nuse_cases:\n  - foo\n  - bar: baz\nslots:\n"
                "  - slot_index: 0\n    tool_name: compute\n    inputs_from: null\n"
            )

    def test_use_cases_scalar_raises(self):
        with pytest.raises(MartianParseError, match="use_cases must be a list of strings"):
            parse_martian(
                "martian_type: foo\nuse_cases: hello\nslots:\n"
                "  - slot_index: 0\n    tool_name: compute\n    inputs_from: null\n"
            )

    def test_use_cases_empty_string_scalar_raises(self):
        with pytest.raises(MartianParseError, match="use_cases must be a list of strings"):
            parse_martian(
                "martian_type: foo\nuse_cases: \"\"\nslots:\n"
                "  - slot_index: 0\n    tool_name: compute\n    inputs_from: null\n"
            )

    # PKT-582 tool_name type-guard cases
    def test_tool_name_null_raises(self):
        with pytest.raises(MartianParseError, match="tool_name must be a string"):
            parse_martian("martian_type: x\nslots:\n  - slot_index: 0\n    tool_name: null\n")

    def test_tool_name_int_raises(self):
        with pytest.raises(MartianParseError, match="tool_name must be a string"):
            parse_martian("martian_type: x\nslots:\n  - slot_index: 0\n    tool_name: 42\n")

    def test_tool_name_bool_raises(self):
        with pytest.raises(MartianParseError, match="tool_name must be a string"):
            parse_martian("martian_type: x\nslots:\n  - slot_index: 0\n    tool_name: true\n")

    def test_tool_name_float_raises(self):
        with pytest.raises(MartianParseError, match="tool_name must be a string"):
            parse_martian("martian_type: x\nslots:\n  - slot_index: 0\n    tool_name: 3.14\n")

    def test_tool_name_mapping_raises(self):
        with pytest.raises(MartianParseError, match="tool_name must be a string"):
            parse_martian("martian_type: x\nslots:\n  - slot_index: 0\n    tool_name: {}\n")

    def test_tool_name_quoted_digit_string_accepts(self):
        spec = parse_martian(
            "martian_type: x\nslots:\n  - slot_index: 0\n    tool_name: \"42\"\n"
        )
        assert spec.slots[0].tool_name == "42"


class TestParseMartianSlotIndexTypeGuard:
    """Mirrors the TS describe block at parser.test.ts:772-828 (PKT-534).
    Verifies parser.py:64 rejects non-finite-integer slot_index with MartianParseError
    (not silently truncating, coercing, or leaking TypeError/ValueError/OverflowError)."""

    def test_slot_index_float_truncates_raises(self):
        """Case 1: slot_index: 1.5 must NOT silently truncate to 1."""
        with pytest.raises(MartianParseError, match="slot_index must be a finite integer"):
            parse_martian(
                "martian_type: x\nslots:\n  - slot_index: 1.5\n    tool_name: compute\n    inputs_from: null\n"
            )

    def test_slot_index_integer_valued_float_raises(self):
        """Case 2: slot_index: 2.0 must NOT silently coerce to 2."""
        with pytest.raises(MartianParseError, match="slot_index must be a finite integer"):
            parse_martian(
                "martian_type: x\nslots:\n  - slot_index: 2.0\n    tool_name: compute\n    inputs_from: null\n"
            )

    def test_slot_index_quoted_integer_string_accepts(self):
        """Case 3: slot_index: "0" (quoted string) MUST accept — preserves TS parity."""
        spec = parse_martian(
            "martian_type: x\nslots:\n  - slot_index: \"0\"\n    tool_name: compute\n    inputs_from: null\n"
        )
        assert spec.slots[0].slot_index == 0

    def test_slot_index_quoted_integer_string_seven_accepts(self):
        """Case 3 (extended): slot_index: "7" — explicitly required by TS twin parity test."""
        spec = parse_martian(
            "martian_type: x\nslots:\n  - slot_index: \"7\"\n    tool_name: compute\n    inputs_from: null\n"
        )
        assert spec.slots[0].slot_index == 7

    def test_slot_index_null_raises_martianparseerror_not_typeerror(self):
        """Case 4: slot_index: null must wrap TypeError as MartianParseError (contract)."""
        with pytest.raises(MartianParseError, match="slot_index must be a finite integer"):
            parse_martian(
                "martian_type: x\nslots:\n  - slot_index: null\n    tool_name: compute\n    inputs_from: null\n"
            )

    def test_slot_index_true_raises_martianparseerror_not_silent_coerce(self):
        """Case 5: slot_index: true must NOT silently coerce to 1 (Python bool is int subclass)."""
        with pytest.raises(MartianParseError, match="slot_index must be a finite integer"):
            parse_martian(
                "martian_type: x\nslots:\n  - slot_index: true\n    tool_name: compute\n    inputs_from: null\n"
            )

    def test_slot_index_huge_float_raises_martianparseerror_not_valueerror(self):
        """Case 6: slot_index: 1e100 must wrap ValueError as MartianParseError (contract)."""
        with pytest.raises(MartianParseError, match="slot_index must be a finite integer"):
            parse_martian(
                "martian_type: x\nslots:\n  - slot_index: 1e100\n    tool_name: compute\n    inputs_from: null\n"
            )

    def test_slot_index_inf_raises_martianparseerror_not_overflowerror(self):
        """Case 8: slot_index: .inf must wrap OverflowError as MartianParseError (contract)."""
        with pytest.raises(MartianParseError, match="slot_index must be a finite integer"):
            parse_martian(
                "martian_type: x\nslots:\n  - slot_index: .inf\n    tool_name: compute\n    inputs_from: null\n"
            )

    def test_slot_index_nan_raises_martianparseerror_not_valueerror(self):
        """Case 9: slot_index: .nan must wrap ValueError as MartianParseError (contract)."""
        with pytest.raises(MartianParseError, match="slot_index must be a finite integer"):
            parse_martian(
                "martian_type: x\nslots:\n  - slot_index: .nan\n    tool_name: compute\n    inputs_from: null\n"
            )

    def test_slot_index_negative_accepted_at_parse_caught_by_validator(self):
        """Case 7: slot_index: -1 — matches TS twin, caught downstream by validator."""
        spec = parse_martian(
            "martian_type: x\nslots:\n  - slot_index: 0\n    tool_name: compute\n    inputs_from: null\n  - slot_index: -1\n    tool_name: extract_json\n    inputs_from: null\n"
        )
        assert spec.slots[1].slot_index == -1

    def test_slot_index_valid_non_negative_int_accepts(self):
        """Regression guard: slot_index: 0 (canonical valid) — preserved."""
        spec = parse_martian(
            "martian_type: x\nslots:\n  - slot_index: 0\n    tool_name: compute\n    inputs_from: null\n"
        )
        assert spec.slots[0].slot_index == 0
