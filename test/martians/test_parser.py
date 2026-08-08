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

    def test_slot_index_float_raises(self):
        """PKT-564: float slot_index (0.5) must raise MartianParseError, not silently truncate."""
        yaml = (
            "martian_type: test\nslots:\n"
            "  - slot_index: 0.5\n    tool_name: compute\n    inputs_from: null\n"
        )
        with pytest.raises(MartianParseError, match="non-negative integer"):
            parse_martian(yaml)

    def test_slot_index_str_float_raises(self):
        """PKT-564: quoted float string slot_index ("0.5") must raise MartianParseError."""
        yaml = (
            "martian_type: test\nslots:\n"
            "  - slot_index: \"0.5\"\n    tool_name: compute\n    inputs_from: null\n"
        )
        with pytest.raises(MartianParseError, match="non-negative integer"):
            parse_martian(yaml)

    def test_slot_index_negative_raises(self):
        """PKT-564: negative slot_index (-1) must raise MartianParseError."""
        yaml = (
            "martian_type: test\nslots:\n"
            "  - slot_index: -1\n    tool_name: compute\n    inputs_from: null\n"
        )
        with pytest.raises(MartianParseError, match="non-negative integer"):
            parse_martian(yaml)

    def test_slot_index_null_raises(self):
        """PKT-564: null slot_index must raise MartianParseError (not raw TypeError)."""
        yaml = (
            "martian_type: test\nslots:\n"
            "  - slot_index: null\n    tool_name: compute\n    inputs_from: null\n"
        )
        with pytest.raises(MartianParseError, match="non-negative integer"):
            parse_martian(yaml)

    def test_slot_index_str_nonnumeric_raises(self):
        """PKT-564: non-numeric string slot_index (abc) must raise MartianParseError (not raw ValueError)."""
        yaml = (
            "martian_type: test\nslots:\n"
            "  - slot_index: abc\n    tool_name: compute\n    inputs_from: null\n"
        )
        with pytest.raises(MartianParseError, match="non-negative integer"):
            parse_martian(yaml)

    def test_slot_index_bool_raises(self):
        """PKT-564: boolean slot_index (true) must raise MartianParseError (not silently become 1)."""
        yaml = (
            "martian_type: test\nslots:\n"
            "  - slot_index: true\n    tool_name: compute\n    inputs_from: null\n"
        )
        with pytest.raises(MartianParseError, match="non-negative integer"):
            parse_martian(yaml)
