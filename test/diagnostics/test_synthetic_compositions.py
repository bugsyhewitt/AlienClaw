"""Tests for synthetic_compositions.py."""
from __future__ import annotations

import pytest

from alienclaw.diagnostics.synthetic_compositions import (
    build_compute_chain,
    register_synthetic_composition,
    deregister_synthetic_composition,
)


class TestBuildComputeChain:
    def test_k1_single_slot(self):
        spec = build_compute_chain(1)
        assert len(spec.slots) == 1
        assert spec.slots[0].tool_name == "compute"
        assert spec.slots[0].inputs_from is None

    def test_k2_two_slots(self):
        spec = build_compute_chain(2)
        assert len(spec.slots) == 2
        assert spec.slots[0].inputs_from is None
        assert spec.slots[1].inputs_from is not None

    def test_k4_four_slots(self):
        spec = build_compute_chain(4)
        assert len(spec.slots) == 4

    def test_k8_eight_slots(self):
        spec = build_compute_chain(8)
        assert len(spec.slots) == 8

    def test_slot_indices_sequential(self):
        spec = build_compute_chain(4)
        for i, slot in enumerate(spec.slots):
            assert slot.slot_index == i

    def test_all_slots_are_compute(self):
        spec = build_compute_chain(4)
        for slot in spec.slots:
            assert slot.tool_name == "compute"

    def test_slot1_wired_from_slot0(self):
        spec = build_compute_chain(3)
        wiring = spec.slots[1].inputs_from
        assert wiring is not None
        assert "input" in wiring.fields
        assert "${slot[0].output.result}" in wiring.fields["input"]

    def test_slot2_wired_from_slot1(self):
        spec = build_compute_chain(3)
        wiring = spec.slots[2].inputs_from
        assert wiring is not None
        assert "${slot[1].output.result}" in wiring.fields["input"]

    def test_default_name(self):
        spec = build_compute_chain(4)
        assert spec.martian_type == "synthetic_compute_k4"

    def test_custom_name(self):
        spec = build_compute_chain(4, name="my_k4_comp")
        assert spec.martian_type == "my_k4_comp"

    def test_k0_raises(self):
        with pytest.raises(ValueError):
            build_compute_chain(0)

    def test_deterministic(self):
        spec1 = build_compute_chain(4)
        spec2 = build_compute_chain(4)
        assert spec1.martian_type == spec2.martian_type
        assert len(spec1.slots) == len(spec2.slots)


class TestRegistration:
    def test_register_deregister(self):
        spec = build_compute_chain(4, name="test_synthetic_k4_temp")
        try:
            register_synthetic_composition(spec)
            from alienclaw.bridge.server import _get_martian_registry
            registry = _get_martian_registry()
            assert registry.has("test_synthetic_k4_temp")
        finally:
            deregister_synthetic_composition("test_synthetic_k4_temp")

    def test_deregister_removes(self):
        spec = build_compute_chain(4, name="test_remove_k4_temp")
        register_synthetic_composition(spec)
        deregister_synthetic_composition("test_remove_k4_temp")
        from alienclaw.bridge.server import _get_martian_registry
        registry = _get_martian_registry()
        assert not registry.has("test_remove_k4_temp")

    def test_deregister_noop_if_not_registered(self):
        # Should not raise
        deregister_synthetic_composition("nonexistent_synthetic_type_xyz")
