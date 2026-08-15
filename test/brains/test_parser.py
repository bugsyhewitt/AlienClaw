"""Tests for brains.parser module."""

from __future__ import annotations

import pytest

from alienclaw.brains.parser import REQUIRED_SECTIONS, parse_msb, validate
from alienclaw.brains.types import GenomeSectionDocs

# ---------------------------------------------------------------------------
# Minimal valid .msb content for testing
# ---------------------------------------------------------------------------

MINIMAL_MSB = """\
TOOL: test_minimal
VERSION: 1.0

CAPABILITIES:
Does something useful.

LIMITATIONS:
Has some limits.

FAILURE MODES:
Fails sometimes.

BEST PRACTICES:
Do things right.

EXECUTION ORDER:
1. Step one
2. Step two

OUTPUT CONTRACT:
{"result": "string"}

GENOME SECTIONS:
IDENTITY: Chars 0-7 = ID tag. Chars 8-9 = gen. Chars 10-19 = ns. Chars 20-63 = family.
EXECUTION: Char 0 = retry. Char 1 = backoff. Chars 2-63 = flow + padding.
BEHAVIOR: Char 0 = escalation mode. Chars 1-63 = label + contract.
CHECKSUM: FNV-1a hash of sections 0-2.

VARIABLES:
task: The task description
input: The input value
"""

WEB_SEARCH_PATH = "seed/msb/web_search.msb"


class TestValidate:
    def test_valid_content_passes(self) -> None:
        result = validate(MINIMAL_MSB)
        assert result.valid
        assert result.errors == ()

    def test_missing_tool_fails(self) -> None:
        bad = MINIMAL_MSB.replace("TOOL: test_minimal", "")
        result = validate(bad)
        assert not result.valid
        assert any("TOOL" in e for e in result.errors)

    def test_missing_version_fails(self) -> None:
        bad = MINIMAL_MSB.replace("VERSION: 1.0", "")
        result = validate(bad)
        assert not result.valid
        assert any("VERSION" in e for e in result.errors)

    def test_all_required_sections_validated(self) -> None:
        for section in REQUIRED_SECTIONS:
            # Remove the section header line entirely (replacement of "X..." prefix
            # doesn't work since the original is still a substring of the prefixed form)
            lines = [
                line for line in MINIMAL_MSB.splitlines()
                if not line.startswith(f"{section}:")
            ]
            bad = "\n".join(lines)
            result = validate(bad)
            assert not result.valid, f"Should fail when {section} is missing"

    def test_required_sections_count(self) -> None:
        assert len(REQUIRED_SECTIONS) == 10

    def test_valid_result_is_truthy_in_boolean_context(self) -> None:
        """ValidationResult.__bool__ returns True for valid=True."""
        result = validate(MINIMAL_MSB)
        assert result  # exercises __bool__ at types.py:104

    def test_invalid_result_is_falsy_in_boolean_context(self) -> None:
        """ValidationResult.__bool__ returns False for valid=False."""
        bad = MINIMAL_MSB.replace("TOOL: test_minimal", "")
        result = validate(bad)
        assert not result  # exercises __bool__ at types.py:104

    def test_prefixed_capabilities_is_rejected(self) -> None:
        raw = MINIMAL_MSB.replace("CAPABILITIES:", "MY_CAPABILITIES:")
        result = validate(raw)
        assert not result.valid
        assert "Missing required section: CAPABILITIES" in result.errors

    def test_prefixed_failure_modes_is_rejected(self) -> None:
        raw = MINIMAL_MSB.replace("FAILURE MODES:", "OUR_FAILURE MODES:")
        result = validate(raw)
        assert not result.valid
        assert "Missing required section: FAILURE MODES" in result.errors

    def test_prefixed_genome_sections_is_rejected(self) -> None:
        raw = MINIMAL_MSB.replace("GENOME SECTIONS:", "FOO GENOME SECTIONS:")
        result = validate(raw)
        assert not result.valid
        assert "Missing required section: GENOME SECTIONS" in result.errors

    def test_prefixed_variables_is_rejected(self) -> None:
        raw = MINIMAL_MSB.replace("VARIABLES:", "MY_VARIABLES:")
        result = validate(raw)
        assert not result.valid
        assert "Missing required section: VARIABLES" in result.errors


