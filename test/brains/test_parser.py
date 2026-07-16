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
