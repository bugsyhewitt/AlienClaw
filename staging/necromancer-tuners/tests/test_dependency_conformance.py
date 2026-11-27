"""The fakes (tuner_fakes.py) and adapters vs the real necromancer sources.

Read-only AST checks: nothing in necromancer is imported or executed. They pin
the exact surface the adapters rely on, so a change in mangle / ouija that
would silently break a tuner shows up here. Skipped when necromancer is not
checked out at NECROMANCER_ROOT (default ~/dev/necromancer).
"""

from __future__ import annotations

import ast
import os
from pathlib import Path

import pytest

import tuner_fakes
from necromancer_tuners.ouija import genome_schema as ouija_gs

# Resolved at collection time, before conftest points HOME at tmp_path.
ROOT = Path(os.environ.get("NECROMANCER_ROOT", Path.home() / "dev" / "necromancer"))
MANGLE = ROOT / "projects" / "mangle" / "src" / "mangle"
OUIJA = ROOT / "projects" / "ouija" / "ouija"

pytestmark = pytest.mark.skipif(
    not (MANGLE.is_dir() and OUIJA.is_dir()), reason=f"necromancer not found at {ROOT}"
)


def _tree(path: Path) -> ast.Module:
    return ast.parse(path.read_text(), filename=str(path))


def _top(tree: ast.Module, name: str):
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if node.name == name:
                return node
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if any(isinstance(t, ast.Name) and t.id == name for t in targets):
                return node
    raise AssertionError(f"{name} not found")


def _method(cls: ast.ClassDef, name: str):
    for node in cls.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node
    raise AssertionError(f"{cls.name}.{name} not found")


def _params(fn) -> tuple[list[str], list[str]]:
    a = fn.args
    return [x.arg for x in a.posonlyargs + a.args], [x.arg for x in a.kwonlyargs]


def _fields(cls: ast.ClassDef) -> list[str]:
    return [n.target.id for n in cls.body if isinstance(n, ast.AnnAssign)]


# ---------------------------------------------------------------------------
# mangle
# ---------------------------------------------------------------------------

def test_engine_binds_make_scheduler_as_a_module_global():
    # fitness_adapter monkey-patches mangle.engine.make_scheduler; that only
    # reaches fuzz_async if engine imports the name and calls it unqualified.
    tree = _tree(MANGLE / "engine.py")
    assert any(
        isinstance(n, ast.ImportFrom) and n.level == 1 and n.module == "scheduler"
        and any(a.name == "make_scheduler" and a.asname is None for a in n.names)
        for n in tree.body
    )
    calls = [n for n in ast.walk(_top(tree, "fuzz_async")) if isinstance(n, ast.Call)]
    assert any(isinstance(c.func, ast.Name) and c.func.id == "make_scheduler" for c in calls)


def test_fuzz_file_accepts_every_keyword_the_adapter_passes():
    pos, kw = _params(_top(_tree(MANGLE / "engine.py"), "fuzz_file"))
    passed = {"seed_path", "output_dir", "iterations", "decoder", "timeout", "seed_rng",
              "concurrency", "strategy", "scheduler_state", "crash_dedup"}
    assert passed <= set(pos + kw)


def test_scheduler_surface():
    tree = _tree(MANGLE / "scheduler.py")
    adaptive = _top(tree, "AdaptiveScheduler")
    assert _fields(adaptive)[:4] == ["mutators", "alpha", "beta", "exploration_floor"]
    assert _params(_method(_top(tree, "UniformScheduler"), "__init__"))[0] == [
        "self", "mutators"
    ]
    assert _params(_top(tree, "make_scheduler"))[0] == ["strategy", "mutators"]


def test_coverage_surface_and_reward_outcomes():
    tree = _tree(MANGLE / "coverage.py")
    assert "crash_aborts" in _fields(_top(tree, "MutatorCoverage"))
    report_fields = _fields(_top(tree, "CoverageReport"))
    assert {"total_iterations", "mutators"} <= set(report_fields)
    assert _params(_top(tree, "coverage_report"))[0][0] == "output_dir"
    reward = _top(tree, "_REWARD_OUTCOMES")
    assert set(ast.literal_eval(reward.value.args[0])) == set(tuner_fakes.REWARD_OUTCOMES)


# ---------------------------------------------------------------------------
# ouija
# ---------------------------------------------------------------------------

def test_carrier_order_matches_the_genome_schema():
    tree = _tree(OUIJA / "encoders.py")
    order = ast.literal_eval(_top(tree, "CARRIER_ORDER").value)
    assert tuple(order) == ouija_gs.CARRIERS == tuner_fakes.CARRIER_ORDER
    keys = [ast.literal_eval(k) for k in _top(tree, "CARRIERS").value.keys]
    assert tuple(keys) == ouija_gs.CARRIERS


def test_oracle_surface():
    oracle = _top(_tree(OUIJA / "oracle.py"), "Oracle")
    assert _params(_method(oracle, "__init__"))[0] == ["self", "oob"]
    assert _params(_method(oracle, "judge_text_marker"))[0] == [
        "self", "turn", "marker", "effect"
    ]


def test_measure_surface():
    fn = _top(_tree(OUIJA / "findings.py"), "measure")
    assert isinstance(fn, ast.AsyncFunctionDef)
    pos, kw = _params(fn)
    assert pos == ["probe_fn"] and "repeats" in kw
    keys = {
        k.value for n in ast.walk(fn) if isinstance(n, ast.Dict)
        for k in n.keys if isinstance(k, ast.Constant)
    }
    assert "asr" in keys


def test_raw_llm_surface():
    cls = _top(_tree(OUIJA / "targets" / "raw_llm.py"), "RawLLM")
    pos, kw = _params(_method(cls, "__init__"))
    assert pos == ["self", "url"]
    assert {"request_template", "response_path", "timeout"} <= set(kw)
    send = _method(cls, "send")
    assert isinstance(send, ast.AsyncFunctionDef)
    assert _params(send)[0] == ["self", "payload"]
    _method(_top(_tree(OUIJA / "targets" / "base.py"), "Turn"), "received_text")
