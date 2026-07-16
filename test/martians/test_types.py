"""Direct unit tests for alienclaw.martians.types (Packet 16 composition types)."""
import dataclasses

import pytest

from alienclaw.martians.types import (
    EMPTY_SLOT_ID,
    TOOL_ID_TABLE,
    InputWiring,
    MartianSpec,
    SlotDeclaration,
)


def _wiring() -> InputWiring:
    return InputWiring(fields={"json": "${slot[0].output.body}"})


def _spec() -> MartianSpec:
    return MartianSpec(
        martian_type="fetch_and_extract",
        slots=(
            SlotDeclaration(slot_index=0, tool_name="http_get", inputs_from=None),
            SlotDeclaration(slot_index=1, tool_name="extract_json", inputs_from=_wiring()),
        ),
        description="Fetch a URL then extract JSON.",
        use_cases=("api scraping",),
    )


class TestToolIdTable:
    def test_contains_exactly_the_eight_packet16_tools(self):
        assert sorted(TOOL_ID_TABLE) == [
            "compute",
            "extract_json",
            "file_read",
            "file_write",
            "http_get",
            "search_text",
            "url_fetch",
            "web_search",
        ]

    def test_ids_assigned_alphabetically_starting_at_1(self):
        # ARCHITECTURE §Packet 16: IDs assigned alphabetically, never change.
        for position, name in enumerate(sorted(TOOL_ID_TABLE), start=1):
            assert TOOL_ID_TABLE[name] == position

    def test_ids_are_unique(self):
        assert len(set(TOOL_ID_TABLE.values())) == len(TOOL_ID_TABLE)

    def test_empty_slot_id_is_zero_and_reserved(self):
        assert EMPTY_SLOT_ID == 0
        assert EMPTY_SLOT_ID not in TOOL_ID_TABLE.values()


class TestInputWiring:
    def test_construction_exposes_fields_mapping(self):
        w = _wiring()
        assert w.fields == {"json": "${slot[0].output.body}"}

    def test_equality_by_value(self):
        assert _wiring() == _wiring()
        assert _wiring() != InputWiring(fields={"json": "${slot[1].output.body}"})

    def test_frozen(self):
        with pytest.raises(dataclasses.FrozenInstanceError):
            _wiring().fields = {}

    def test_not_hashable_because_of_dict_field(self):
        # frozen=True generates a field-based __hash__, but dict fields are
        # unhashable — InputWiring cannot be used in sets or as dict keys.
        with pytest.raises(TypeError):
            hash(_wiring())


class TestSlotDeclaration:
    def test_construction_without_wiring(self):
        decl = SlotDeclaration(slot_index=0, tool_name="compute", inputs_from=None)
        assert decl.slot_index == 0
        assert decl.tool_name == "compute"
        assert decl.inputs_from is None

    def test_construction_with_wiring(self):
        decl = SlotDeclaration(slot_index=1, tool_name="extract_json", inputs_from=_wiring())
        assert decl.inputs_from == _wiring()

    def test_frozen(self):
        decl = SlotDeclaration(slot_index=0, tool_name="compute", inputs_from=None)
        with pytest.raises(dataclasses.FrozenInstanceError):
            decl.tool_name = "web_search"

    def test_hashable_when_inputs_from_is_none(self):
        decl = SlotDeclaration(slot_index=0, tool_name="compute", inputs_from=None)
        assert isinstance(hash(decl), int)

    def test_tool_name_is_not_validated_by_the_type(self):
        # Membership in TOOL_ID_TABLE is enforced by validator.py, not here.
        decl = SlotDeclaration(slot_index=0, tool_name="not_a_real_tool", inputs_from=None)
        assert decl.tool_name not in TOOL_ID_TABLE


class TestMartianSpec:
    def test_construction(self):
        spec = _spec()
        assert spec.martian_type == "fetch_and_extract"
        assert isinstance(spec.slots, tuple)
        assert len(spec.slots) == 2
        assert [s.tool_name for s in spec.slots] == ["http_get", "extract_json"]
        assert spec.use_cases == ("api scraping",)

    def test_equality_by_value(self):
        assert _spec() == _spec()

    def test_inequality_on_changed_description(self):
        assert dataclasses.replace(_spec(), description="different") != _spec()

    def test_frozen(self):
        with pytest.raises(dataclasses.FrozenInstanceError):
            _spec().martian_type = "renamed"
