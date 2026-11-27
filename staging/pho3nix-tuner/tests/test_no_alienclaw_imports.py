"""The staged package imports the engine only as ``alienclaw_ga``, never in-tree ``alienclaw``.

AST scan (covers lazy imports inside functions) plus a clean-interpreter import of
every module with only the staged src and the engine src on sys.path.
"""
from __future__ import annotations

import ast
import subprocess
import sys

import pytest

from conftest import ENGINE_SRC, SRC

MODULES = sorted(p for p in (SRC / "pho3nix_tuner").glob("*.py"))


@pytest.mark.parametrize("path", MODULES, ids=lambda p: p.name)
def test_no_in_tree_engine_imports(path) -> None:
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            root = node.module.split(".")[0]
            assert root != "alienclaw", f"{path.name}:{node.lineno} imports {node.module}"
        elif isinstance(node, ast.Import):
            for alias in node.names:
                assert alias.name.split(".")[0] != "alienclaw", f"{path.name}:{node.lineno}"


def test_no_sys_path_insert_of_repo_src() -> None:
    for path in MODULES:
        text = path.read_text(encoding="utf-8")
        assert '/ "src"' not in text, f"{path.name} still inserts <repo>/src"


def test_every_module_imports_in_a_clean_interpreter(tmp_path) -> None:
    names = [f"pho3nix_tuner.{p.stem}" for p in MODULES if p.stem != "__init__"]
    code = (
        "import sys, importlib\n"
        f"sys.path[:0] = [{str(SRC)!r}, {str(ENGINE_SRC)!r}]\n"
        f"for n in {names!r}: importlib.import_module(n)\n"
        "bad = sorted(m for m in sys.modules if m == 'alienclaw' or m.startswith('alienclaw.'))\n"
        "assert not bad, bad\n"
        "print('ok')\n"
    )
    proc = subprocess.run(
        [sys.executable, "-I", "-B", "-c", code], capture_output=True, text=True, timeout=60,
        env={"HOME": str(tmp_path), "ALIENCLAW_POPULATIONS_ROOT": str(tmp_path / "p")},
    )
    assert proc.returncode == 0 and proc.stdout.strip() == "ok", proc.stdout + proc.stderr
