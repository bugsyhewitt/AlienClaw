"""Tests for the composition Martian stub generator (Packet 19)."""
from __future__ import annotations

import json
from pathlib import Path

from alienclaw.diagnostics.martian_stub_generator import get_composition_inputs

COMPOSITION_TYPES = [
    "search_then_count",
    "compute_then_validate",
    "fetch_then_parse",
    "read_then_extract",
    "fetch_then_extract",
    "write_then_verify",
    "compute_then_write",
    "search_then_fetch",
]


class TestGetCompositionInputs:
    def test_all_types_return_nonempty_dict(self, tmp_path: Path) -> None:
        for mt in COMPOSITION_TYPES:
            result = get_composition_inputs(mt, "http://localhost:9999", tmp_path)
            assert isinstance(result, dict), f"{mt}: expected dict"
            assert len(result) > 0, f"{mt}: empty inputs"

    def test_search_then_count_has_text_and_pattern(self, tmp_path: Path) -> None:
        r = get_composition_inputs("search_then_count", "http://localhost:9999", tmp_path)
        assert "text" in r and "pattern" in r
        assert "fox" in r["text"].lower()

    def test_read_then_extract_creates_json_file(self, tmp_path: Path) -> None:
        r = get_composition_inputs("read_then_extract", "http://localhost:9999", tmp_path)
        assert "path" in r
        path = Path(r["path"])
        assert path.exists()
        data = json.loads(path.read_text())
        assert isinstance(data, dict)

    def test_http_compositions_include_stub_url(self, tmp_path: Path) -> None:
        base = "http://stub-test:1234"
        for mt in ["fetch_then_parse", "fetch_then_extract"]:
            r = get_composition_inputs(mt, base, tmp_path)
            assert any(base in str(v) for v in r.values()), f"{mt}: no stub URL"

    def test_write_then_verify_includes_path_and_content(self, tmp_path: Path) -> None:
        r = get_composition_inputs("write_then_verify", "http://localhost", tmp_path)
        assert "path" in r and "content" in r

    def test_compute_then_validate_provides_input(self, tmp_path: Path) -> None:
        r = get_composition_inputs("compute_then_validate", "http://localhost", tmp_path)
        assert "input" in r

    def test_compute_then_write_provides_write_path(self, tmp_path: Path) -> None:
        r = get_composition_inputs("compute_then_write", "http://localhost", tmp_path)
        assert "write_path" in r and "input" in r

    def test_unknown_type_returns_empty_dict(self, tmp_path: Path) -> None:
        r = get_composition_inputs("nonexistent_martian", "http://localhost", tmp_path)
        assert r == {}

    def test_search_then_fetch_has_fetch_url(self, tmp_path: Path) -> None:
        r = get_composition_inputs("search_then_fetch", "http://stub:5678", tmp_path)
        assert "fetch_url" in r
        assert "stub:5678" in r["fetch_url"]

    def test_text_has_enough_content_for_sensitivity(self, tmp_path: Path) -> None:
        r = get_composition_inputs("search_then_count", "http://localhost", tmp_path)
        lines = r["text"].split("\n")
        matches = [line for line in lines if "fox" in line.lower()]
        assert len(matches) >= 10

    def test_extract_compositions_provide_extract_path(self, tmp_path: Path) -> None:
        # Slot 1 (extract_json) wires path from ${campaign.extract_path}
        # for these three Martians; without it, slot 1 input resolution fails.
        for mt in ["fetch_then_parse", "fetch_then_extract", "read_then_extract"]:
            r = get_composition_inputs(mt, "http://localhost", tmp_path)
            assert "extract_path" in r, f"{mt}: missing extract_path"