class TestParseMsb:
    def test_parses_tool_name(self) -> None:
        spec = parse_msb(MINIMAL_MSB)
        assert spec.tool == "test_minimal"

    def test_parses_version(self) -> None:
        spec = parse_msb(MINIMAL_MSB)
        assert spec.version == "1.0"

    def test_parses_capabilities(self) -> None:
        spec = parse_msb(MINIMAL_MSB)
        assert "Does something useful" in spec.capabilities

    def test_parses_limitations(self) -> None:
        spec = parse_msb(MINIMAL_MSB)
        assert "Has some limits" in spec.limitations

    def test_parses_failure_modes(self) -> None:
        spec = parse_msb(MINIMAL_MSB)
        assert "Fails sometimes" in spec.failure_modes

    def test_parses_best_practices(self) -> None:
        spec = parse_msb(MINIMAL_MSB)
        assert "Do things right" in spec.best_practices

    def test_parses_execution_order_as_tuple(self) -> None:
        spec = parse_msb(MINIMAL_MSB)
        assert isinstance(spec.execution_order, tuple)
        assert len(spec.execution_order) == 2
        assert spec.execution_order[0] == "Step one"
        assert spec.execution_order[1] == "Step two"

    def test_parses_output_contract(self) -> None:
        spec = parse_msb(MINIMAL_MSB)
        assert "result" in spec.output_contract

    def test_parses_genome_sections(self) -> None:
        spec = parse_msb(MINIMAL_MSB)
        assert isinstance(spec.genome_sections, GenomeSectionDocs)
        assert "ID tag" in spec.genome_sections.identity
        assert "retry" in spec.genome_sections.execution
        assert "escalation mode" in spec.genome_sections.behavior
        assert "FNV-1a" in spec.genome_sections.checksum

    def test_parses_variables(self) -> None:
        spec = parse_msb(MINIMAL_MSB)
        assert isinstance(spec.variables, dict)
        assert "task" in spec.variables
        assert "input" in spec.variables

    def test_source_path_stored(self) -> None:
        spec = parse_msb(MINIMAL_MSB, source_path="some/path.msb")
        assert spec.source_path == "some/path.msb"

    def test_default_source_path(self) -> None:
        spec = parse_msb(MINIMAL_MSB)
        assert spec.source_path == "<string>"

    def test_raises_on_invalid_content(self) -> None:
        with pytest.raises(ValueError, match="MSB validation failed"):
            parse_msb("TOOL: incomplete\nVERSION: 1.0")

    def test_source_path_in_error_message(self) -> None:
        with pytest.raises(ValueError, match="myfile.msb"):
            parse_msb("incomplete", source_path="myfile.msb")

    def test_spec_is_frozen(self) -> None:
        spec = parse_msb(MINIMAL_MSB)
        with pytest.raises((AttributeError, TypeError)):
            spec.tool = "changed"  # type: ignore[misc]

    def test_parses_real_web_search_brain(self) -> None:
        with open(WEB_SEARCH_PATH, encoding="utf-8") as f:
            content = f.read()
        spec = parse_msb(content, WEB_SEARCH_PATH)
        assert spec.tool == "web_search"
        assert spec.version == "1.1"
        assert spec.capabilities
        assert spec.limitations
        assert spec.execution_order
        assert "web_search" in spec.genome_sections.identity.lower() or \
               "WEB" in spec.genome_sections.identity

    def test_parses_all_8_seed_brains(self) -> None:
        import os
        for name in ["web_search", "file_read", "file_write", "url_fetch",
                     "http_get", "compute", "search_text", "extract_json"]:
            path = f"seed/msb/{name}.msb"
            assert os.path.exists(path), f"Missing brain: {path}"
            with open(path, encoding="utf-8") as f:
                spec = parse_msb(f.read(), path)
            assert spec.tool == name, f"Tool name mismatch in {path}"
            assert spec.version
            assert spec.capabilities


