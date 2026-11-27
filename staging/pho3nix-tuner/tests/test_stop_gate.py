"""STOP gate: `run_ga.py --dry-run` exits 1 on insufficient history, 0 (GO) on sufficient.

Runs the real script as a subprocess with --history pointed into tmp_path, cwd in
tmp_path, HOME and ALIENCLAW_POPULATIONS_ROOT in tmp_path.
"""
from __future__ import annotations

import subprocess
import sys

import pytest

from _synth import EXPECTED_FAILS, HISTORIES, write
from conftest import SRC

RUN_GA = SRC / "pho3nix_tuner" / "run_ga.py"
INSUFFICIENT = sorted(n for n, fails in EXPECTED_FAILS.items() if fails)


def _run(args: list[str], *, cwd, env, module: bool = False) -> subprocess.CompletedProcess:
    head = ["-m", "pho3nix_tuner.run_ga"] if module else [str(RUN_GA)]
    return subprocess.run(
        [sys.executable, *head, *args],
        capture_output=True, text=True, cwd=cwd, env=env, timeout=120,
    )


def _tree(root) -> set[str]:
    return {str(p.relative_to(root)) for p in root.rglob("*")}


@pytest.mark.parametrize("name", INSUFFICIENT)
def test_dry_run_stops_with_exit_1_on_insufficient_history(tmp_path, sub_env, name) -> None:
    hist = write(tmp_path / f"{name}.json", HISTORIES[name]())
    out = _run(["--dry-run", "--history", str(hist)], cwd=tmp_path, env=sub_env)
    assert out.returncode == 1, out.stdout + out.stderr
    assert "STOP ✗" in out.stdout
    for prefix in EXPECTED_FAILS[name]:
        assert f"✗ {prefix}" in out.stdout
    assert "GO ✓" not in out.stdout


def test_dry_run_goes_with_exit_0_on_sufficient_history(tmp_path, sub_env) -> None:
    hist = write(tmp_path / "sufficient.json", HISTORIES["sufficient"]())
    before = _tree(tmp_path)
    out = _run(["--dry-run", "--history", str(hist)], cwd=tmp_path, env=sub_env)
    assert out.returncode == 0, out.stdout + out.stderr
    assert "GO ✓ — proceeding to GA" in out.stdout
    assert "--dry-run set: stopping after pre-flight (no GA run)." in out.stdout
    assert "Step 2" not in out.stdout
    # Dry run writes nothing: no results/ dir in cwd, no population store.
    assert _tree(tmp_path) == before


def test_dry_run_as_module_has_same_verdicts(tmp_path, sub_env) -> None:
    bad = write(tmp_path / "bad.json", HISTORIES["single_signature"]())
    good = write(tmp_path / "good.json", HISTORIES["sufficient"]())
    assert _run(["--dry-run", "--history", str(bad)], cwd=tmp_path, env=sub_env,
                module=True).returncode == 1
    assert _run(["--dry-run", "--history", str(good)], cwd=tmp_path, env=sub_env,
                module=True).returncode == 0


def test_dry_run_missing_history_exits_1(tmp_path, sub_env) -> None:
    out = _run(["--dry-run", "--history", str(tmp_path / "absent.json")],
               cwd=tmp_path, env=sub_env)
    assert out.returncode == 1
    assert "history file not found" in out.stdout


def test_dry_run_default_history_resolves_under_home(tmp_path, sub_env) -> None:
    out = _run(["--dry-run"], cwd=tmp_path, env=sub_env)
    assert out.returncode == 1
    assert f"{sub_env['HOME']}/.pho3nix_data/history/run_history.json" in out.stdout


def test_dry_run_gate_is_independent_of_tool_choice(tmp_path, sub_env) -> None:
    """The gate looks at all target tools; --tool nmap on gobuster-only data still GOes."""
    hist = write(tmp_path / "sufficient.json", HISTORIES["sufficient"]())
    out = _run(["--dry-run", "--tool", "nmap", "--history", str(hist)],
               cwd=tmp_path, env=sub_env)
    assert out.returncode == 0
