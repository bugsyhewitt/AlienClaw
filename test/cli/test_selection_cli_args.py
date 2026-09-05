"""PKT-1032: Python-side argparse accepts selection-strategy levers.

Tests A-001, A-002, A-003.
RED on origin/main: --selection is unrecognized → exit 2 (argparse error).
GREEN after fix: --selection truncation accepted → exit 1 (bridge import error, not argparse).
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


def test_a001_selection_truncation_accepted():
    """A-001: --selection truncation --top-fraction 0.25 recognized (exit != 2)."""
    r = _run_experiment("--selection", "truncation", "--top-fraction", "0.25")
    assert r.returncode != 2, (
        f"argparse rejected --selection (exit 2): {r.stderr.decode()}"
    )


def test_a002_selection_tournament_k_accepted():
    """A-002: --selection tournament --tournament-k 5 recognized (exit != 2)."""
    r = _run_experiment("--selection", "tournament", "--tournament-k", "5")
    assert r.returncode != 2, (
        f"argparse rejected --tournament-k (exit 2): {r.stderr.decode()}"
    )


def test_a003_invalid_selection_rejected():
    """A-003: invalid --selection value rejected with exit 2."""
    r = _run_experiment("--selection", "bogus_strategy")
    assert r.returncode == 2, (
        f"argparse accepted invalid --selection (exit {r.returncode})"
    )