class TestExtractParameterSchema:
    def test_exactly_seven_fields_parses_full_description(self) -> None:
        from alienclaw.brains.parser import _extract_parameter_schema
        raw = "PARAMETER_SCHEMA:\nname|0|1|5|1|lower|simple description\n"
        fields = _extract_parameter_schema(raw)
        assert len(fields) == 1
        assert fields[0].description == "simple description"

    def test_pipe_in_description_raises(self) -> None:
        from alienclaw.brains.parser import BrainParseError, _extract_parameter_schema
        raw = "PARAMETER_SCHEMA:\nname|0|1|5|1|lower|foo|bar|baz\n"
        with pytest.raises(BrainParseError, match="has 9 fields"):
            _extract_parameter_schema(raw)

    def test_six_fields_raises(self) -> None:
        from alienclaw.brains.parser import BrainParseError, _extract_parameter_schema
        raw = "PARAMETER_SCHEMA:\nname|0|1|5|1|lower\n"
        with pytest.raises(BrainParseError, match="has 6 fields"):
            _extract_parameter_schema(raw)

    # --- PKT-578: xcode_index bounds ---

    def test_xcode_index_zero_valid(self) -> None:
        from alienclaw.brains.parser import _extract_parameter_schema
        raw = "PARAMETER_SCHEMA:\nfoo|0|1|5|1|lower|desc\n"
        fields = _extract_parameter_schema(raw)
        assert len(fields) == 1
        assert fields[0].xcode_index == 0

    def test_xcode_index_thirty_valid(self) -> None:
        from alienclaw.brains.parser import _extract_parameter_schema
        raw = "PARAMETER_SCHEMA:\nfoo|30|1|5|1|lower|desc\n"
        fields = _extract_parameter_schema(raw)
        assert len(fields) == 1
        assert fields[0].xcode_index == 30

    def test_xcode_index_thirty_one_raises(self) -> None:
        from alienclaw.brains.parser import BrainParseError, _extract_parameter_schema
        raw = "PARAMETER_SCHEMA:\nfoo|31|1|5|1|lower|desc\n"
        with pytest.raises(BrainParseError, match="xcode_index must be in \\[0,30\\]"):
            _extract_parameter_schema(raw)

    def test_xcode_index_negative_raises(self) -> None:
        from alienclaw.brains.parser import BrainParseError, _extract_parameter_schema
        raw = "PARAMETER_SCHEMA:\nfoo|-1|1|5|1|lower|desc\n"
        with pytest.raises(BrainParseError, match="xcode_index must be in \\[0,30\\]"):
            _extract_parameter_schema(raw)

    def test_xcode_index_999_raises(self) -> None:
        from alienclaw.brains.parser import BrainParseError, _extract_parameter_schema
        raw = "PARAMETER_SCHEMA:\nfoo|999|1|5|1|lower|desc\n"
        with pytest.raises(BrainParseError, match="xcode_index must be in \\[0,30\\]"):
            _extract_parameter_schema(raw)

    # --- PKT-578: range_min <= range_max ---

    def test_range_min_max_inverted_raises(self) -> None:
        from alienclaw.brains.parser import BrainParseError, _extract_parameter_schema
        raw = "PARAMETER_SCHEMA:\nfoo|0|10|5|5|lower|desc\n"
        with pytest.raises(BrainParseError, match="range_min.*must be <= range_max"):
            _extract_parameter_schema(raw)

    def test_range_min_equal_range_max_valid(self) -> None:
        from alienclaw.brains.parser import _extract_parameter_schema
        raw = "PARAMETER_SCHEMA:\nfoo|0|5|5|5|lower|desc\n"
        fields = _extract_parameter_schema(raw)
        assert len(fields) == 1
        assert fields[0].range_min == 5
        assert fields[0].range_max == 5

    # --- PKT-578: default in [range_min, range_max] ---

    def test_default_below_range_min_raises(self) -> None:
        from alienclaw.brains.parser import BrainParseError, _extract_parameter_schema
        raw = "PARAMETER_SCHEMA:\nfoo|0|1|5|0|lower|desc\n"
        with pytest.raises(BrainParseError, match="default.*must be in"):
            _extract_parameter_schema(raw)

    def test_default_above_range_max_raises(self) -> None:
        from alienclaw.brains.parser import BrainParseError, _extract_parameter_schema
        raw = "PARAMETER_SCHEMA:\nfoo|0|1|5|10|lower|desc\n"
        with pytest.raises(BrainParseError, match="default.*must be in"):
            _extract_parameter_schema(raw)

    def test_default_at_range_min_valid(self) -> None:
        from alienclaw.brains.parser import _extract_parameter_schema
        raw = "PARAMETER_SCHEMA:\nfoo|0|1|5|1|lower|desc\n"
        fields = _extract_parameter_schema(raw)
        assert len(fields) == 1
        assert fields[0].default == 1

    def test_default_at_range_max_valid(self) -> None:
        from alienclaw.brains.parser import _extract_parameter_schema
        raw = "PARAMETER_SCHEMA:\nfoo|0|1|5|5|lower|desc\n"
        fields = _extract_parameter_schema(raw)
        assert len(fields) == 1
        assert fields[0].default == 5

    def test_negative_default_raises(self) -> None:
        from alienclaw.brains.parser import BrainParseError, _extract_parameter_schema
        raw = "PARAMETER_SCHEMA:\nfoo|0|1|5|-100|lower|desc\n"
        with pytest.raises(BrainParseError, match="default.*must be in"):
            _extract_parameter_schema(raw)

    # --- PKT-592: name integrity (corrective re-author of PKT-583) ---

    def test_empty_name_raises(self) -> None:
        from alienclaw.brains.parser import BrainParseError, _extract_parameter_schema
        raw = "PARAMETER_SCHEMA:\n|0|1|5|1|lower|desc\n"
        with pytest.raises(BrainParseError, match="empty name"):
            _extract_parameter_schema(raw)

    def test_duplicate_name_raises(self) -> None:
        from alienclaw.brains.parser import BrainParseError, _extract_parameter_schema
        raw = "PARAMETER_SCHEMA:\nfoo|0|1|5|1|lower|d1\nfoo|1|1|5|1|lower|d2\n"
        with pytest.raises(BrainParseError, match="duplicate name .*foo."):
            _extract_parameter_schema(raw)

    def test_duplicate_name_third_position_raises(self) -> None:
        from alienclaw.brains.parser import BrainParseError, _extract_parameter_schema
        raw = (
            "PARAMETER_SCHEMA:\nfoo|0|1|5|1|lower|d1\n"
            "bar|1|1|5|1|lower|d2\n"
            "foo|2|1|5|1|lower|d3\n"
        )
        with pytest.raises(BrainParseError, match="duplicate name .*foo."):
            _extract_parameter_schema(raw)

    def test_unique_nonempty_names_accepted(self) -> None:
        from alienclaw.brains.parser import _extract_parameter_schema
        raw = (
            "PARAMETER_SCHEMA:\nfoo|0|1|5|1|lower|d1\n"
            "bar|1|1|5|1|lower|d2\n"
        )
        fields = _extract_parameter_schema(raw)
        assert len(fields) == 2
        assert fields[0].name == "foo"
        assert fields[1].name == "bar"


