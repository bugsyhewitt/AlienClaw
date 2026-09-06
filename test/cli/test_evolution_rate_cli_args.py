"""PKT-1036: Python-side argparse accepts mutation/crossover/elitism rate levers.

Tests A-001, A-002, A-003.
RED on origin/main: --mutation-rate is unrecognized → exit 2 (argparse error).
GREEN after fix: --mutation-rate 0.02 accepted → exit 1 (bridge import error, not argparse).
"""
import os
import pathlib
import subprocess
import sys

_SRC = str(pathlib.Path(__file__).parent.parent.parent / "src")


def _run_experiment(*extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            sys.executable, "-m", "alienclaw.evolution", "run-experiment",
            "--martian-type", "compute_alone", "--generations", "1",
            *extra,
        ],
        capture_output=True,
        env={**os.environ, "PYTHONPATH": _SRC},
    )


def test_a001_mutation_rate_accepted():
    """A-001: --mutation-rate 0.02 recognized (exit != 2)."""
    r = _run_experiment("--mutation-rate", "0.02")
    assert r.returncode != 2, (
        f"argparse rejected --mutation-rate (exit 2): {r.stderr.decode()}"
    )


def test_a002_crossover_rate_and_elitism_accepted():
    """A-002: --crossover-rate 0.75 --elitism 4 recognized (exit != 2)."""
    r = _run_experiment("--crossover-rate", "0.75", "--elitism", "4")
    assert r.returncode != 2, (
        f"argparse rejected --crossover-rate/--elitism (exit 2): {r.stderr.decode()}"
    )


def test_a003_elitism_non_integer_rejected():
    """A-003: --elitism with non-integer value rejected with exit 2."""
    r = _run_experiment("--elitism", "bogus")
    assert r.returncode == 2, (
        f"argparse accepted non-integer --elitism (exit {r.returncode})"
    )
