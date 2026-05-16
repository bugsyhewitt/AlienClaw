"""Audit slot-aware decoding for composition Martians.

Tests whether decode_params(brain, genome, slot_index) produces
distinct outputs for distinct genomes at each slot of a composition.

H3 hypothesis: decoder bug might return identical parameters for
distinct genomes at some non-zero slot. This module tests that.
"""
from __future__ import annotations

import os
import tempfile
from typing import Any

from alienclaw.brains.decoder import decode_params
from alienclaw.brains.registry import BrainRegistry
from alienclaw.martians.registry import MartianRegistry
from alienclaw.evolution.population import Population
from alienclaw.evolution.types import EvolutionConfig


def audit_decoder_for_composition(
    martian_type: str,
    n_genomes: int = 100,
    seed: int = 42,
    msb_dir: str = "seed/msb/",
    martians_dir: str = "seed/martians/",
) -> dict[str, Any]:
    """Audit decoder output diversity for one composition Martian.

    Generates n_genomes random valid genomes (using the Population API
    to ensure correct checksums), then decodes parameters at every slot.
    Counts distinct parameter sets per slot.

    Args:
        martian_type: Martian type name (must be in martians_dir)
        n_genomes: number of distinct genomes to test
        seed: RNG seed for genome generation
        msb_dir: path to .msb brain files
        martians_dir: path to .martian files

    Returns:
        {
            "martian_type": str,
            "n_genomes": int,
            "slots": [
                {
                    "slot_index": int,
                    "tool_name": str,
                    "genome_section": int,   # slot_index + 1
                    "distinct_param_sets": int,
                    "param_range_products": dict,  # per-param: number of distinct values seen
                    "passed": bool,          # distinct_param_sets > 0.5 * n_genomes
                },
                ...
            ],
            "overall_passed": bool,  # True iff all slots passed
        }
    """
    brain_registry = BrainRegistry.load(msb_dir)
    martian_registry = MartianRegistry.load(martians_dir, brain_registry)
    martian_spec = martian_registry.get(martian_type)

    # Generate n_genomes valid checksummed genomes via Population API
    with tempfile.TemporaryDirectory() as tmp_dir:
        saved_root = os.environ.get("ALIENCLAW_POPULATIONS_ROOT")
        os.environ["ALIENCLAW_POPULATIONS_ROOT"] = tmp_dir
        try:
            config = EvolutionConfig(
                martian_type=martian_type,
                population_size=n_genomes,
                seed=seed,
            )
            pop = Population.create(config)
            genomes = [e.genome for e in pop.all()]
        finally:
            if saved_root is None:
                os.environ.pop("ALIENCLAW_POPULATIONS_ROOT", None)
            else:
                os.environ["ALIENCLAW_POPULATIONS_ROOT"] = saved_root

    slot_results = []
    for slot in martian_spec.slots:
        brain = brain_registry.lookup_by_name(slot.tool_name)
        if brain is None:
            slot_results.append({
                "slot_index": slot.slot_index,
                "tool_name": slot.tool_name,
                "genome_section": slot.slot_index + 1,
                "distinct_param_sets": 0,
                "param_range_products": {},
                "passed": False,
                "error": f"brain '{slot.tool_name}' not found",
            })
            continue

        genome_section = slot.slot_index + 1  # as used in bridge/server.py

        if not brain.parameter_schema:
            # No parameters = trivially passes (nothing to differentiate)
            slot_results.append({
                "slot_index": slot.slot_index,
                "tool_name": slot.tool_name,
                "genome_section": genome_section,
                "distinct_param_sets": n_genomes,
                "param_range_products": {},
                "passed": True,
                "note": "no parameter_schema; no genome-driven parameters",
            })
            continue

        decoded_sets: list[tuple] = []
        for genome in genomes:
            params = decode_params(brain, genome, slot_index=genome_section)
            decoded_sets.append(tuple(sorted(params.items())))

        distinct = len(set(decoded_sets))
        param_distinct: dict[str, int] = {}
        for field in brain.parameter_schema:
            per_genome_values = set(
                decode_params(brain, g, slot_index=genome_section).get(field.name)
                for g in genomes
            )
            param_distinct[field.name] = len(per_genome_values)

        passed = distinct > 0.5 * n_genomes

        slot_results.append({
            "slot_index": slot.slot_index,
            "tool_name": slot.tool_name,
            "genome_section": genome_section,
            "distinct_param_sets": distinct,
            "param_range_products": param_distinct,
            "passed": passed,
        })

    return {
        "martian_type": martian_type,
        "n_genomes": n_genomes,
        "slots": slot_results,
        "overall_passed": all(s["passed"] for s in slot_results),
    }
