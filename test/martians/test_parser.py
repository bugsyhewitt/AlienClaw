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
