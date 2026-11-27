"""The examples agree with the hand-coded bounds in pho3nix_tuner/tooltime_bounds.py.

This is the proof that the catalog could replace the hand-coded table: the gene space built
from the examples' evolvable bounds equals tooltime_bounds.EVOLVABLE_BOUNDS, and every
documented-only entry appears as a non-evolvable bounds block.
"""

from __future__ import annotations

import importlib.util

import pytest
import validate_bounds as vb
import yaml
from conftest import EXAMPLES, TUNER_BOUNDS

# Tuner (tool, gene name) -> catalog (tool, param name). Catalog names follow Pho3nix's
# rebuild_command_with_params keys; the tuner's gene names carry a unit suffix.
ALIASES = {
    ("gobuster", "threads"): ("gobuster", "threads"),
    ("gobuster", "delay_ms"): ("gobuster", "delay"),
    ("gobuster", "timeout_sec"): ("gobuster", "timeout"),
    ("nmap", "timing_t"): ("nmap", "timing"),
    ("sqlmap", "level"): ("sqlmap", "level"),
    ("sqlmap", "risk"): ("sqlmap", "risk"),
    ("sqlmap", "threads"): ("sqlmap", "threads"),
    ("sqlmap", "delay"): ("sqlmap", "delay"),
}

# The tuner's direction answers "which way does the optimiser push"; the catalog's answers
# "what does raising the value do to target load". maximize/minimize translate directly.
# "context" entries are resolved from Pho3nix optimization_profiles ordering
# (stealth -> normal -> aggressive): nmap timing T2 -> T4 -> T5 rises; gobuster timeout
# 30s -> 10s -> 5s falls.
DIRECTION = {"maximize": "increases_aggressiveness", "minimize": "decreases_aggressiveness"}
CONTEXT_RESOLVED = {
    ("nmap", "timing_t"): "increases_aggressiveness",
    ("gobuster", "timeout_sec"): "decreases_aggressiveness",
}


@pytest.fixture(scope="module")
def tuner():
    if not TUNER_BOUNDS.is_file():
        pytest.skip(f"{TUNER_BOUNDS} not present")
    spec = importlib.util.spec_from_file_location("_tuner_tooltime_bounds", TUNER_BOUNDS)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # module-level code only defines tables and functions
    return mod


@pytest.fixture(scope="module")
def catalog():
    return {p.name.split(".")[0]: yaml.safe_load(p.read_text())
            for p in EXAMPLES.glob("*.tool.yaml")}


def test_every_tuner_entry_has_an_alias(tuner):
    assert {(b["tool"], b["param"]) for b in tuner.BOUNDS} == set(ALIASES)


@pytest.mark.parametrize("key", sorted(ALIASES), ids=lambda k: f"{k[0]}.{k[1]}")
def test_entry_agrees(tuner, catalog, key):
    entry = next(b for b in tuner.BOUNDS if (b["tool"], b["param"]) == key)
    tool, param = ALIASES[key]
    bounds = catalog[tool]["params"][param]["bounds"]

    assert (bounds["min"], bounds["max"]) == (entry["min"], entry["max"])
    if entry["type"] == "int":
        assert isinstance(bounds["min"], int) and isinstance(bounds["max"], int)
        assert bounds.get("step", 1) == 1
    assert bounds["evolvable"] is (entry["in_rebuild"] and entry["in_profiles"])

    expected = DIRECTION.get(entry["direction"]) or CONTEXT_RESOLVED[key]
    assert bounds["direction"] == expected


def test_gene_space_from_catalog_equals_hand_coded(tuner, catalog):
    from_catalog = set()
    for doc in catalog.values():
        for g in vb.evolvable_genes(doc):
            from_catalog.add((g["tool"], g["param"], g["min"], g["max"]))
    hand_coded = {(*ALIASES[(b["tool"], b["param"])], b["min"], b["max"])
                  for b in tuner.EVOLVABLE_BOUNDS}
    assert from_catalog == hand_coded


def test_rendering_matches_genome_schema_conventions(catalog):
    """value_template reproduces what pho3nix_tuner/genome_schema.py hands to Pho3nix."""
    nmap = catalog["nmap"]["params"]["timing"]["bounds"]
    gob = catalog["gobuster"]["params"]
    assert vb.render(nmap, 4) == "-T4"              # config_to_nmap_params: f"-T{timing_t}"
    assert vb.render(gob["timeout"]["bounds"], 10) == "10s"   # f"{timeout_sec}s"
    # genome_schema sends delay as f"{ms/1000:.1f}s" ("0.2s"); the catalog renders exact ms
    # ("250ms"). Both are valid Go durations for gobuster --delay.
    assert vb.render(gob["delay"]["bounds"], 250) == "250ms"
