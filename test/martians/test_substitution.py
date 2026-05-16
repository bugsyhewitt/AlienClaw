import json, pytest
from alienclaw.martians.substitution import substitute, resolve_inputs
from alienclaw.martians.types import InputWiring


class TestSubstitute:
    def test_campaign_field_string(self):
        result = substitute("${campaign.query}", [], {"query": "hello"})
        assert result == "hello"

    def test_slot_output_string(self):
        result = substitute("${slot[0].output.body}", [{"body": "content"}], {})
        assert result == "content"

    def test_non_string_auto_json(self):
        result = substitute("${slot[0].output.count}", [{"count": 42}], {})
        assert result == "42"

    def test_list_auto_json(self):
        result = substitute("${slot[0].output.matches}", [{"matches": [1, 2, 3]}], {})
        assert result == json.dumps([1, 2, 3])

    def test_forward_reference_raises(self):
        with pytest.raises(ValueError, match="slot"):
            substitute("${slot[1].output.x}", [{"y": 1}], {})

    def test_missing_slot_field_raises(self):
        with pytest.raises(ValueError, match="'x'"):
            substitute("${slot[0].output.x}", [{"y": 1}], {})

    def test_missing_campaign_field_raises(self):
        with pytest.raises(ValueError, match="'missing'"):
            substitute("${campaign.missing}", [], {"present": 1})

    def test_no_tokens_passthrough(self):
        assert substitute("plain text", [], {}) == "plain text"

    def test_multiple_tokens(self):
        result = substitute("${campaign.a} and ${slot[0].output.b}", [{"b": "B"}], {"a": "A"})
        assert result == "A and B"

    def test_bool_serialized(self):
        result = substitute("${slot[0].output.ok}", [{"ok": True}], {})
        assert result == "true"


class TestResolveInputs:
    def test_none_wiring_returns_campaign(self):
        result = resolve_inputs(None, [], {"a": "1"})
        assert result == {"a": "1"}

    def test_wiring_resolves_fields(self):
        wiring = InputWiring(fields={"json": "${slot[0].output.body}"})
        result = resolve_inputs(wiring, [{"body": "{\"x\":1}"}], {})
        assert result == {"json": '{"x":1}'}
