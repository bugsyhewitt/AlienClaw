"""Bridge fixture compliance tests — Python side.

Loads test/fixtures/bridge-fixture.json and runs every case against the
Python bridge server implementation. The TypeScript counterpart
(test/bridge/ts-bridge-fixture.test.ts) runs the same cases via subprocess.
CI fails if either side disagrees with any case.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from alienclaw.bridge.server import handle

FIXTURE_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "bridge-fixture.json"


def _load_fixture() -> dict[str, Any]:
    with FIXTURE_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def _all_cases() -> list[dict[str, Any]]:
    return _load_fixture()["cases"]


def pytest_generate_tests(metafunc: pytest.Metafunc) -> None:
    if "case" in metafunc.fixturenames:
        cases = _all_cases()
        ids = [f"case_{i:02d}_{c['description'][:40]}" for i, c in enumerate(cases)]
        metafunc.parametrize("case", cases, ids=ids)


def _run_case(case: dict[str, Any]) -> dict[str, Any]:
    raw = json.dumps(case["request"]).encode("utf-8")
    return handle(raw)


class TestBridgeFixture:
    def test_ok_matches(self, case: dict[str, Any]) -> None:
        resp = _run_case(case)
        response = resp["response"]
        assert response["ok"] == case["expected_ok"], (
            f"Expected ok={case['expected_ok']}, got ok={response['ok']}. "
            f"Error: {response.get('error')}"
        )

    def test_error_code(self, case: dict[str, Any]) -> None:
        if "expected_error_code" not in case:
            pytest.skip("No error code expectation")
        resp = _run_case(case)
        error = resp["response"].get("error", {})
        assert error.get("code") == case["expected_error_code"], (
            f"Expected code={case['expected_error_code']}, got {error.get('code')}"
        )

    def test_output_field(self, case: dict[str, Any]) -> None:
        if "expected_output_field" not in case:
            pytest.skip("No output field expectation")
        resp = _run_case(case)
        output = resp["response"].get("output", {})
        field = case["expected_output_field"]
        expected = case["expected_output_value"]
        assert field in output, f"Field '{field}' not in output: {output}"
        assert output[field] == expected, f"Expected {field}={expected!r}, got {output[field]!r}"

    def test_bridge_version_echoed(self, case: dict[str, Any]) -> None:
        if "expected_bridge_version" not in case:
            pytest.skip("No bridge_version expectation")
        resp = _run_case(case)
        assert resp["bridge_version"] == case["expected_bridge_version"]

    def test_request_id_echoed(self, case: dict[str, Any]) -> None:
        if not case.get("expected_request_id_echoed"):
            pytest.skip("No request_id echo expectation")
        resp = _run_case(case)
        assert resp["request_id"] == case["request"]["request_id"]

    def test_fitness(self, case: dict[str, Any]) -> None:
        if "expected_fitness" not in case:
            pytest.skip("No fitness expectation")
        resp = _run_case(case)
        assert resp["response"]["fitness"] == pytest.approx(case["expected_fitness"])

    def test_metadata_keys(self, case: dict[str, Any]) -> None:
        if "expected_metadata_keys" not in case:
            pytest.skip("No metadata keys expectation")
        if not case.get("expected_ok", True):
            pytest.skip("Error cases have minimal metadata")
        resp = _run_case(case)
        meta = resp["response"].get("run_metadata", {})
        for key in case["expected_metadata_keys"]:
            assert key in meta, f"Expected key '{key}' in run_metadata: {meta}"
