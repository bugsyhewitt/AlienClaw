"""Tests for brains.registry module."""

from __future__ import annotations

import pytest

from alienclaw.brains.registry import BrainRegistry, CatalogSummary

SEED_MSB_DIR = "seed/msb/"
ALL_TOOL_NAMES = sorted([
    "web_search", "file_read", "file_write", "url_fetch",
    "http_get", "compute", "search_text", "extract_json",
])


class TestBrainRegistryLoad:
    def test_loads_seed_dir(self) -> None:
        reg = BrainRegistry.load(SEED_MSB_DIR)
        assert len(reg) == 8

    def test_all_8_brains_present(self) -> None:
        reg = BrainRegistry.load(SEED_MSB_DIR)
        names = sorted(b.tool for b in reg.all_brains())
        assert names == ALL_TOOL_NAMES

    def test_no_errors_on_seed_dir(self) -> None:
        # Should not raise
        BrainRegistry.load(SEED_MSB_DIR)

    def test_load_order_alphabetical(self) -> None:
        """Brains are loaded alphabetically by filename."""
        reg = BrainRegistry.load(SEED_MSB_DIR)
        loaded_names = [b.tool for b in reg.all_brains()]
        expected_order = [
            "compute",        # compute.msb
            "extract_json",   # extract_json.msb
            "file_read",      # file_read.msb
            "file_write",     # file_write.msb
            "http_get",       # http_get.msb
            "search_text",    # search_text.msb
            "url_fetch",      # url_fetch.msb
            "web_search",     # web_search.msb
        ]
        assert loaded_names == expected_order

    def test_raises_on_nonexistent_dir(self) -> None:
        with pytest.raises(FileNotFoundError):
            BrainRegistry.load("/nonexistent/path/")

    def test_raises_on_duplicate_tool_name(self, tmp_path) -> None:
        """Two brains with the same tool name must raise ValueError."""
        minimal = """\
TOOL: dup_tool
VERSION: 1.0

CAPABILITIES:
Does something.

LIMITATIONS:
Has limits.

FAILURE MODES:
Fails.

BEST PRACTICES:
Be good.

EXECUTION ORDER:
1. Do it

OUTPUT CONTRACT:
{"result": "string"}

GENOME SECTIONS:
IDENTITY: Chars 0-7 = ID. Chars 8-9 = gen. Chars 10-19 = ns. Chars 20-63 = fam.
EXECUTION: Char 0 = retry. Char 1 = backoff. Chars 2-63 = flow.
BEHAVIOR: Char 0 = escalation. Chars 1-63 = label.
CHECKSUM: FNV-1a hash.

VARIABLES:
task: The task
"""
        (tmp_path / "a.msb").write_text(minimal, encoding="utf-8")
        (tmp_path / "b.msb").write_text(minimal, encoding="utf-8")  # same tool name
        with pytest.raises(ValueError, match="Duplicate tool name"):
            BrainRegistry.load(tmp_path)


class TestBrainRegistryLookup:
    def setup_method(self) -> None:
        self.reg = BrainRegistry.load(SEED_MSB_DIR)

    def test_lookup_by_name_found(self) -> None:
        brain = self.reg.lookup_by_name("web_search")
        assert brain is not None
        assert brain.tool == "web_search"

    def test_lookup_by_name_not_found(self) -> None:
        brain = self.reg.lookup_by_name("nonexistent_tool")
        assert brain is None

    def test_all_brains_returns_all(self) -> None:
        brains = self.reg.all_brains()
        assert len(brains) == 8

    def test_catalog_summary(self) -> None:
        summary = self.reg.catalog_summary()
        assert isinstance(summary, CatalogSummary)
        assert summary.brain_count == 8
        assert summary.tool_names == ALL_TOOL_NAMES
        assert all(name in summary.versions for name in ALL_TOOL_NAMES)

    def test_len(self) -> None:
        assert len(self.reg) == 8
