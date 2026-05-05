"""Shared brain registry fixture compliance tests (Python side).

Loads test/fixtures/brain-registry-fixtures.json and runs every case
against the Python brain registry implementation. The TypeScript counterpart
(test/brains/ts-fixture-runner.test.ts) runs the same cases against the
TypeScript msb-loader. CI fails if either side disagrees with any case.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from alienclaw.brains.parser import parse_msb, validate
from alienclaw.brains.registry import BrainRegistry

FIXTURE_PATH = (
    Path(__file__).resolve().parent.parent / "fixtures" / "brain-registry-fixtures.json"
)


def _load_fixture() -> dict[str, Any]:
    with FIXTURE_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def _all_cases() -> list[dict[str, Any]]:
    return _load_fixture()["cases"]


def _load_content(case: dict[str, Any]) -> str:
    """Load .msb content from fixture (either from file or inline)."""
    if "input_file" in case:
        return Path(case["input_file"]).read_text(encoding="utf-8")
    return case["input_content"]


@pytest.mark.parametrize("case", _all_cases(), ids=lambda c: c["name"])
def test_fixture_case(case: dict[str, Any]) -> None:  # noqa: C901
    kind = case["kind"]
    exp = case.get("expected", {})

    if kind in ("parse", "parse_inline"):
        content = _load_content(case)
        spec = parse_msb(content)

        if "tool" in exp:
            assert spec.tool == exp["tool"]
        if "version" in exp:
            assert spec.version == exp["version"]
        if "capabilities_first_line" in exp:
            assert spec.capabilities.split("\n")[0] == exp["capabilities_first_line"]
        if "capabilities_line_count" in exp:
            assert len(spec.capabilities.split("\n")) == exp["capabilities_line_count"]
        if "capabilities_line_1" in exp:
            assert spec.capabilities.split("\n")[0] == exp["capabilities_line_1"]
        if "capabilities_line_2" in exp:
            lines = spec.capabilities.split("\n")
            assert lines[1] == exp["capabilities_line_2"] if len(lines) > 1 else ""
        if "capabilities_nonempty" in exp:
            assert bool(spec.capabilities) == exp["capabilities_nonempty"]
        if "limitations_nonempty" in exp:
            assert bool(spec.limitations) == exp["limitations_nonempty"]
        if "failure_modes_nonempty" in exp:
            assert bool(spec.failure_modes) == exp["failure_modes_nonempty"]
        if "best_practices_nonempty" in exp:
            assert bool(spec.best_practices) == exp["best_practices_nonempty"]
        if "execution_order_count" in exp:
            assert len(spec.execution_order) == exp["execution_order_count"]
        if "execution_order_first" in exp:
            first = spec.execution_order[0] if spec.execution_order else ""
            assert first == exp["execution_order_first"]
        if "execution_order_last" in exp:
            last = spec.execution_order[-1] if spec.execution_order else ""
            assert last == exp["execution_order_last"]
        if "output_contract_nonempty" in exp:
            assert bool(spec.output_contract) == exp["output_contract_nonempty"]
        if "genome_identity_contains" in exp:
            assert exp["genome_identity_contains"] in spec.genome_sections.identity
        if "genome_identity_nonempty" in exp:
            assert bool(spec.genome_sections.identity) == exp["genome_identity_nonempty"]
        if "genome_execution_nonempty" in exp:
            assert bool(spec.genome_sections.execution) == exp["genome_execution_nonempty"]
        if "genome_behavior_nonempty" in exp:
            assert bool(spec.genome_sections.behavior) == exp["genome_behavior_nonempty"]
        if "genome_checksum_nonempty" in exp:
            assert bool(spec.genome_sections.checksum) == exp["genome_checksum_nonempty"]
        if "variables_keys" in exp:
            assert list(spec.variables.keys()) == exp["variables_keys"]
        if "variables_count" in exp:
            assert len(spec.variables) == exp["variables_count"]

    elif kind == "validate":
        content = _load_content(case)
        result = validate(content)
        assert result.valid == case["expected_pass"], (
            f"Expected valid={case['expected_pass']} but got valid={result.valid}; "
            f"errors={result.errors}"
        )
        if not case["expected_pass"] and "expected_error_contains" in case:
            needle = case["expected_error_contains"]
            combined = " ".join(result.errors)
            assert needle in combined, (
                f"Error message missing '{needle}'; got: {result.errors}"
            )

    elif kind == "catalog":
        reg = BrainRegistry.load(case["seed_dir"])
        summary = reg.catalog_summary()

        if "brain_count" in exp:
            assert summary.brain_count == exp["brain_count"]
        if "tool_names" in exp:
            assert summary.tool_names == exp["tool_names"]
        if "versions" in exp:
            assert summary.versions == exp["versions"]
        if "tool_names_in_load_order" in exp:
            actual_order = [b.tool for b in reg.all_brains()]
            assert actual_order == exp["tool_names_in_load_order"]

    else:
        pytest.fail(f"Unknown fixture kind '{kind}' in case '{case['name']}'")


def test_fixture_has_minimum_cases() -> None:
    cases = _all_cases()
    assert len(cases) >= 30, f"Fixture has only {len(cases)} cases (minimum 30)"


def test_fixture_schema_version() -> None:
    assert _load_fixture().get("$schema_version") == "1.0"
