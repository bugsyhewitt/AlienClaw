"""PKT-629: Python-side argparse second-defense contract tests.

TS parseCliArgs intentionally passes 1e100 through (Number.isInteger(1e100) === true).
Python argparse is the documented second line of defense for out-of-range but
integer-valued inputs like 1e100.

These tests document and assert that boundary contract — not the full CLI
integration, just the argparse layer behavior that the TS layer relies on.
"""

import argparse
import pytest


def _make_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="alienclaw-evolve-test")
    p.add_argument("--generations", type=int)
    p.add_argument("--population-size", type=int)
    p.add_argument("--seed", type=int)
    return p


def test_pkt629_argparse_accepts_valid_integer():
    p = _make_parser()
    ns = p.parse_args(["--generations", "10", "--population-size", "32"])
    assert ns.generations == 10
    assert ns.population_size == 32


def test_pkt629_argparse_rejects_float_string():
    """PKT-629: argparse type=int rejects '1.5' with SystemExit(2)."""
    p = _make_parser()
    with pytest.raises(SystemExit) as exc_info:
        p.parse_args(["--generations", "1.5"])
    assert exc_info.value.code == 2


def test_pkt629_python_argparse_rejects_1e100():
    """PKT-629: TS parseCliArgs intentionally passes 1e100; Python argparse is second defense.
    Documents that argparse type=int rejects '1e+100' with SystemExit(2)."""
    p = _make_parser()
    with pytest.raises(SystemExit) as exc_info:
        p.parse_args(["--generations", "1e+100"])
    assert exc_info.value.code == 2
