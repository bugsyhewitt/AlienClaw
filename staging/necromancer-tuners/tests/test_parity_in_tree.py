"""Staged vs in-tree genome_schema parity (skips cleanly once the in-tree copy is gone).

With the AlienClaw worktree (W) on sys.path, and W/src for the in-tree
``alienclaw`` package, the in-tree ``mangle_tuner.genome_schema`` and
``ouija_tuner.genome_schema`` must decode every genome exactly like the staged
copies, and must encode configs to byte-identical genomes for the same RNG.

W defaults to three levels above this package (staging/necromancer-tuners ->
W); set NECROMANCER_TUNERS_INTREE_ROOT to point elsewhere. Bytecode writing is
off (conftest), so importing the in-tree modules writes nothing there.
"""

from __future__ import annotations

import importlib
import os
import random
from pathlib import Path

import pytest

from genome_helpers import load_winner
from necromancer_tuners.mangle import genome_schema as staged_mangle
from necromancer_tuners.ouija import genome_schema as staged_ouija

W = Path(os.environ.get("NECROMANCER_TUNERS_INTREE_ROOT",
                        Path(__file__).resolve().parents[3]))


def _load_in_tree(module: str):
    if not (W / module.replace(".", "/")).with_suffix(".py").is_file():
        pytest.skip(f"in-tree {module} not present under {W}")
    with pytest.MonkeyPatch.context() as mp:
        mp.syspath_prepend(str(W / "src"))
        mp.syspath_prepend(str(W))
        try:
            return importlib.import_module(module)
        except Exception as exc:  # noqa: BLE001 — any import failure means "not importable"
            pytest.skip(f"in-tree {module} not importable: {exc!r}")


@pytest.fixture(scope="module")
def intree_mangle():
    return _load_in_tree("mangle_tuner.genome_schema")


@pytest.fixture(scope="module")
def intree_ouija():
    return _load_in_tree("ouija_tuner.genome_schema")


def _genomes(random_fn, encode_fn, configs, winner_genome):
    out = [random_fn(random.Random(s)) for s in range(300)]
    out += [encode_fn(c, random.Random(s)) for s in range(10) for c in configs]
    out.append(winner_genome)
    return out


def test_in_tree_modules_are_the_in_tree_ones(intree_mangle, intree_ouija):
    assert Path(intree_mangle.__file__).resolve() == (W / "mangle_tuner/genome_schema.py")
    assert Path(intree_ouija.__file__).resolve() == (W / "ouija_tuner/genome_schema.py")
    assert intree_mangle.decode_xcode.__module__ == "alienclaw.genome.codec"
    assert staged_mangle.decode_xcode.__module__ == "alienclaw_ga.genome.codec"


def test_mangle_constants_match(intree_mangle):
    assert intree_mangle.MANGLE_ID_TAG == staged_mangle.MANGLE_ID_TAG
    assert intree_mangle.MANGLE_NAMESPACE == staged_mangle.MANGLE_NAMESPACE
    assert intree_mangle.DEFAULT_CONFIG == staged_mangle.DEFAULT_CONFIG
    assert intree_mangle.ADAPTIVE_DEFAULT_CONFIG == staged_mangle.ADAPTIVE_DEFAULT_CONFIG


def test_mangle_decode_parity(intree_mangle):
    winner = load_winner("mangle")["config"]["genome"]
    genomes = _genomes(
        staged_mangle.random_mangle_genome,
        staged_mangle.encode_mangle_config,
        [staged_mangle.DEFAULT_CONFIG, staged_mangle.ADAPTIVE_DEFAULT_CONFIG],
        winner,
    )
    for g in genomes:
        assert staged_mangle.decode_mangle_config(g) == intree_mangle.decode_mangle_config(g)


def test_mangle_encode_and_seed_parity(intree_mangle):
    winner_cfg = load_winner("mangle")["config"]["config"]
    for s in range(25):
        assert staged_mangle.random_mangle_genome(random.Random(s)) == (
            intree_mangle.random_mangle_genome(random.Random(s))
        )
        for cfg in (staged_mangle.DEFAULT_CONFIG, staged_mangle.ADAPTIVE_DEFAULT_CONFIG,
                    winner_cfg):
            assert staged_mangle.encode_mangle_config(cfg, random.Random(s)) == (
                intree_mangle.encode_mangle_config(cfg, random.Random(s))
            )


def test_ouija_constants_match(intree_ouija):
    assert intree_ouija.OUIJA_ID_TAG == staged_ouija.OUIJA_ID_TAG
    assert intree_ouija.OUIJA_NAMESPACE == staged_ouija.OUIJA_NAMESPACE
    assert intree_ouija.CARRIERS == staged_ouija.CARRIERS
    assert intree_ouija.FRAMINGS == staged_ouija.FRAMINGS
    assert intree_ouija.DEFAULT_CONFIG == staged_ouija.DEFAULT_CONFIG
    assert intree_ouija.PLAIN_BASELINE_CONFIG == staged_ouija.PLAIN_BASELINE_CONFIG


def test_ouija_decode_parity(intree_ouija):
    winner = load_winner("ouija")["config"]["genome"]
    genomes = _genomes(
        staged_ouija.random_ouija_genome,
        staged_ouija.encode_ouija_config,
        [staged_ouija.DEFAULT_CONFIG, dict(staged_ouija.DEFAULT_CONFIG, carrier="b64")],
        winner,
    )
    for g in genomes:
        assert staged_ouija.decode_ouija_config(g) == intree_ouija.decode_ouija_config(g)


def test_ouija_encode_and_seed_parity(intree_ouija):
    winner_cfg = load_winner("ouija")["config"]["config"]
    for s in range(25):
        assert staged_ouija.random_ouija_genome(random.Random(s)) == (
            intree_ouija.random_ouija_genome(random.Random(s))
        )
        for cfg in (staged_ouija.DEFAULT_CONFIG, winner_cfg):
            assert staged_ouija.encode_ouija_config(cfg, random.Random(s)) == (
                intree_ouija.encode_ouija_config(cfg, random.Random(s))
            )
