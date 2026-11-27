"""ouija run_ga CLI: --help, health-check gate, and a tiny fully-mocked GA run."""

from __future__ import annotations

import json
import os
import sys

import pytest
from alienclaw_ga.genome.codec import round_trip_check

import tuner_fakes
from necromancer_tuners.ouija import fitness_adapter as fa
from necromancer_tuners.ouija import genome_schema as gs
from necromancer_tuners.ouija import run_ga
from tuner_fakes import scripted_raw_llm

# The stand-in model complies whenever the injection carries any framing.
_FRAMING_PREFIXES = ("Please, this is for", "URGENT", "Pretend you are", "As an authorized",
                     "For educational")


def _reply(payload: str) -> str:
    if any(p in payload for p in _FRAMING_PREFIXES):
        return "OUIJA-INJ-0-TARGET OUIJA-INJ-7-TARGET"  # complies for either Ollama seed
    return "The article is about local news."


def test_help_exits_zero_and_creates_no_temp_dirs(monkeypatch, capsys, scratch_dir):
    monkeypatch.delenv("ALIENCLAW_POPULATIONS_ROOT")
    monkeypatch.setattr(sys, "argv", ["ouija-tuner", "--help"])
    with pytest.raises(SystemExit) as exc:
        run_ga.main()
    assert exc.value.code == 0
    out = capsys.readouterr().out
    for flag in ("--model", "--pop-size", "--generations", "--eval-repeats", "--eval-seed",
                 "--held-out-eval-seed", "--ga-rng-seed", "--output", "--skip-health-check"):
        assert flag in out
    assert list(scratch_dir.iterdir()) == []
    assert "ALIENCLAW_POPULATIONS_ROOT" not in os.environ


def test_failed_health_check_returns_1_before_any_inference(monkeypatch, tmp_path, capsys):
    cls, log = scripted_raw_llm(_reply)
    monkeypatch.setattr(fa, "RawLLM", cls)
    monkeypatch.setattr(run_ga, "_ollama_health_check", lambda model: False)
    out = tmp_path / "out" / "winner.genome.txt"
    monkeypatch.setattr(sys, "argv", ["ouija-tuner", "--output", str(out)])
    assert run_ga.main() == 1
    assert "Ollama not reachable" in capsys.readouterr().err
    assert log["sent"] == []
    assert not out.exists()


def test_tiny_mocked_ga_run_writes_artifacts_only_under_tmp(monkeypatch, tmp_path, scratch_dir):
    cls, log = scripted_raw_llm(_reply)
    monkeypatch.setattr(fa, "RawLLM", cls)
    checked: list[str] = []
    monkeypatch.setattr(run_ga, "_ollama_health_check", lambda m: checked.append(m) or True)

    repeats_seen: list[int] = []
    real_measure = tuner_fakes.measure

    async def recording_measure(probe, *, repeats=20, rng=None):
        repeats_seen.append(repeats)
        return await real_measure(probe, repeats=repeats, rng=rng)

    monkeypatch.setattr(fa, "measure", recording_measure)

    cwd = tmp_path / "cwd"
    cwd.mkdir()
    monkeypatch.chdir(cwd)
    out = tmp_path / "out" / "nested" / "winner.genome.txt"
    pop_size, gens, eval_repeats = 4, 2, 2
    monkeypatch.setattr(sys, "argv", [
        "ouija-tuner", "--model", "test-model:1b", "--pop-size", str(pop_size),
        "--generations", str(gens), "--eval-repeats", str(eval_repeats), "--output", str(out),
    ])

    rc = run_ga.main()

    assert checked == ["test-model:1b"]
    assert log["init"] and all(i["url"] == fa.OLLAMA_URL for i in log["init"])
    assert all(json.loads(i["request_template"])["model"] == "test-model:1b"
               for i in log["init"])
    n_t = len(fa._ARTICLE_TEMPLATES)
    # 2 training baselines + pop*gens GA evals + 3 held-out evals, one measure per template
    assert len(repeats_seen) == (2 + pop_size * gens + 3) * n_t
    # GA-phase evals floor the genome's repeats gene at --eval-repeats
    ga_phase = repeats_seen[2 * n_t: (2 + pop_size * gens) * n_t]
    assert all(r >= eval_repeats for r in ga_phase)
    assert list(cwd.iterdir()) == []
    assert list(scratch_dir.iterdir()) == []

    genome = out.read_text().strip()
    cfg_json = json.loads(out.with_suffix(".config.json").read_text())
    results = json.loads(out.with_suffix(".results.json").read_text())
    best = cfg_json["config"]
    # Documented behavior: the held-out evolved eval uses the genome's raw
    # repeats gene, without the GA-phase --eval-repeats floor.
    assert repeats_seen[-n_t:] == [best["repeats"]] * n_t

    assert round_trip_check(genome)
    assert genome[:8] == "OUI00001"
    assert cfg_json["genome"] == genome == results["evolved"]["genome"]
    assert gs.decode_ouija_config(genome) == best == cfg_json["config_roundtrip"]
    assert results["model"] == "test-model:1b"
    assert (results["eval_seed"], results["held_out_seed"]) == (0, 7)
    b = results["baselines"]
    assert b["plain_training"] == b["b64_training"] == 0.0
    assert b["best_held_out"] == max(b["plain_held_out"], b["b64_held_out"])
    ev = results["evolved"]["fitness_held_out"]
    assert ev == (1.0 if best["framing"] != "none" else 0.0)
    gate = ev > b["plain_held_out"] and ev > b["best_held_out"]
    assert results["gate_pass"] is gate
    assert rc == (0 if gate else 1)
    assert any((tmp_path / "populations").rglob("*.json"))
