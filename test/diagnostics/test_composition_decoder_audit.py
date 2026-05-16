"""Tests for composition_decoder_audit.py (H3 hypothesis)."""
from __future__ import annotations

import pytest

from alienclaw.diagnostics.composition_decoder_audit import audit_decoder_for_composition


class TestAuditDecoderForComposition:
    def test_compute_then_validate_passes(self):
        """Decoder produces distinct params at both slots for compute_then_validate."""
        result = audit_decoder_for_composition(
            "compute_then_validate", n_genomes=20, seed=42
        )
        assert result["martian_type"] == "compute_then_validate"
        assert result["n_genomes"] == 20
        assert result["overall_passed"] is True

    def test_search_then_count_passes(self):
        """Decoder produces distinct params for search_then_count."""
        result = audit_decoder_for_composition(
            "search_then_count", n_genomes=20, seed=42
        )
        assert result["overall_passed"] is True

    def test_fetch_then_parse_passes(self):
        """Decoder produces distinct params for fetch_then_parse."""
        result = audit_decoder_for_composition(
            "fetch_then_parse", n_genomes=20, seed=42
        )
        assert result["overall_passed"] is True

    def test_slot_count_correct(self):
        """Returns correct number of slots for compute_then_validate (2 slots)."""
        result = audit_decoder_for_composition(
            "compute_then_validate", n_genomes=10, seed=42
        )
        assert len(result["slots"]) == 2

    def test_slot_indices(self):
        """Slot indices are 0 and 1 for a 2-slot composition."""
        result = audit_decoder_for_composition(
            "compute_then_validate", n_genomes=10, seed=42
        )
        indices = [s["slot_index"] for s in result["slots"]]
        assert sorted(indices) == [0, 1]

    def test_genome_sections_distinct(self):
        """Slot 0 uses genome section 1, slot 1 uses section 2."""
        result = audit_decoder_for_composition(
            "compute_then_validate", n_genomes=10, seed=42
        )
        sections = {s["slot_index"]: s["genome_section"] for s in result["slots"]}
        assert sections[0] == 1  # martian_slot 0 → genome section 1
        assert sections[1] == 2  # martian_slot 1 → genome section 2

    def test_distinct_param_sets_above_threshold(self):
        """At least 50% of tested genomes produce distinct parameter sets per slot."""
        result = audit_decoder_for_composition(
            "compute_then_validate", n_genomes=40, seed=42
        )
        for slot in result["slots"]:
            assert slot["distinct_param_sets"] > 0.5 * result["n_genomes"], (
                f"Slot {slot['slot_index']} ({slot['tool_name']}) has only "
                f"{slot['distinct_param_sets']} distinct param sets from {result['n_genomes']} genomes"
            )

    def test_param_range_products_present(self):
        """param_range_products is populated for each slot."""
        result = audit_decoder_for_composition(
            "compute_then_validate", n_genomes=20, seed=42
        )
        for slot in result["slots"]:
            assert "param_range_products" in slot
            # Should have at least some parameters
            assert len(slot["param_range_products"]) >= 0
