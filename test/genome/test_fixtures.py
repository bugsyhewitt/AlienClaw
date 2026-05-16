"""Shared fixture compliance tests (Python side).

Loads test/fixtures/genome-spec-fixtures.json and runs every case against
the Python genome implementation. The TypeScript counterpart
(test/genome/ts-fixture-runner.test.ts) loads the same file against the
TypeScript canonical codec. CI fails the build if either side disagrees.

Adding a new fixture case: add it to the JSON file. Both runners pick it up
automatically on next run.

Never remove fixture cases in v1.0 of the fixture. If a case becomes
obsolete, bump the $schema_version and document the change.
"""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

import pytest

from alienclaw.genome import (  # noqa: F401 — imported for side-effects / coverage
    codec,
    operators,
    validation,
)
from alienclaw.genome.checksum import compute_checksum
from alienclaw.genome.codec import (
    assemble,
    decode_xcode,
    encode_xcode,
    param_value_to_xcode,
    parse,
    round_trip_check,
    xcode_to_param_value,
)
from alienclaw.genome.operators import crossover, mutate
from alienclaw.genome.validation import validate

FIXTURE_PATH = (
    Path(__file__).resolve().parent.parent / "fixtures" / "genome-spec-fixtures.json"
)


def _load_fixture() -> dict[str, Any]:
    with FIXTURE_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def _all_cases() -> list[dict[str, Any]]:
    return _load_fixture()["cases"]


@pytest.mark.parametrize("case", _all_cases(), ids=lambda c: c["name"])
def test_fixture_case(case: dict[str, Any]) -> None:  # noqa: C901
    kind = case["kind"]

    if kind == "checksum":
        actual = compute_checksum(case["input"])
        assert actual == case["expected"], (
            f"Checksum mismatch on '{case['name']}': "
            f"got {actual!r}, expected {case['expected']!r}"
        )

    elif kind == "assemble":
        inp = case["input"]
        actual = assemble(inp["identity"], inp["execution"], inp["behavior"])
        assert actual == case["expected_genome"], (
            f"Assemble mismatch on '{case['name']}': "
            f"got {actual!r}, expected {case['expected_genome']!r}"
        )

    elif kind == "parse":
        parsed = parse(case["input"])
        exp = case["expected"]
        assert parsed.identity == exp["identity"], (
            f"Parse identity mismatch on '{case['name']}'"
        )
        assert parsed.execution == exp["execution"], (
            f"Parse execution mismatch on '{case['name']}'"
        )
        assert parsed.behavior == exp["behavior"], (
            f"Parse behavior mismatch on '{case['name']}'"
        )
        assert parsed.checksum == exp["checksum"], (
            f"Parse checksum mismatch on '{case['name']}'"
        )
        if exp.get("checksum_valid"):
            assert validate(case["input"]).valid, (
                f"Genome should be valid on '{case['name']}'"
            )

    elif kind == "round_trip":
        assert round_trip_check(case["input"]), (
            f"Round-trip failed on '{case['name']}'"
        )

    elif kind == "validate":
        result = validate(case["input"])
        assert result.valid == case["expected_pass"], (
            f"Validate pass/fail mismatch on '{case['name']}': "
            f"got valid={result.valid}, expected {case['expected_pass']}, "
            f"errors={result.errors}"
        )
        if not case["expected_pass"] and "expected_error_contains" in case:
            needle = case["expected_error_contains"].lower()
            combined = " ".join(result.errors).lower()
            assert needle in combined, (
                f"Error message missing '{needle}' on '{case['name']}': "
                f"errors={result.errors}"
            )

    elif kind == "mutate_invariant":
        # Python-side: verify the pre-computed output is valid and invariants hold
        genome = case["input"]
        expected_output = case["python_output"]
        inv = case["expected_invariants"]

        if inv.get("valid_genome"):
            assert validate(expected_output).valid, (
                f"Mutated genome is not valid on '{case['name']}'"
            )
        if inv.get("id_tag_unchanged"):
            assert expected_output[:8] == genome[:8], (
                f"ID-tag changed after mutation on '{case['name']}': "
                f"{genome[:8]!r} → {expected_output[:8]!r}"
            )
        if inv.get("length_256"):
            assert len(expected_output) == 256, (
                f"Mutated genome wrong length on '{case['name']}': "
                f"{len(expected_output)}"
            )
        # Also re-compute deterministically to verify the fixture is self-consistent
        recomputed = mutate(genome, random.Random(case["seed"]), rate=case["rate"])
        assert recomputed == expected_output, (
            f"Mutate determinism broken on '{case['name']}': "
            f"recomputed != stored python_output"
        )

    elif kind == "crossover_invariant":
        parent_a = case["input"]["parent_a"]
        parent_b = case["input"]["parent_b"]
        expected_output = case["python_output"]
        inv = case["expected_invariants"]
        s = 64

        if inv.get("valid_genome"):
            assert validate(expected_output).valid, (
                f"Crossover child is not valid on '{case['name']}'"
            )
        if inv.get("length_256"):
            assert len(expected_output) == 256
        if inv.get("sections_from_parents"):
            for i in range(3):
                section = expected_output[i * s : (i + 1) * s]
                pa_section = parent_a[i * s : (i + 1) * s]
                pb_section = parent_b[i * s : (i + 1) * s]
                assert section in (pa_section, pb_section), (
                    f"Section {i} of crossover child not from either parent "
                    f"on '{case['name']}'"
                )
        # Verify fixture self-consistency
        recomputed = crossover(parent_a, parent_b, random.Random(case["seed"]))
        assert recomputed == expected_output, (
            f"Crossover determinism broken on '{case['name']}'"
        )

    elif kind == "xcode_decode":
        inp = case["input"]
        assert decode_xcode(inp["genome"], inp["slot_index"], inp["xcode_index"]) == case["expected"]

    elif kind == "xcode_encode":
        assert encode_xcode(case["input"]) == case["expected"]

    elif kind == "xcode_to_param":
        inp = case["input"]
        assert xcode_to_param_value(inp["xcode_value"], inp["range_min"], inp["range_max"]) == case["expected"]

    elif kind == "param_to_xcode_roundtrip":
        inp = case["input"]
        x = param_value_to_xcode(inp["param_value"], inp["range_min"], inp["range_max"])
        assert x == case["expected_xcode"]
        assert xcode_to_param_value(x, inp["range_min"], inp["range_max"]) == case["expected_decoded_value"]

    else:
        pytest.fail(f"Unknown fixture kind {kind!r} in case {case['name']!r}")


def test_fixture_has_minimum_cases() -> None:
    """Sanity: fixture must have at least 50 cases to ensure meaningful spec coverage."""
    cases = _all_cases()
    assert len(cases) >= 50, f"Fixture has only {len(cases)} cases (minimum 50)"


def test_fixture_schema_version() -> None:
    fixture = _load_fixture()
    assert fixture.get("$schema_version") == "1.0", (
        f"Unexpected fixture schema version: {fixture.get('$schema_version')!r}"
    )
