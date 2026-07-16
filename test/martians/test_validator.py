import pytest
from alienclaw.martians.parser import parse_martian
from alienclaw.martians.validator import validate_martian
from alienclaw.brains.registry import BrainRegistry


@pytest.fixture(scope="module")
def real_brains():
    return BrainRegistry.load("seed/msb/")


def test_valid_single_slot(real_brains):
    spec = parse_martian("martian_type: x\nslots:\n  - slot_index: 0\n    tool_name: compute\n    inputs_from: null\n")
    result = validate_martian(spec, real_brains)
    assert result.valid, result.errors


def test_valid_two_slot(real_brains):
    yaml = ("martian_type: x\nslots:\n"
            "  - slot_index: 0\n    tool_name: http_get\n    inputs_from: null\n"
            "  - slot_index: 1\n    tool_name: extract_json\n    inputs_from:\n"
            "      fields:\n        json: \"${slot[0].output.body}\"\n")
    spec = parse_martian(yaml)
    result = validate_martian(spec, real_brains)
    assert result.valid, result.errors


def test_duplicate_slot_index_invalid(real_brains):
    yaml = ("martian_type: x\nslots:\n"
            "  - slot_index: 0\n    tool_name: compute\n    inputs_from: null\n"
            "  - slot_index: 0\n    tool_name: http_get\n    inputs_from: null\n")
    spec = parse_martian(yaml)
    result = validate_martian(spec, real_brains)
    assert not result.valid
    assert any("Duplicate" in e for e in result.errors)


def test_slot_index_2_invalid(real_brains):
    yaml = ("martian_type: x\nslots:\n"
            "  - slot_index: 0\n    tool_name: compute\n    inputs_from: null\n"
            "  - slot_index: 1\n    tool_name: http_get\n    inputs_from: null\n"
            "  - slot_index: 2\n    tool_name: file_read\n    inputs_from: null\n")
    spec = parse_martian(yaml)
    result = validate_martian(spec, real_brains)
    assert not result.valid
    assert any("max 1" in e or "slot_index=2" in e for e in result.errors)


def test_unknown_tool_invalid(real_brains):
    yaml = ("martian_type: x\nslots:\n"
            "  - slot_index: 0\n    tool_name: nonexistent_tool\n    inputs_from: null\n")
    spec = parse_martian(yaml)
    result = validate_martian(spec, real_brains)
    assert not result.valid


def test_forward_reference_invalid(real_brains):
    yaml = ("martian_type: x\nslots:\n"
            "  - slot_index: 0\n    tool_name: compute\n    inputs_from: null\n"
            "  - slot_index: 1\n    tool_name: extract_json\n"
            "    inputs_from:\n      fields:\n"
            "        json: \"${slot[1].output.result}\"\n")
    spec = parse_martian(yaml)
    result = validate_martian(spec, real_brains)
    assert not result.valid
    assert any("forward" in e.lower() for e in result.errors)


def test_empty_slots_invalid(real_brains):
    from alienclaw.martians.types import MartianSpec
    spec = MartianSpec(martian_type="x", slots=(), description="", use_cases=())
    result = validate_martian(spec, real_brains)
    assert not result.valid


def test_malformed_substitution_token_invalid(real_brains):
    """Template field with ${...} that doesn't match the wiring pattern → invalid."""
    yaml = (
        "martian_type: x\nslots:\n"
        "  - slot_index: 0\n    tool_name: compute\n    inputs_from: null\n"
        "  - slot_index: 1\n    tool_name: extract_json\n"
        "    inputs_from:\n      fields:\n"
        "        json: \"${malformed_placeholder}\"\n"
    )
    spec = parse_martian(yaml)
    result = validate_martian(spec, real_brains)
    assert not result.valid
    assert any("malformed substitution token" in e for e in result.errors)
    assert any("malformed_placeholder" in e for e in result.errors)
