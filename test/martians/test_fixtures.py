"""Fixture-driven tests for martian registry cases."""
import json
import pytest
from pathlib import Path
from alienclaw.martians.parser import parse_martian, MartianParseError
from alienclaw.martians.registry import MartianRegistry
from alienclaw.martians.types import TOOL_ID_TABLE
from alienclaw.martians.validator import validate_martian
from alienclaw.brains.registry import BrainRegistry

FIXTURE_PATH = Path("test/fixtures/martian-registry-fixtures.json")


@pytest.fixture(scope="module")
def brains():
    return BrainRegistry.load("seed/msb/")


@pytest.fixture(scope="module")
def registry(brains):
    return MartianRegistry.load("seed/martians/", brains)


def _load_cases():
    data = json.loads(FIXTURE_PATH.read_text())
    return data["cases"]


@pytest.mark.parametrize("case", _load_cases(), ids=lambda c: c["name"])
def test_martian_fixture(case, brains, registry):
    kind = case["kind"]
    if kind == "parse_martian_file":
        path = Path(case["input_file"])
        spec = parse_martian(path.read_text(), str(path))
        exp = case["expected"]
        assert spec.martian_type == exp["martian_type"]
        assert len(spec.slots) == exp["slot_count"]
        assert spec.slots[0].tool_name == exp["slot_0_tool"]
        if "slot_1_tool" in exp:
            assert spec.slots[1].tool_name == exp["slot_1_tool"]
    elif kind == "registry_count":
        assert len(registry.all()) == case["expected_count"]
    elif kind == "registry_has":
        assert registry.has(case["martian_type"]) == case["expected"]
    elif kind == "tool_id":
        assert TOOL_ID_TABLE[case["tool_name"]] == case["expected_id"]
    elif kind == "parse_martian_error":
        with pytest.raises(MartianParseError, match=case["expected_error"]):
            parse_martian(case["content"])
    elif kind == "validate_error":
        spec = parse_martian(case["spec_yaml"])
        result = validate_martian(spec, brains)
        assert not result.valid
        assert any(case["expected_error"] in e for e in result.errors)
    else:
        pytest.skip(f"Unknown fixture kind: {kind}")
