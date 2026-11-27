"""Parity between this staged copy and the in-tree pho3nix_tuner it was lifted from.

Both packages are named ``pho3nix_tuner``, so the in-tree side runs in a separate
isolated interpreter (``python -I``) with only ``<repo>`` on sys.path (its own
sys.path insert then adds ``<repo>/src`` for the in-tree ``alienclaw`` engine).
It answers for the same synthetic inputs; this side compares:

  * genome_schema: decode of the same genomes, and encode of the same
    (config, seed) pairs, must be byte-identical (this also pins the staged
    alienclaw_ga engine to the in-tree one for every call the schema makes);
  * inspect_history: the full report for every synthetic history must be equal.

One divergence is declared and asserted explicitly, not tolerated: the staged
RewardModel.from_file reads a {"history": [...]} dump (same loader as the gate);
the in-tree one reads it as empty.

The reference root is ``$PHO3NIX_TUNER_REFERENCE_ROOT`` or the repo this staging
folder sits in. Skips cleanly when the in-tree package is not importable.
"""
from __future__ import annotations

import json
import os
import random
import subprocess
import sys
from pathlib import Path

import pytest
from alienclaw_ga.genome.codec import XCODE_MAX, encode_xcode

from _synth import HISTORIES, sufficient, write
from pho3nix_tuner import genome_schema as gs
from pho3nix_tuner import inspect_history as ih
from pho3nix_tuner import reward_model as rm


def _reference_root() -> Path | None:
    env = os.environ.get("PHO3NIX_TUNER_REFERENCE_ROOT")
    if env:
        return Path(env)
    parents = Path(__file__).resolve().parents
    return parents[3] if len(parents) > 3 else None  # <repo>/staging/pho3nix-tuner/tests


_REF = _reference_root()
if _REF is None or not (_REF / "pho3nix_tuner" / "genome_schema.py").is_file():
    pytest.skip("in-tree pho3nix_tuner not found", allow_module_level=True)

_REF_SCRIPT = r"""
import json, random, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
try:
    from pho3nix_tuner import genome_schema as gs
    from pho3nix_tuner import inspect_history as ih
    from pho3nix_tuner import reward_model as rm
except Exception as exc:
    print(json.dumps({"import_error": repr(exc)}))
    sys.exit(3)
spec = json.loads(Path(sys.argv[2]).read_text())
print(json.dumps({
    "module_files": [gs.__file__, ih.__file__],
    "decode": [gs.decode_pho_config(g) for g in spec["genomes"]],
    "encode": [gs.encode_pho_config(c, random.Random(s)) for c, s in spec["encode"]],
    "inspect": {k: ih.inspect(Path(p)) for k, p in spec["histories"].items()},
    "envelope_support": rm.RewardModel.from_file(Path(spec["envelope"])).context_support(
        "gobuster|https"),
}))
"""


def _genomes() -> list[str]:
    out = [gs.random_pho_genome(random.Random(seed)) for seed in range(64)]
    for value in (0, 1, 1921, XCODE_MAX - 1, XCODE_MAX):
        chars = list(out[0])
        for x in range(4):
            base = 64 + 1 + x * 2
            chars[base : base + 2] = encode_xcode(value)
        out.append("".join(chars))
    return out


_ENCODE = [
    (cfg, seed)
    for cfg in (gs.DEFAULT_CONFIG, gs.STEALTH_CONFIG, gs.AGGRESSIVE_CONFIG,
                {"threads": 999, "delay_ms": -5, "timeout_sec": 17, "timing_t": 3})
    for seed in (0, 1, 42)
]


@pytest.fixture(scope="module")
def parity(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("parity")
    histories = {name: str(write(tmp / f"{name}.json", fn())) for name, fn in HISTORIES.items()}
    envelope = write(tmp / "envelope.json", {"history": sufficient(24)})
    spec = {"genomes": _genomes(), "encode": _ENCODE, "histories": histories,
            "envelope": str(envelope)}
    spec_path = tmp / "spec.json"
    spec_path.write_text(json.dumps(spec))
    env = {"HOME": str(tmp / "home"), "PATH": os.environ.get("PATH", "")}
    # -B: never write __pycache__ into the in-tree package (-I ignores PYTHON* env vars,
    # so PYTHONDONTWRITEBYTECODE would not work here).
    proc = subprocess.run(
        [sys.executable, "-I", "-B", "-c", _REF_SCRIPT, str(_REF), str(spec_path)],
        capture_output=True, text=True, env=env, timeout=120,
    )
    if proc.returncode == 3:
        pytest.skip(f"in-tree pho3nix_tuner not importable: {proc.stdout.strip()}")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    return spec, json.loads(proc.stdout)


def test_reference_side_really_is_in_tree(parity) -> None:
    _, ref = parity
    for f in ref["module_files"]:
        assert Path(f).resolve().parent == (_REF / "pho3nix_tuner").resolve()
    assert Path(gs.__file__).resolve().parent != (_REF / "pho3nix_tuner").resolve()


def test_decode_parity(parity) -> None:
    spec, ref = parity
    assert [gs.decode_pho_config(g) for g in spec["genomes"]] == ref["decode"]


def test_encode_parity(parity) -> None:
    spec, ref = parity
    staged = [gs.encode_pho_config(c, random.Random(s)) for c, s in spec["encode"]]
    assert staged == ref["encode"]


@pytest.mark.parametrize("name", sorted(HISTORIES))
def test_inspect_parity(parity, name) -> None:
    spec, ref = parity
    staged = ih.inspect(Path(spec["histories"][name]))
    assert staged == ref["inspect"][name]
    assert staged["stop_gate"] is ref["inspect"][name]["stop_gate"]


def test_declared_divergence_history_envelope(parity) -> None:
    spec, ref = parity
    assert ref["envelope_support"] == 0  # in-tree: {"history": [...]} reads as empty
    staged = rm.RewardModel.from_file(Path(spec["envelope"])).context_support("gobuster|https")
    assert staged == 24
    # ... while both gates accept that same file.
    assert ih.inspect(Path(spec["envelope"]))["stop_gate"] is False
