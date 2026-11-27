"""Package-level guards: no in-tree alienclaw imports, fakes in place, entry points."""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

import pytest

import necromancer_tuners
import tuner_fakes

PKG = Path(__file__).resolve().parents[1]
SRC = PKG / "src" / "necromancer_tuners"


def _py_files():
    return sorted(SRC.rglob("*.py"))


def test_no_module_imports_the_in_tree_alienclaw_package():
    offenders = []
    for path in _py_files():
        for node in ast.walk(ast.parse(path.read_text())):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names = [node.module]
            for n in names:
                if n == "alienclaw" or n.startswith("alienclaw."):
                    offenders.append(f"{path.relative_to(PKG)}: {n}")
    assert offenders == []


def test_no_module_puts_the_alienclaw_src_dir_on_sys_path():
    # in-tree: _AC_SRC = Path(__file__).parent.parent / "src"
    pattern = re.compile(r"_AC_SRC|__file__\)\.parent\.parent / \"src\"")
    for path in _py_files():
        assert not pattern.search(path.read_text()), path


def test_no_banned_identifier():
    banned = re.compile(r"\bSpecialist\b")
    for path in list(_py_files()) + sorted((PKG / "tests").glob("*.py")):
        assert not banned.search(path.read_text()), path


def test_tests_run_against_the_fakes():
    for name in ("mangle", "mangle.engine", "ouija", "ouija.targets.raw_llm"):
        assert getattr(sys.modules[name], tuner_fakes.FAKE_MARKER, False), name


def test_console_scripts_point_at_real_mains():
    tomllib = pytest.importorskip("tomllib")  # stdlib from 3.11
    meta = tomllib.loads((PKG / "pyproject.toml").read_text())
    assert meta["project"]["name"] == "necromancer-tuners"
    assert meta["project"]["version"] == necromancer_tuners.__version__ == "0.0.0.dev0"
    assert "alienclaw-ga" in meta["project"]["dependencies"]
    from necromancer_tuners.mangle import run_ga as mangle_run
    from necromancer_tuners.ouija import run_ga as ouija_run

    scripts = meta["project"]["scripts"]
    assert scripts == {
        "mangle-tuner": "necromancer_tuners.mangle.run_ga:main",
        "ouija-tuner": "necromancer_tuners.ouija.run_ga:main",
    }
    assert callable(mangle_run.main) and callable(ouija_run.main)
