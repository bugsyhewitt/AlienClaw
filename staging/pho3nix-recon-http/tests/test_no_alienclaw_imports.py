"""The staged package imports the guard only as ``agent_tool_sandbox``, never in-tree code.

AST scan (covers lazy imports inside functions) plus a clean-interpreter import of
every module with only the staged src and the sandbox src on sys.path.
"""
from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

import agent_tool_sandbox
import pytest

SRC = Path(__file__).resolve().parents[1] / "src"
SANDBOX_SRC = Path(agent_tool_sandbox.__file__).resolve().parents[1]
MODULES = sorted((SRC / "pho3nix_recon_http").glob("*.py"))
FORBIDDEN_ROOT = "alien" + "claw"


@pytest.mark.parametrize("path", MODULES, ids=lambda p: p.name)
def test_no_in_tree_imports(path: Path) -> None:
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            assert node.module.split(".")[0] != FORBIDDEN_ROOT, f"{path.name}:{node.lineno}"
        elif isinstance(node, ast.Import):
            for alias in node.names:
                assert alias.name.split(".")[0] != FORBIDDEN_ROOT, f"{path.name}:{node.lineno}"


def test_fetch_tools_use_the_sandbox_guard() -> None:
    from pho3nix_recon_http import http_get, url_fetch

    for mod in (http_get, url_fetch):
        assert mod.resolve_and_validate is agent_tool_sandbox.resolve_and_validate
        assert mod.build_pinned_opener is agent_tool_sandbox.build_pinned_opener
        assert mod.SsrfBlockedError is agent_tool_sandbox.SsrfBlockedError
        # The unpinned pieces are gone, so nothing can fall back to them.
        assert not hasattr(mod, "assert_safe_fetch_url")
        assert not hasattr(mod, "build_no_redirect_opener")


def test_every_module_imports_in_a_clean_interpreter(tmp_path: Path) -> None:
    names = [f"pho3nix_recon_http.{p.stem}" for p in MODULES if p.stem != "__init__"]
    code = (
        "import sys, importlib\n"
        f"sys.path[:0] = [{str(SRC)!r}, {str(SANDBOX_SRC)!r}]\n"
        f"for n in {names!r}: importlib.import_module(n)\n"
        "import pho3nix_recon_http as p\n"
        "assert sorted(p.TOOL_REGISTRY) == "
        "['http_get', 'search_text', 'url_fetch', 'web_search'], p.TOOL_REGISTRY\n"
        f"bad = sorted(m for m in sys.modules if m.split('.')[0] == {FORBIDDEN_ROOT!r})\n"
        "assert not bad, bad\n"
        "print('ok')\n"
    )
    proc = subprocess.run(
        # -B: -I ignores PYTHONDONTWRITEBYTECODE, and a .pyc under src/ embeds the
        # absolute (repo-named) source path.
        [sys.executable, "-I", "-B", "-c", code], capture_output=True, text=True, timeout=60,
        env={"HOME": str(tmp_path)}, cwd=tmp_path,
    )
    assert proc.returncode == 0 and proc.stdout.strip() == "ok", proc.stdout + proc.stderr
