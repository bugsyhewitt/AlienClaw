"""Guard: the staged package never reaches back into the retired AlienClaw product.

Static half: AST-scan every module under src/alienclaw_ga (module-level, lazy
in-function and TYPE_CHECKING imports alike, relative imports resolved) and fail
on any ``alienclaw`` / ``alienclaw.*`` import, any import path containing a DROP
package or an excluded module, any importlib/__import__ call naming one, and any
DROP identifier used in code or in a string annotation.

Runtime half: import every module in a fresh interpreter whose sys.path holds
only the staged src/ (no in-tree alienclaw) and assert no ``alienclaw`` module
was loaded.
"""
from __future__ import annotations

import ast
import json
import os
import site
import subprocess
import sys
from pathlib import Path

import pytest

PKG = "alienclaw_ga"
SRC = Path(__file__).resolve().parents[1] / "src"
PKG_DIR = SRC / PKG

DROP_PACKAGES = frozenset({
    "bridge", "brains", "martians", "governance", "agents", "comms", "cli", "wiring",
    "msb", "registry", "config", "api",
})
# In-tree modules deliberately left out of the staged package (see README).
EXCLUDED_MODULES = frozenset({
    "bridge_runner", "live_evo", "__main__", "experiment", "governance_gate",
    "online_fitness", "migrations", "migrate_pre_packet_16",
    "composition_decoder_audit", "synthetic_compositions", "sensitivity_audit", "reporting",
    "fitness_formula_candidates", "scaling_experiment", "fitness_ceiling",
    "martian_stub_generator", "stub_servers", "fitness",
})
DROP_IDENTIFIERS = frozenset({
    "BrainSpec", "BrainRegistry", "GenomeSectionDocs", "MartianRegistry", "MartianSpec",
    "SlotDeclaration", "InputWiring", "GovernanceGate", "bridge_run_martian",
    "make_bridge_runner", "_get_martian_registry", "decode_params",
})
OPTIONAL_DEPS = ("numpy", "scipy", "sklearn")


