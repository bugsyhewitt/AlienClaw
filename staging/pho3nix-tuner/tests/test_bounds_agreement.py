"""Gene bounds in genome_schema.py agree with the bounds table in tooltime_bounds.py."""
from __future__ import annotations

import json
import subprocess
import sys

import pytest

from conftest import SRC
from pho3nix_tuner import genome_schema as gs
from pho3nix_tuner import tooltime_bounds as tb

# (tool, param) in the bounds table -> the genome_schema constants for that gene
GENE_CONSTANTS = {
    ("gobuster", "threads"): (gs._THREADS_MIN, gs._THREADS_MAX),
    ("gobuster", "delay_ms"): (gs._DELAY_MS_MIN, gs._DELAY_MS_MAX),
    ("gobuster", "timeout_sec"): (gs._TIMEOUT_SEC_MIN, gs._TIMEOUT_SEC_MAX),
    ("nmap", "timing_t"): (gs._TIMING_T_MIN, gs._TIMING_T_MAX),
}


def test_evolvable_set_is_exactly_the_genome_genes() -> None:
    evolvable = {(b["tool"], b["param"]) for b in tb.EVOLVABLE_BOUNDS}
    assert evolvable == set(GENE_CONSTANTS)
    assert len(tb.EVOLVABLE_BOUNDS) == 4


@pytest.mark.parametrize("bound", tb.EVOLVABLE_BOUNDS, ids=lambda b: f"{b['tool']}.{b['param']}")
def test_min_max_match_genome_constants(bound: dict) -> None:
    lo, hi = GENE_CONSTANTS[(bound["tool"], bound["param"])]
    assert (bound["min"], bound["max"]) == (lo, hi)
    assert bound["type"] == "int"
    assert bound["in_rebuild"] and bound["in_profiles"]


def test_genome_genes_use_the_table_param_names() -> None:
    assert {param for _, param in GENE_CONSTANTS} == set(gs.DEFAULT_CONFIG)


def test_documented_only_params_are_not_evolvable() -> None:
    doc_only = [b for b in tb.BOUNDS if not b["in_rebuild"]]
    assert {b["tool"] for b in doc_only} == {"sqlmap"}
    assert {b["param"] for b in doc_only} == {"level", "risk", "threads", "delay"}
    assert len(tb.BOUNDS) == 8


def test_every_bound_is_well_formed() -> None:
    for b in tb.BOUNDS:
        assert b["min"] < b["max"]
        assert b["direction"] in {"maximize", "minimize", "context"}


def test_baseline_profile_notes_match_configs() -> None:
    """The profile values quoted in the bounds notes are the genome baselines."""
    by_param = {(b["tool"], b["param"]): b for b in tb.BOUNDS}
    assert "stealth=5, normal=20, aggressive=50" in by_param[("gobuster", "threads")]["note"]
    assert (gs.STEALTH_CONFIG["threads"], gs.DEFAULT_CONFIG["threads"],
            gs.AGGRESSIVE_CONFIG["threads"]) == (5, 20, 50)
    assert "stealth=30s, normal=10s, aggressive=5s" in by_param[
        ("gobuster", "timeout_sec")]["note"]
    assert (gs.STEALTH_CONFIG["timeout_sec"], gs.DEFAULT_CONFIG["timeout_sec"],
            gs.AGGRESSIVE_CONFIG["timeout_sec"]) == (30, 10, 5)
    assert "stealth=-T2, normal=-T4, aggressive=-T5" in by_param[("nmap", "timing_t")]["note"]
    assert (gs.STEALTH_CONFIG["timing_t"], gs.DEFAULT_CONFIG["timing_t"],
            gs.AGGRESSIVE_CONFIG["timing_t"]) == (2, 4, 5)


def _cli(*args: str, env: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SRC / "pho3nix_tuner" / "tooltime_bounds.py"), *args],
        capture_output=True, text=True, env=env, timeout=60,
    )


def test_cli_json_outputs_evolvable_then_all(sub_env) -> None:
    out = _cli("--json", env=sub_env)
    assert out.returncode == 0
    assert json.loads(out.stdout) == tb.EVOLVABLE_BOUNDS
    out_all = _cli("--json", "--all", env=sub_env)
    assert out_all.returncode == 0
    assert json.loads(out_all.stdout) == tb.BOUNDS


def test_write_to_tooltime_updates_and_appends(tmp_path, capsys) -> None:
    yaml = pytest.importorskip("yaml")
    tools = tmp_path / "tools"
    (tools / "gobuster").mkdir(parents=True)
    (tools / "gobuster" / "tool.yaml").write_text(
        yaml.safe_dump({"name": "gobuster", "params": [{"name": "threads", "type": "int"}]})
    )
    tb._write_to_tooltime(tools, tb.EVOLVABLE_BOUNDS)
    doc = yaml.safe_load((tools / "gobuster" / "tool.yaml").read_text())
    params = {p["name"]: p for p in doc["params"]}
    assert params["threads"]["min"] == 5 and params["threads"]["max"] == 50
    assert params["delay_ms"]["max"] == 1000 and params["delay_ms"]["unit"] == "ms"
    assert params["timeout_sec"]["direction"] == "context"
    out = capsys.readouterr().out
    assert "SKIP nmap/timing_t" in out  # no nmap/tool.yaml in the tmp catalog
    assert "Wrote 3 param bounds" in out