# ---------------------------------------------------------------------------
# PKT-673: _extract_section embedded-heading premature-termination (R-673-1..14)
# ---------------------------------------------------------------------------

def _make_673_msb(
    capabilities:    str = "cap line",
    limitations:     str = "lim line",
    failure_modes:   str = "fm line",
    best_practices:  str = "bp line",
    variables:       str = "task: the task",
    parameter_schema: str | None = None,
) -> str:
    """Build a minimal valid .msb string for PKT-673 tests."""
    out = (
        f"TOOL: pkt673_test\n"
        f"VERSION: 1.0\n\n"
        f"CAPABILITIES:\n{capabilities}\n\n"
        f"LIMITATIONS:\n{limitations}\n\n"
        f"FAILURE MODES:\n{failure_modes}\n\n"
        f"BEST PRACTICES:\n{best_practices}\n\n"
        f"EXECUTION ORDER:\n1. step\n\n"
        f"OUTPUT CONTRACT:\n{{}}\n\n"
        f"GENOME SECTIONS:\nIDENTITY: x\nEXECUTION: y\nBEHAVIOR: z\nCHECKSUM: w\n\n"
        f"VARIABLES:\n{variables}\n"
    )
    if parameter_schema is not None:
        out += f"\nPARAMETER_SCHEMA:\n{parameter_schema}\n"
    return out