def _module_name(path: Path) -> str:
    rel = path.relative_to(SRC).with_suffix("")
    parts = list(rel.parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def _py_files() -> list[Path]:
    return sorted(p for p in PKG_DIR.rglob("*.py") if "__pycache__" not in p.parts)


def _resolve_relative(path: Path, node: ast.ImportFrom) -> str:
    package = _module_name(path).split(".")
    if path.name != "__init__.py":
        package = package[:-1]
    base = package[: len(package) - (node.level - 1)] if node.level > 1 else package
    return ".".join(base + ([node.module] if node.module else []))


def _imported_modules(path: Path, tree: ast.AST) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            out.extend((node.lineno, a.name) for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            mod = _resolve_relative(path, node) if node.level else (node.module or "")
            out.append((node.lineno, mod))
            out.extend((node.lineno, f"{mod}.{a.name}") for a in node.names)
        elif (
            isinstance(node, ast.Call)
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
            and (
                (isinstance(node.func, ast.Name) and node.func.id == "__import__")
                or (isinstance(node.func, ast.Attribute) and node.func.attr == "import_module")
            )
        ):
            out.append((node.lineno, node.args[0].value))
    return out


def _annotation_strings(tree: ast.AST) -> list[ast.Constant]:
    anns: list[ast.expr] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.AnnAssign):
            anns.append(node.annotation)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            a = node.args
            for arg in [*a.posonlyargs, *a.args, *a.kwonlyargs, a.vararg, a.kwarg]:
                if arg is not None and arg.annotation is not None:
                    anns.append(arg.annotation)
            if node.returns is not None:
                anns.append(node.returns)
    return [
        c for ann in anns for c in ast.walk(ann)
        if isinstance(c, ast.Constant) and isinstance(c.value, str)
    ]


def _identifiers(tree: ast.AST) -> list[tuple[int, str]]:
    ids: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            ids.append((node.lineno, node.id))
        elif isinstance(node, ast.Attribute):
            ids.append((node.lineno, node.attr))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            ids.append((node.lineno, node.name))
        elif isinstance(node, ast.alias):
            ids.append((getattr(node, "lineno", 0), node.name.split(".")[-1]))
            if node.asname:
                ids.append((getattr(node, "lineno", 0), node.asname))
    for const in _annotation_strings(tree):
        try:
            parsed = ast.parse(const.value, mode="eval")
        except SyntaxError:
            continue
        ids.extend((const.lineno, n.id) for n in ast.walk(parsed) if isinstance(n, ast.Name))
    return ids


def _violations_in(path: Path, source: str) -> list[str]:
    tree = ast.parse(source, filename=str(path))
    rel = path.relative_to(SRC)
    bad: list[str] = []
    for lineno, mod in _imported_modules(path, tree):
        parts = mod.split(".")
        if parts[0] == "alienclaw":
            bad.append(f"{rel}:{lineno}: imports in-tree package {mod!r}")
        elif parts[0] == PKG and (hits := set(parts[1:]) & (DROP_PACKAGES | EXCLUDED_MODULES)):
            bad.append(f"{rel}:{lineno}: imports DROP/excluded {mod!r} ({sorted(hits)})")
    for lineno, ident in _identifiers(tree):
        if ident in DROP_IDENTIFIERS:
            bad.append(f"{rel}:{lineno}: DROP identifier {ident!r}")
    return bad


def _violations(path: Path) -> list[str]:
    return _violations_in(path, path.read_text(encoding="utf-8"))


def test_package_has_modules() -> None:
    files = _py_files()
    assert len(files) >= 20
    names = {_module_name(p) for p in files}
    for required in ("alienclaw_ga.genome.codec", "alienclaw_ga.evolution.generation"):
        assert required in names


@pytest.mark.parametrize("path", _py_files(), ids=lambda p: str(p.relative_to(SRC)))
def test_module_has_no_drop_imports(path: Path) -> None:
    assert _violations(path) == []


def test_no_excluded_or_drop_module_is_staged() -> None:
    for path in _py_files():
        parts = set(path.relative_to(PKG_DIR).with_suffix("").parts)
        assert not parts & (DROP_PACKAGES | EXCLUDED_MODULES), path


def test_scanner_catches_drop_imports() -> None:
    """Self-test: the scanner flags every pattern it claims to (parsed in memory only)."""
    probe = PKG_DIR / "evolution" / "_probe_not_shipped.py"  # never written to disk
    source = (
        "from __future__ import annotations\n"
        "import importlib\n"
        "from typing import TYPE_CHECKING\n"
        "if TYPE_CHECKING:\n"
        "    from alienclaw.brains.types import BrainSpec\n"
        "from ..bridge import server\n"
        "x: 'BrainSpec | None' = None\n"
        "def f():\n"
        "    import alienclaw.martians.registry\n"
        "    importlib.import_module('alienclaw.governance')\n"
        "    from .live_evo import run\n"
    )
    tree = ast.parse(source)
    mods = [m for _, m in _imported_modules(probe, tree)]
    assert "alienclaw.brains.types" in mods
    assert "alienclaw_ga.bridge" in mods
    assert "alienclaw.martians.registry" in mods
    assert "alienclaw.governance" in mods
    assert "alienclaw_ga.evolution.live_evo" in mods
    assert "BrainSpec" in {i for _, i in _identifiers(tree)}
    bad = _violations_in(probe, source)
    assert sum("in-tree package" in b for b in bad) >= 3  # TYPE_CHECKING, lazy, importlib
    assert sum("DROP/excluded" in b for b in bad) >= 2  # ..bridge, .live_evo
    assert sum("DROP identifier" in b for b in bad) >= 2  # import alias + string annotation


_RUNTIME_PROBE = r"""
import importlib, json, pkgutil, sys
sys.path[:] = [p for p in sys.path if p != ""]
import alienclaw_ga
imported, skipped = [], []
for info in pkgutil.walk_packages(alienclaw_ga.__path__, "alienclaw_ga."):
    try:
        importlib.import_module(info.name)
        imported.append(info.name)
    except ModuleNotFoundError as exc:
        if (exc.name or "").split(".")[0] in OPTIONAL:
            skipped.append(info.name)
        else:
            raise
leaked = sorted(m for m in sys.modules if m == "alienclaw" or m.startswith("alienclaw."))
print(json.dumps({"imported": imported, "skipped": skipped, "leaked": leaked}))
"""


def test_every_module_imports_without_in_tree_alienclaw(tmp_path: Path) -> None:
    env = {k: v for k, v in os.environ.items() if k not in ("PYTHONPATH", "PYTHONHOME")}
    env["PYTHONPATH"] = str(SRC)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    # HOME is a tmp dir here (conftest); keep the real user site visible for optional deps.
    if site.USER_BASE:
        env.setdefault("PYTHONUSERBASE", site.USER_BASE)
    code = f"OPTIONAL = {OPTIONAL_DEPS!r}\n" + _RUNTIME_PROBE
    proc = subprocess.run(
        [sys.executable, "-c", code], cwd=tmp_path, env=env,
        capture_output=True, text=True, timeout=120, check=False,
    )
    assert proc.returncode == 0, proc.stderr
    report = json.loads(proc.stdout.strip().splitlines()[-1])
    assert report["leaked"] == []
    assert "alienclaw_ga.genome.codec" in report["imported"]
    assert "alienclaw_ga.evolution.generation" in report["imported"]
    # Core (genome + evolution) must never need the optional diagnostics deps.
    assert not [m for m in report["skipped"] if not m.startswith("alienclaw_ga.diagnostics")]
