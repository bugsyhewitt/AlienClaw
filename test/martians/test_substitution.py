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

    # PKT-708: cross-lang parity — 5 tests mirroring TS twin block at
    # substitution.test.ts:88-140 ('forward / self / out-of-range slot references')

    def test_forward_reference_message_contains_diagnostic(self):
        """PKT-708: error must say 'forward/self reference'."""
        with pytest.raises(ValueError, match=r"forward/self reference"):
            substitute("${slot[2].output.x}", [{"a": 1}, {"b": 2}], {})

    def test_forward_reference_message_names_valid_range(self):
        """PKT-708: error must include 'valid indices are 0..N'."""
        with pytest.raises(ValueError, match=r"valid indices are 0\.\.1"):
            substitute("${slot[2].output.x}", [{"a": 1}, {"b": 2}], {})

    def test_self_reference_empty_prior_uses_friendly_phrasing(self):
        """PKT-708: empty prior list must say 'no prior slot outputs'; must NOT contain '0..-1'."""
        with pytest.raises(ValueError, match=r"no prior slot outputs are available") as exc_info:
            substitute("${slot[0].output.field}", [], {})
        assert "0..-1" not in str(exc_info.value), (
            f"empty-prior message must not contain '0..-1'; got: {exc_info.value!r}"
        )

    def test_far_out_of_range_uses_same_framing(self):
        """PKT-708: far-out-of-range uses forward/self + valid-range framing."""
        with pytest.raises(ValueError, match=r"forward/self reference"):
            substitute("${slot[99].output.x}", [{"a": 1}], {})
        with pytest.raises(ValueError, match=r"valid indices are 0\.\.0"):
            substitute("${slot[99].output.x}", [{"a": 1}], {})

    def test_pkt708_negative_valid_prior_slot_does_not_throw(self):
        """PKT-708: negative control — valid prior slot succeeds, no error."""
        assert substitute("${slot[0].output.a}", [{"a": "ok"}], {}) == "ok"

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

    def test_non_ascii_slot_index_passthrough(self):
        # After fix: Python [0-9]+ won't match Arabic-Indic U+0660 '٠',
        # so the token passes through unchanged (same as TS behavior).
        # BEFORE fix this returns "content" and the assertion FAILS (RED).
        result = substitute("${slot[٠].output.body}", [{"body": "content"}], {})
        assert result == "${slot[٠].output.body}"


class TestResolveInputs:
    def test_none_wiring_returns_campaign(self):
        result = resolve_inputs(None, [], {"a": "1"})
        assert result == {"a": "1"}

    def test_wiring_resolves_fields(self):
        wiring = InputWiring(fields={"json": "${slot[0].output.body}"})
        result = resolve_inputs(wiring, [{"body": "{\"x\":1}"}], {})
        assert result == {"json": '{"x":1}'}