class TestExtractSectionEmbeddedHeading:
    """PKT-673: _extract_section premature termination on embedded ALL-CAPS heading."""

    # R-673-1..6: embedded developer-comment patterns must NOT truncate section body

    def test_r673_1_capabilities_with_note_does_not_truncate(self) -> None:
        raw = _make_673_msb(
            capabilities="cap line\nNOTE: this should not terminate\nLine two of capabilities."
        )
        spec = parse_msb(raw)
        assert "NOTE: this should not terminate" in spec.capabilities
        assert "Line two of capabilities." in spec.capabilities

    def test_r673_2_capabilities_with_todo_does_not_truncate(self) -> None:
        raw = _make_673_msb(
            capabilities="cap line\nTODO: fix this later\nLine two of capabilities."
        )
        spec = parse_msb(raw)
        assert "TODO: fix this later" in spec.capabilities
        assert "Line two of capabilities." in spec.capabilities

    def test_r673_3_capabilities_with_fixme_does_not_truncate(self) -> None:
        raw = _make_673_msb(
            capabilities="cap line\nFIXME: broken edge case\nLine two of capabilities."
        )
        spec = parse_msb(raw)
        assert "FIXME: broken edge case" in spec.capabilities
        assert "Line two of capabilities." in spec.capabilities

    def test_r673_4_variables_with_note_captures_both_vars(self) -> None:
        raw = _make_673_msb(variables="foo: the foo value\nNOTE: a developer note\nbar: the bar value")
        spec = parse_msb(raw)
        assert spec.variables.get("foo") == "the foo value"
        assert spec.variables.get("bar") == "the bar value"

    def test_r673_5_variables_with_todo_captures_both_vars(self) -> None:
        raw = _make_673_msb(variables="foo: the foo value\nTODO: fix this\nbar: the bar value")
        spec = parse_msb(raw)
        assert spec.variables.get("foo") == "the foo value"
        assert spec.variables.get("bar") == "the bar value"

    def test_r673_6_limitations_with_warn_captures_all_content(self) -> None:
        raw = _make_673_msb(limitations="limit line one\nWARN: important warning\nlimit line two")
        spec = parse_msb(raw)
        assert "WARN: important warning" in spec.limitations
        assert "limit line two" in spec.limitations

    # R-673-7..10: adjacent-header no-merge regression guards

    def test_r673_7_adjacent_capabilities_limitations_splits_correctly(self) -> None:
        raw = (
            "TOOL: pkt673_test\nVERSION: 1.0\n\n"
            "CAPABILITIES:\ncap content\n"
            "LIMITATIONS:\nlim content\n\n"
            "FAILURE MODES:\nfm\n\n"
            "BEST PRACTICES:\nbp\n\n"
            "EXECUTION ORDER:\n1. step\n\n"
            "OUTPUT CONTRACT:\n{}\n\n"
            "GENOME SECTIONS:\nIDENTITY: x\nEXECUTION: y\nBEHAVIOR: z\nCHECKSUM: w\n\n"
            "VARIABLES:\ntask: the task\n"
        )
        spec = parse_msb(raw)
        assert spec.capabilities == "cap content"
        assert "lim content" in spec.limitations

    def test_r673_8_adjacent_limitations_failure_modes_splits_correctly(self) -> None:
        raw = (
            "TOOL: pkt673_test\nVERSION: 1.0\n\n"
            "CAPABILITIES:\ncap\n\n"
            "LIMITATIONS:\nlim content\n"
            "FAILURE MODES:\nfm content\n\n"
            "BEST PRACTICES:\nbp\n\n"
            "EXECUTION ORDER:\n1. step\n\n"
            "OUTPUT CONTRACT:\n{}\n\n"
            "GENOME SECTIONS:\nIDENTITY: x\nEXECUTION: y\nBEHAVIOR: z\nCHECKSUM: w\n\n"
            "VARIABLES:\ntask: the task\n"
        )
        spec = parse_msb(raw)
        assert spec.limitations == "lim content"
        assert "fm content" in spec.failure_modes

    def test_r673_9_adjacent_failure_modes_best_practices_splits_correctly(self) -> None:
        raw = (
            "TOOL: pkt673_test\nVERSION: 1.0\n\n"
            "CAPABILITIES:\ncap\n\n"
            "LIMITATIONS:\nlim\n\n"
            "FAILURE MODES:\nfm content\n"
            "BEST PRACTICES:\nbp content\n\n"
            "EXECUTION ORDER:\n1. step\n\n"
            "OUTPUT CONTRACT:\n{}\n\n"
            "GENOME SECTIONS:\nIDENTITY: x\nEXECUTION: y\nBEHAVIOR: z\nCHECKSUM: w\n\n"
            "VARIABLES:\ntask: the task\n"
        )
        spec = parse_msb(raw)
        assert spec.failure_modes == "fm content"
        assert "bp content" in spec.best_practices

    def test_r673_10_adjacent_variables_parameter_schema_splits_correctly(self) -> None:
        raw = _make_673_msb(
            variables="foo: the foo value",
            parameter_schema="max_attempts|0|1|5|1|lower|Maximum retry attempts",
        )
        spec = parse_msb(raw)
        assert spec.variables.get("foo") == "the foo value"
        assert "PARAMETER_SCHEMA" not in spec.variables
        assert len(spec.parameter_schema) == 1
        assert spec.parameter_schema[0].name == "max_attempts"

    # R-673-11..12: edge-case regression guards

    def test_r673_11_capabilities_with_important_does_not_truncate(self) -> None:
        raw = _make_673_msb(capabilities="cap line\nIMPORTANT: read this\nLine two of capabilities.")
        spec = parse_msb(raw)
        assert "IMPORTANT: read this" in spec.capabilities
        assert "Line two of capabilities." in spec.capabilities

    def test_r673_12_section_at_end_of_string_returns_body_up_to_eof(self) -> None:
        # VARIABLES is the last section with no trailing newline — exercises the \\Z path.
        raw = (
            "TOOL: pkt673_test\nVERSION: 1.0\n\n"
            "CAPABILITIES:\ncap\n\n"
            "LIMITATIONS:\nlim\n\n"
            "FAILURE MODES:\nfm\n\n"
            "BEST PRACTICES:\nbp\n\n"
            "EXECUTION ORDER:\n1. step\n\n"
            "OUTPUT CONTRACT:\n{}\n\n"
            "GENOME SECTIONS:\nIDENTITY: x\nEXECUTION: y\nBEHAVIOR: z\nCHECKSUM: w\n\n"
            "VARIABLES:\ntask: the task"  # no trailing newline
        )
        spec = parse_msb(raw)
        assert spec.variables.get("task") == "the task"

    def test_r673_13_all_canonical_seed_msb_files_parse_without_error(self) -> None:
        import os
        msb_dir = "seed/msb"
        files = [f for f in os.listdir(msb_dir) if f.endswith(".msb")]
        assert len(files) > 0
        for fname in files:
            path = os.path.join(msb_dir, fname)
            with open(path, encoding="utf-8") as fh:
                content = fh.read()
            spec = parse_msb(content, path)
            assert spec.tool, f"Empty tool in {path}"
            assert spec.capabilities, f"Empty capabilities in {path}"

    def test_r673_14_api_key_inside_capabilities_allowed_as_body_content(self) -> None:
        raw = _make_673_msb(
            capabilities="Requires API_KEY: env var to be set.\nSecond line of capabilities."
        )
        spec = parse_msb(raw)
        assert "API_KEY:" in spec.capabilities
        assert "Second line of capabilities." in spec.capabilities
