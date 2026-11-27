"""mangle run_ga CLI: --help, argument errors, and a tiny fully-mocked GA run."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
from alienclaw_ga.genome.codec import round_trip_check

from necromancer_tuners.mangle import fitness_adapter as fa
from necromancer_tuners.mangle import genome_schema as gs
from necromancer_tuners.mangle import run_ga
from tuner_fakes import write_results_jsonl


def _crash_rate_for(cfg: dict) -> float:
    """Deterministic stand-in landscape: adaptive + high alpha crashes more."""
    if cfg["strategy"] != "adaptive":
        return 0.0
    return min(1.0, cfg["alpha"] / 5.0)


def _landscape_fuzz(calls: list[dict]):
    def fake_fuzz_file(**kwargs):
        calls.append(kwargs)
        n = kwargs["iterations"]
        # recover the config the adapter is evaluating from its fuzz_file kwargs
        # plus the injected scheduler (alpha lives only there)
        sched = fa._mangle_engine.make_scheduler(kwargs["strategy"], ["m1", "m2"])
        cfg = {"strategy": kwargs["strategy"], "alpha": getattr(sched, "alpha", 1.0)}
        crashes = round(_crash_rate_for(cfg) * n)
        write_results_jsonl(
            kwargs["output_dir"], [("m1", "crash")] * crashes + [("m1", "clean")] * (n - crashes)
        )
        return []
    return fake_fuzz_file


def test_help_exits_zero_and_creates_no_temp_dirs(monkeypatch, capsys, scratch_dir):
    monkeypatch.delenv("ALIENCLAW_POPULATIONS_ROOT")
    monkeypatch.setattr(sys, "argv", ["mangle-tuner", "--help"])
    with pytest.raises(SystemExit) as exc:
        run_ga.main()
    assert exc.value.code == 0
    out = capsys.readouterr().out
    for flag in ("--seed-file", "--held-out-seed", "--pop-size", "--generations",
                 "--eval-iterations", "--eval-seed-rng", "--held-out-eval-rng",
                 "--ga-rng-seed", "--output"):
        assert flag in out
    # staged fix: the population root is resolved in main(), after arg parsing
    assert list(scratch_dir.iterdir()) == []
    assert "ALIENCLAW_POPULATIONS_ROOT" not in os.environ


def test_required_arguments_are_enforced(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["mangle-tuner"])
    with pytest.raises(SystemExit) as exc:
        run_ga.main()
    assert exc.value.code == 2
    assert "--seed-file" in capsys.readouterr().err


def test_missing_seed_file_returns_1_without_fuzzing(monkeypatch, tmp_path, capsys):
    calls: list[dict] = []
    monkeypatch.setattr(fa, "fuzz_file", _landscape_fuzz(calls))
    held = tmp_path / "held.h265"
    held.write_bytes(b"\x00")
    monkeypatch.setattr(sys, "argv", [
        "mangle-tuner", "--seed-file", str(tmp_path / "missing.h265"),
        "--held-out-seed", str(held),
    ])
    assert run_ga.main() == 1
    assert "seed-file not found" in capsys.readouterr().err
    assert calls == []


def test_tiny_mocked_ga_run_writes_artifacts_only_under_tmp(monkeypatch, tmp_path, scratch_dir):
    train = tmp_path / "train.h265"
    held = tmp_path / "held.h265"
    train.write_bytes(b"\x00\x00\x01")
    held.write_bytes(b"\x00\x00\x02")
    out = tmp_path / "out" / "nested" / "winner.genome.txt"  # parent does not exist yet
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    monkeypatch.chdir(cwd)

    calls: list[dict] = []
    monkeypatch.setattr(fa, "fuzz_file", _landscape_fuzz(calls))
    pop_size, gens, iters = 4, 2, 20
    monkeypatch.setattr(sys, "argv", [
        "mangle-tuner", "--seed-file", str(train), "--held-out-seed", str(held),
        "--pop-size", str(pop_size), "--generations", str(gens),
        "--eval-iterations", str(iters), "--output", str(out),
    ])

    rc = run_ga.main()

    # 2 training baselines + pop_size * generations GA evals + 3 held-out evals
    assert len(calls) == 2 + pop_size * gens + 3
    assert all(c["iterations"] == iters for c in calls)
    assert [c["seed_rng"] for c in calls[:2]] == [0, 0]
    assert [c["seed_rng"] for c in calls[-3:]] == [7, 7, 7]  # eval-seed-rng + 7
    assert [Path(c["seed_path"]) for c in calls[-3:]] == [held] * 3
    # every campaign dir lived in the per-test scratch dir and was cleaned up
    assert all(Path(c["output_dir"]).parent == scratch_dir for c in calls)
    assert list(scratch_dir.iterdir()) == []
    assert list(cwd.iterdir()) == []

    genome = out.read_text().strip()
    cfg_json = json.loads(out.with_suffix(".config.json").read_text())
    results = json.loads(out.with_suffix(".results.json").read_text())

    assert round_trip_check(genome)
    assert genome[:8] == "MGL00001"
    assert cfg_json["genome"] == genome == results["evolved"]["genome"]
    assert gs.decode_mangle_config(genome) == cfg_json["config"] == cfg_json["config_roundtrip"]
    assert results["pop_size"] == pop_size and results["generations"] == gens
    assert results["eval_iterations"] == iters

    b = results["baselines"]
    assert b["uniform_training"] == 0.0
    assert b["adaptive_training"] == pytest.approx(0.2)
    ev = results["evolved"]["fitness_held_out"]
    assert ev == round(_crash_rate_for(cfg_json["config"]) * iters) / iters
    gate = ev > b["uniform_held_out"] and ev > b["adaptive_held_out"]
    assert results["gate_pass"] is gate
    assert rc == (0 if gate else 1)

    # the GA's population store went to the per-test ALIENCLAW_POPULATIONS_ROOT
    pops = tmp_path / "populations"
    assert pops.is_dir() and any(pops.rglob("*.json"))
