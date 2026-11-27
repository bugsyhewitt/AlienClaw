#!/usr/bin/env python3
"""Build the DROP archive manifest for the AlienClaw salvage teardown.

Every tracked file at ``--ref`` is classified (DROP / KEEP / DEFER / REVIEW), measured
(bytes, LOC, git blob sha), compared against teardown pass 1 (``--pass1-ref``) and
against the pre-teardown archive tag, and scanned for references INTO the DROP set
from the files that survive the teardown (imports, data-file paths, CI steps).

The output is deterministic: sorted, no timestamps, and the only provenance is the
``generated_from`` block (ref shas). Run it twice on the same refs and the bytes match.

Read-only against git: it uses ls-tree, rev-parse, cat-file, log, show, merge-base,
bundle verify and bundle list-heads. Files named ``.env*`` are neither read nor listed.

Usage:
    python3 staging/tools/build_drop_manifest.py --repo . \\
        --json docs/salvage/drop-manifest.json --md docs/salvage/DROP-ARCHIVE-MANIFEST.md \\
        [--ref HEAD] [--pass1-ref origin/chore/teardown-pass1] [--ci .github/workflows/ci.yml] \\
        [--lock-cmd /path/to/heavy.sh] [--no-bundle-verify]
"""

from __future__ import annotations

import argparse
import ast
import bisect
import fnmatch
import hashlib
import json
import os
import posixpath
import re
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass

SCHEMA_VERSION = "1.0"
DEFAULT_REF = "HEAD"
DEFAULT_PASS1_REF = "origin/chore/teardown-pass1"
DEFAULT_CI = ".github/workflows/ci.yml"
DEFAULT_TAG = "pre-teardown-20261126"
DEFAULT_BUNDLE = "/home/xil/archive/alienclaw-pre-teardown-20261126.bundle"

VERDICTS = ("DROP", "KEEP", "DEFER", "REVIEW")
SURVIVING = ("KEEP", "DEFER", "REVIEW")  # strongest first
BLOCKING_KINDS = ("runtime", "data", "ci")
EDGE_KINDS = ("runtime", "type-only", "data", "ci", "mention")
# Session records and packet reports are history, not code: classified, never scanned.
# docs/salvage/ holds this tool's own output; scanning it would turn every path it lists
# into a bogus data edge on the next regeneration.
SCAN_EXCLUDE = ("MEMORY/", ".packet-reports/", "docs/salvage/")
PASS1_STATUSES = ("deleted-in-pass1", "restored-in-pass1", "modified-in-pass1", "untouched")

# ── Classification rules ────────────────────────────────────────────────────────────
# (pattern, verdict, mode, reason). First match wins. A pattern ending in "/" is a
# directory prefix, a pattern with glob characters is an fnmatch glob, anything else
# is an exact path.
#   static  — the verdict is fixed by the rule.
#   derived — the verdict follows the files that reference this one: the strongest
#             surviving referrer (KEEP > DEFER > REVIEW); DROP when only DROP files
#             reference it; the rule's verdict when nothing references it.
#   auto    — a test file: DROP when everything outside test/ that it imports or
#             reads is DROP, or when it is named after a DROP module it imports
#             (test_bridge_runner.py -> bridge_runner.py); otherwise the rule's verdict.
_S1 = "SALVAGE.md §1"
RULES: tuple[tuple[str, str, str, str], ...] = (
    # DEFER: live leaderboard, fate undecided.
    ("src/alienclaw/api/", "DEFER", "static", f"{_S1}: api/ DEFER (live leaderboard)"),
    ("migrations/", "DEFER", "static", f"{_S1}: leaderboard DB migrations, DEFER with api/"),
    ("server.js", "DEFER", "static", "leaderboard server entry point, DEFER with api/"),
    ("test/api/", "DEFER", "auto", "tests for the deferred api/"),
    # REVIEW.
    ("perf/", "REVIEW", "static", f"{_S1}: perf/ REVIEW before drop"),
    ("scripts/deploy.sh", "REVIEW", "static", "only deploys the retired site/ (DROP)"),
    ("scripts/local-preview.sh", "REVIEW", "static", "only serves the retired site/ (DROP)"),
    ("scripts/gen-seed-genomes.py", "REVIEW", "static", "regenerates seed/martians/ (DROP)"),
    ("scripts/check-seed-drift.sh", "REVIEW", "static", "drift gate for seed/martians/ (DROP)"),
    ("docs/hermes-phase2-spec.md", "REVIEW", "static", "Hermes host for the governance product"),
    (".github/PULL_REQUEST_TEMPLATE/brain.md", "REVIEW", "static", "MartianBrain PR checklist"),
    ("src/alienclaw/README.md", "REVIEW", "static", "README of the governance engine (DROP)"),
    ("scripts/run_packet25_experiments.py", "REVIEW", "static",
     "product-era Martian experiment driver (imports bridge_runner)"),
    ("scripts/run_packet28_rerun.py", "REVIEW", "static",
     "product-era Martian experiment driver (imports bridge_runner)"),
    ("scripts/analyze_packet25.py", "REVIEW", "static", "analysis of the Packet 25 experiment"),
    ("src/alienclaw/fitness/function.py", "REVIEW", "static",
     f"{_S1} retires this metric (DROP), but evolution/generation.py and four diagnostics "
     "import it at runtime"),
    # KEEP carve-outs inside otherwise-DROP directories.
    ("src/alienclaw/registry/genome-codec.ts", "KEEP", "static", f"{_S1}: TS codec mirror KEEP"),
    ("src/alienclaw/registry/genome-operators.ts", "KEEP", "static",
     f"{_S1}: TS operators mirror KEEP"),
    # DROP source directories.
    ("src/alienclaw/governance/", "DROP", "static", f"{_S1}: governance/ DROP"),
    ("src/alienclaw/agents/", "DROP", "static", f"{_S1}: agents/ DROP"),
    ("src/alienclaw/brains/", "DROP", "static", f"{_S1}: brains/ DROP"),
    ("src/alienclaw/martians/", "DROP", "static", f"{_S1}: martians/ DROP (PKT-1255b live)"),
    ("src/alienclaw/comms/", "DROP", "static", f"{_S1}: comms/ DROP"),
    ("src/alienclaw/bridge/", "DROP", "static", f"{_S1}: bridge/ DROP"),
    ("src/alienclaw/cli/", "DROP", "static", f"{_S1}: cli/ DROP"),
    ("src/alienclaw/wiring/", "DROP", "static", f"{_S1}: wiring/ DROP"),
    ("src/alienclaw/msb/", "DROP", "static", f"{_S1}: msb/ DROP (mostly)"),
    ("src/alienclaw/config/", "DROP", "static", f"{_S1}: config/ DROP"),
    ("src/alienclaw/prompts/", "DROP", "static", f"{_S1}: prompts/ DROP"),
    ("src/alienclaw/registry/", "DROP", "static",
     f"{_S1}: martian-registry/ms-loader/seed-installer DROP"),
    # DROP-coupled files inside KEEP directories.
    ("src/alienclaw/evolution/bridge_runner.py", "DROP", "static",
     "imports alienclaw.bridge.server; tuners do not use it"),
    ("src/alienclaw/evolution/live_evo.py", "DROP", "static", "imports bridge_runner"),
    ("src/alienclaw/evolution/__main__.py", "DROP", "static", "imports make_bridge_runner"),
    ("src/alienclaw/diagnostics/composition_decoder_audit.py", "DROP", "static",
     "product-era probe coupled to brains/martians/bridge"),
    ("src/alienclaw/diagnostics/synthetic_compositions.py", "DROP", "static",
     "product-era probe coupled to brains/martians/bridge"),
    ("src/alienclaw/diagnostics/sensitivity_audit.py", "DROP", "static",
     "product-era probe coupled to brains/martians/bridge"),
    ("src/alienclaw/telemetry/telemetry-writer.ts", "DROP", "static",
     f"{_S1}: telemetry KEEP reader / DROP rest"),
    # Top-level src files: judged by who imports them.
    ("src/alienclaw/constants.ts", "DROP", "derived", f"{_S1}: DROP, fold what tuners need"),
    ("src/alienclaw/utils.ts", "DROP", "derived", f"{_S1}: DROP, fold what tuners need"),
    ("src/alienclaw/types.ts", "DROP", "derived", "agent-hierarchy types"),
    ("src/alienclaw/registry-bootstrap.ts", "DROP", "derived", "martian registry bootstrap"),
    ("src/alienclaw/index.ts", "DROP", "derived", "barrel exporting the agent hierarchy"),
    # Non-source DROP surfaces.
    ("installer/", "DROP", "static", f"{_S1}: installer DROP"),
    ("install.sh", "DROP", "static", f"{_S1}: installer DROP"),
    ("install-hermes.sh", "DROP", "static", f"{_S1}: installer DROP"),
    ("assets/chrome-extension/", "DROP", "static", f"{_S1}: chrome extension DROP"),
    ("site/", "DROP", "static", f"{_S1}: retired static site DROP"),
    ("seed/", "DROP", "static", f"{_S1}: seed workspaces, Martians and MartianBrains DROP"),
    ("AGENTS.md", "DROP", "static", "three-agent routing doc DROP"),
    ("docs/specs/LEADERBOARD_API*", "DROP", "static", f"{_S1}: dead spec DROP"),
    ("docs/specs/MARTIANBRAIN*", "DROP", "static", f"{_S1}: dead spec DROP"),
    ("docs/specs/SUBAGENT*", "DROP", "static", f"{_S1}: dead spec DROP"),
    ("docs/specs/SPECIALIST*", "DROP", "static", f"{_S1}: dead spec DROP"),
    ("docs/specs/SUMMON_BRIDGE*", "DROP", "static", f"{_S1}: dead spec DROP"),
    ("docs/how-to/adding-a-martianbrain.md", "DROP", "static", "MartianBrain how-to DROP"),
    ("docs/reference/brains.md", "DROP", "static", "MartianBrain reference DROP"),
    ("docs/reference/martianbrain-jail.md", "DROP", "static", "MartianBrain reference DROP"),
    ("docs/packet-0*.md", "DROP", "static", "product-era packet inventories DROP"),
    ("docs/ops/p3-staging-runbook.md", "DROP", "static", "product-era staging runbook DROP"),
    # Tests for DROP areas.
    ("test/governance/", "DROP", "static", "tests for governance/ (DROP)"),
    ("test/agents/", "DROP", "static", "tests for agents/ (DROP)"),
    ("test/brains/", "DROP", "static", "tests for brains/ (DROP)"),
    ("test/martians/", "DROP", "static", "tests for martians/ (DROP)"),
    ("test/comms/", "DROP", "static", "tests for comms/ (DROP)"),
    ("test/bridge/", "DROP", "static", "tests for bridge/ (DROP)"),
    ("test/cli/", "DROP", "static", "tests for cli/ (DROP)"),
    ("test/wiring/", "DROP", "static", "tests for wiring/ (DROP)"),
    ("test/msb/", "DROP", "static", "tests for msb/ (DROP)"),
    ("test/site/", "DROP", "static", "tests for site/ (DROP)"),
    ("test/config/", "DROP", "static", "tests for config/ (DROP)"),
    # Shared test infrastructure: judged by who uses it; unreferenced means REVIEW.
    ("test/helpers/", "REVIEW", "derived", "shared test helper"),
    ("test/fixtures/", "REVIEW", "derived", "shared test fixture"),
    # Every other test: KEEP unless it only exercises DROP code.
    ("test/", "KEEP", "auto", "test outside the DROP test directories"),
)
DEFAULT_RULE = ("", "KEEP", "static", "not in the DROP, DEFER or REVIEW sets")

SCAN_EXT_JS = (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs")
SCAN_EXT_PY = (".py", ".pyi")
SCAN_EXT_JSON = (".json", ".jsonc")
SCAN_EXT_HASH = (".sh", ".bash", ".yml", ".yaml", ".toml", ".cfg", ".ini")

_GLOB_CHARS = "*?[{$"
_VAR_PREFIX = re.compile(r"^(?:\$\{?[A-Za-z_]\w*\}?/)+")
_DOTTED = re.compile(r"alienclaw(?:\.[A-Za-z_]\w*)+")
_TOKEN = re.compile(r"[^\s'\"`=,;()<>|&]+")
_JS_STR = re.compile(r"""(['"`])((?:\\.|(?!\1)[^\\\n])*)\1""")
_JS_IMPORT_FROM = re.compile(
    r"""\b(import|export)\s+(type\s+)?([^;'"`()]*?)\s*\bfrom\s*(['"])([^'"\n]+)\4""", re.S
)
_JS_IMPORT_BARE = re.compile(r"""\bimport\s*(['"])([^'"\n]+)\1""")
_JS_DYNAMIC = re.compile(
    r"""(\bimport|\brequire|\bvi\.(?:mock|doMock|unmock|importActual|importMock))"""
    r"""\s*\(\s*(['"`])([^'"`\n]+)\2"""
)


# ── git plumbing (read-only) ────────────────────────────────────────────────────────


def git(repo: str, *args: str, stdin: bytes | None = None, check: bool = True) -> bytes:
    proc = subprocess.run(
        ["git", "-C", repo, *args],
        input=stdin,
        capture_output=True,
        check=False,
    )
    if check and proc.returncode != 0:
        msg = proc.stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(f"git {' '.join(args)} failed: {msg}")
    return proc.stdout


def rev_parse(repo: str, rev: str) -> str | None:
    out = git(repo, "rev-parse", "--verify", "-q", rev, check=False).decode().strip()
    return out or None


def is_env_file(path: str) -> bool:
    return posixpath.basename(path).startswith(".env")


def ls_tree(repo: str, ref: str, long: bool = False) -> dict[str, dict]:
    """Map path -> {mode, type, sha, size} for every entry at ``ref`` (callers drop .env*)."""
    args = ["ls-tree", "-r", "-z"] + (["-l"] if long else []) + [ref]
    out: dict[str, dict] = {}
    for rec in git(repo, *args).split(b"\0"):
        if not rec:
            continue
        meta, path_b = rec.split(b"\t", 1)
        path = path_b.decode("utf-8", "surrogateescape")
        fields = meta.decode().split()
        entry = {"mode": fields[0], "type": fields[1], "sha": fields[2]}
        if long:
            entry["size"] = None if fields[3] == "-" else int(fields[3])
        out[path] = entry
    return out


def read_blobs(repo: str, shas: list[str]) -> dict[str, bytes]:
    if not shas:
        return {}
    out = git(repo, "cat-file", "--batch", stdin=("\n".join(shas) + "\n").encode())
    blobs: dict[str, bytes] = {}
    pos = 0
    while pos < len(out):
        nl = out.index(b"\n", pos)
        sha, _typ, size = out[pos:nl].decode().split()
        start = nl + 1
        blobs[sha] = out[start:start + int(size)]
        pos = start + int(size) + 1
    return blobs


def is_binary(data: bytes) -> bool:
    return b"\0" in data[:8000]


def count_loc(data: bytes) -> int | None:
    if is_binary(data):
        return None
    if not data:
        return 0
    return data.count(b"\n") + (0 if data.endswith(b"\n") else 1)


# ── Path index and reference matching ───────────────────────────────────────────────


@dataclass(frozen=True, order=True)
class Edge:
    target: str
    src: str
    line: int
    kind: str
    spec: str
    ttype: str = "file"
    context: str = ""


class PathIndex:
    def __init__(self, paths: list[str]):
        self.files = set(paths)
        self.dirs: set[str] = set()
        self.by_basename: dict[str, list[str]] = defaultdict(list)
        self.by_suffix: dict[str, list[str]] = defaultdict(list)
        self._under: dict[str, list[str]] = {}
        for p in paths:
            parts = p.split("/")
            for i in range(1, len(parts)):
                self.dirs.add("/".join(parts[:i]))
            self.by_basename[parts[-1]].append(p)
            for i in range(1, len(parts) - 1):
                self.by_suffix["/".join(parts[i:])].append(p)

    def files_under(self, d: str) -> list[str]:
        prefix = d.rstrip("/") + "/"
        if prefix not in self._under:
            self._under[prefix] = sorted(p for p in self.files if p.startswith(prefix))
        return self._under[prefix]

    # Python modules ------------------------------------------------------------
    def py_module(self, dotted_parts: list[str], roots: list[str]) -> tuple[str, str] | None:
        for root in roots:
            base = posixpath.join(root, *dotted_parts) if root else "/".join(dotted_parts)
            if base + ".py" in self.files:
                return base + ".py", "file"
            if base + "/__init__.py" in self.files:
                return base + "/__init__.py", "file"
        return None

    def dotted(self, name: str) -> tuple[str, str] | None:
        """Resolve a dotted ``alienclaw.x.y`` string to a module file or package dir."""
        parts = name.split(".")
        for k in range(len(parts), 1, -1):
            base = "src/" + "/".join(parts[:k])
            if base + ".py" in self.files:
                return base + ".py", "file"
            if base in self.dirs:
                return base + "/", "dir"
        return None

    # JS/TS modules -------------------------------------------------------------
    def js_module(self, spec: str, src: str) -> str | None:
        if not spec.startswith("."):
            return None
        base = posixpath.normpath(posixpath.join(posixpath.dirname(src), spec))
        stem, ext = posixpath.splitext(base)
        cands = [base]
        if ext in (".js", ".jsx"):
            cands += [stem + ".ts", stem + ".tsx", stem + ".d.ts"]
        elif ext == ".mjs":
            cands.append(stem + ".mts")
        elif ext == ".cjs":
            cands.append(stem + ".cts")
        cands += [base + e for e in (".ts", ".tsx", ".mts", ".d.ts", ".js", ".mjs", ".json")]
        cands += [base + "/index" + e for e in (".ts", ".tsx", ".js", ".mjs")]
        for c in cands:
            if c in self.files:
                return c
        return None

    # Free-form path strings -----------------------------------------------------
    def match(self, raw: str, src: str) -> tuple[str, str] | None:
        tok = raw.strip().strip("'\"`")
        if not tok or len(tok) > 400:
            return None
        if _DOTTED.fullmatch(tok):
            return self.dotted(tok)
        had_slash = "/" in tok
        tok = _VAR_PREFIX.sub("", tok)
        cuts = [tok.find(c) for c in _GLOB_CHARS if c in tok]
        globbed = bool(cuts)
        if globbed:
            tok = tok[: min(cuts)]
            if not tok.endswith("/"):
                tok = posixpath.dirname(tok)
        tok = tok.rstrip("/")
        if not tok or tok in (".", ".."):
            return None
        cands = []
        if had_slash:
            rel = posixpath.normpath(posixpath.join(posixpath.dirname(src), tok))
            if not rel.startswith(".."):
                cands.append(rel)
        root = posixpath.normpath(re.sub(r"^(?:\.\.?/)+", "", tok.lstrip("/")))
        cands.append(root)
        for c in cands:
            if c in (".", "") or c == src:
                continue
            if c in self.files:
                return c, "file"
            if had_slash and c in self.dirs:
                return c + "/", "dir"
        if not had_slash:
            if globbed or tok.startswith(".") or "." not in tok or len(tok) < 5:
                return None
            hits = self.by_basename.get(tok, [])
            if len(hits) == 1 and hits[0] != src:
                return hits[0], "file"
            return None
        hits = self.by_suffix.get(root, [])
        if len(hits) == 1 and hits[0] != src:
            return hits[0], "file"
        return None


# ── Source scanners ─────────────────────────────────────────────────────────────────


class _Lines:
    def __init__(self, text: str):
        self.starts = [0] + [m.end() for m in re.finditer("\n", text)]

    def line(self, pos: int) -> int:
        return bisect.bisect_right(self.starts, pos)


def strip_js_comments(text: str) -> str:
    """Blank out // and /* */ comments, keeping strings, offsets and newlines."""
    out: list[str] = []
    i, n, state = 0, len(text), ""
    while i < n:
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if not state:
            if c == "/" and nxt in "/*" and nxt:
                state = "//" if nxt == "/" else "/*"
                out.append("  ")
                i += 2
                continue
            if c in "'\"`":
                state = c
            out.append(c)
            i += 1
        elif state == "//":
            if c == "\n":
                state = ""
            out.append("\n" if c == "\n" else " ")
            i += 1
        elif state == "/*":
            if c == "*" and nxt == "/":
                state = ""
                out.append("  ")
                i += 2
                continue
            out.append("\n" if c == "\n" else " ")
            i += 1
        else:
            if c == "\\" and nxt:
                out.append(c + nxt)
                i += 2
                continue
            if c == state or (c == "\n" and state != "`"):
                state = ""
            out.append(c)
            i += 1
    return "".join(out)


def _all_type_specifiers(spec_clause: str) -> bool:
    m = re.fullmatch(r"\s*\{([^}]*)\}\s*", spec_clause)
    if not m:
        return False
    items = [s.strip() for s in m.group(1).split(",") if s.strip()]
    return bool(items) and all(s.startswith("type ") for s in items)


def scan_js(path: str, text: str, idx: PathIndex) -> list[Edge]:
    code = strip_js_comments(text)
    lines = _Lines(code)
    edges: list[Edge] = []
    spec_spans: set[int] = set()

    def add_import(pos: int, spec: str, type_only: bool, spec_pos: int) -> None:
        spec_spans.add(spec_pos)
        target = idx.js_module(spec, path)
        if target:
            kind = "type-only" if type_only else "runtime"
            edges.append(Edge(target, path, lines.line(pos), kind, spec))

    for m in _JS_IMPORT_FROM.finditer(code):
        type_only = bool(m.group(2)) or _all_type_specifiers(m.group(3))
        add_import(m.start(), m.group(5), type_only, m.start(4))
    for m in _JS_IMPORT_BARE.finditer(code):
        add_import(m.start(), m.group(2), False, m.start(1))
    for m in _JS_DYNAMIC.finditer(code):
        add_import(m.start(), m.group(3), False, m.start(2))

    # String literals, singly and as comma-separated runs (path.join argument lists).
    literals = [m for m in _JS_STR.finditer(code) if m.start() not in spec_spans]
    runs: list[list[re.Match]] = []
    for m in literals:
        if runs and re.fullmatch(r"\s*,\s*", code[runs[-1][-1].end():m.start()]):
            runs[-1].append(m)
        else:
            runs.append([m])
    candidates: list[tuple[int, str]] = []
    for run in runs:
        vals = [m.group(2) for m in run]
        if any("${" in v for v in vals):
            continue
        for m in run:
            candidates.append((m.start(), m.group(2)))
        if len(run) > 1:
            candidates.append((run[0].start(), "/".join(vals)))
    edges += _data_edges(path, ((lines.line(p), s) for p, s in candidates), idx, "data")
    return edges


def _is_type_checking(test: ast.expr) -> bool:
    if isinstance(test, ast.Name):
        return test.id == "TYPE_CHECKING"
    return isinstance(test, ast.Attribute) and test.attr == "TYPE_CHECKING"


def _py_roots(path: str) -> list[str]:
    roots = ["src", ""]
    here = posixpath.dirname(path)
    if here not in roots:
        roots.append(here)
    return roots


def scan_python(path: str, text: str, idx: PathIndex) -> list[Edge]:
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        return scan_hash_comment(path, text, idx, "data")
    roots = _py_roots(path)
    pkg_parts = posixpath.dirname(path).split("/") if posixpath.dirname(path) else []
    edges: list[Edge] = []
    strings: list[tuple[int, str]] = []
    inner_div: set[int] = set()  # nested `a / b` nodes already joined by their outer chain

    def kind_of(tc: bool) -> str:
        return "type-only" if tc else "runtime"

    def resolve_from(node: ast.ImportFrom) -> list[tuple[str, str]]:
        mod_parts = node.module.split(".") if node.module else []
        if node.level:
            base = pkg_parts[: len(pkg_parts) - (node.level - 1)] if node.level > 1 else pkg_parts
            search = [("/".join(base + mod_parts), [])]
        else:
            search = [(None, mod_parts)]
        hits: list[tuple[str, str]] = []
        for rel_base, parts in search:
            for alias in node.names:
                if rel_base is not None:
                    sub = idx.py_module([alias.name], [rel_base]) if alias.name != "*" else None
                    whole = idx.py_module([], [rel_base]) if rel_base else None
                else:
                    sub = idx.py_module(parts + [alias.name], roots) if alias.name != "*" else None
                    whole = idx.py_module(parts, roots) if parts else None
                hit = sub or whole
                if hit:
                    hits.append((hit[0], alias.name))
        return hits

    def visit(node: ast.AST, tc: bool) -> None:
        if isinstance(node, ast.If) and _is_type_checking(node.test):
            for child in node.body:
                visit(child, True)
            for child in node.orelse:
                visit(child, tc)
            return
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            return  # docstrings and bare string statements are not references
        if isinstance(node, ast.Import):
            for alias in node.names:
                hit = idx.py_module(alias.name.split("."), roots)
                if hit:
                    edges.append(Edge(hit[0], path, node.lineno, kind_of(tc), alias.name))
        elif isinstance(node, ast.ImportFrom):
            spec = "." * node.level + (node.module or "")
            seen = set()
            for target, _name in resolve_from(node):
                if target not in seen:
                    seen.add(target)
                    edges.append(Edge(target, path, node.lineno, kind_of(tc), spec))
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            strings.append((node.lineno, node.value))
        elif isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
            if id(node) not in inner_div:
                strings.extend(_joined_runs(_flatten_div(node)))
                for sub in ast.walk(node):
                    if sub is not node and isinstance(sub, ast.BinOp):
                        inner_div.add(id(sub))
        elif isinstance(node, ast.Call):
            strings.extend(_joined_runs(list(node.args)))
        for child in ast.iter_child_nodes(node):
            visit(child, tc)

    visit(tree, False)
    edges += _data_edges(path, strings, idx, "data")
    return edges


def _flatten_div(node: ast.expr) -> list[ast.expr]:
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
        return _flatten_div(node.left) + _flatten_div(node.right)
    return [node]


def _joined_runs(nodes: list[ast.expr]) -> list[tuple[int, str]]:
    out, run = [], []
    for n in nodes + [None]:
        if isinstance(n, ast.Constant) and isinstance(n.value, str):
            run.append(n)
            continue
        if len(run) > 1:
            out.append((run[0].lineno, "/".join(r.value for r in run)))
        run = []
    return out


def scan_hash_comment(path: str, text: str, idx: PathIndex, kind: str) -> list[Edge]:
    cands = []
    for lineno, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith("#"):
            continue
        cands.extend((lineno, m.group(0)) for m in _TOKEN.finditer(line))
    return _data_edges(path, cands, idx, kind)


def scan_json(path: str, text: str, idx: PathIndex, kind: str) -> list[Edge]:
    code = strip_js_comments(text) if path.endswith(".jsonc") else text
    lines = _Lines(code)
    cands = [(lines.line(m.start()), m.group(2)) for m in _JS_STR.finditer(code)]
    return _data_edges(path, cands, idx, kind)


_ALPHA_WORD = re.compile(r"(?<![\w./-])[A-Za-z]{2,}[,.;:]?(?![\w./-])")


def _is_prose(s: str, piece: str) -> bool:
    """A path inside prose (a sentence, or a Markdown code span) is a mention, not a use."""
    if not re.search(r"\s", s.strip()):
        return False
    return f"`{piece}`" in s or len(_ALPHA_WORD.findall(s)) >= 5


def _data_edges(path, candidates, idx: PathIndex, kind: str) -> list[Edge]:
    edges = []
    seen = set()
    for lineno, s in candidates:
        pieces = [s] if not re.search(r"\s", s.strip()) else [s] + _TOKEN.findall(s)
        for piece in pieces:
            hit = idx.match(piece, path)
            if hit and (hit[0], lineno) not in seen:
                seen.add((hit[0], lineno))
                k = "mention" if kind == "data" and _is_prose(s, piece.strip("`")) else kind
                edges.append(Edge(hit[0], path, lineno, k, piece.strip()[:200], hit[1]))
    return edges


def scan_file(path: str, data: bytes, idx: PathIndex, ci_path: str) -> list[Edge]:
    if is_binary(data) or path == ci_path or path.startswith(SCAN_EXCLUDE):
        return []
    text = data.decode("utf-8", "replace")
    kind = "ci" if path.startswith(".github/") else "data"
    base = posixpath.basename(path)
    if path.endswith(SCAN_EXT_PY):
        return scan_python(path, text, idx)
    if path.endswith(SCAN_EXT_JS):
        return scan_js(path, text, idx)
    if path.endswith(SCAN_EXT_JSON):
        return scan_json(path, text, idx, kind)
    if path.endswith(SCAN_EXT_HASH) or ("." not in base and text.startswith("#!")):
        return scan_hash_comment(path, text, idx, kind)
    return []


# ── CI workflow ─────────────────────────────────────────────────────────────────────


def _scalars(node) -> list:
    import yaml  # noqa: PLC0415 — optional dependency, only needed for CI parsing

    if isinstance(node, yaml.ScalarNode):
        return [node]
    if isinstance(node, yaml.SequenceNode):
        return [s for v in node.value for s in _scalars(v)]
    if isinstance(node, yaml.MappingNode):
        return [s for _k, v in node.value for s in _scalars(v)]
    return []


def _mapping(node) -> dict:
    return {k.value: v for k, v in getattr(node, "value", []) if hasattr(k, "value")}


def parse_ci_steps(text: str) -> list[dict]:
    """Return one record per workflow step: job, name, run text, line span."""
    try:
        import yaml  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise SystemExit("pyyaml is required to parse the CI workflow") from exc
    root = yaml.compose(text)
    jobs = _mapping(_mapping(root).get("jobs"))
    steps = []
    for job_id, job_node in jobs.items():
        job = _mapping(job_node)
        job_name = job["name"].value if "name" in job else job_id
        for i, step_node in enumerate(getattr(job.get("steps"), "value", [])):
            step = _mapping(step_node)
            name = step["name"].value if "name" in step else step.get("uses").value
            run = step["run"].value if "run" in step else ""
            extra = [s.value for k, v in step.items() if k not in ("name", "run", "uses")
                     for s in _scalars(v)]
            steps.append({
                "job": job_id, "job_name": job_name, "index": i, "name": name,
                "run": run, "extra": extra,
                "start": step_node.start_mark.line + 1, "end": step_node.end_mark.line + 1,
            })
    return steps


def _implicit_scope(run: str) -> str:
    if re.search(r"\btsc\b", run):
        return "tsc --noEmit: every file in tsconfig.json include"
    m = re.search(r"\bvitest run\b(.*)", run)
    if m and not re.search(r"\btest/", m.group(1)):
        return "vitest run with no path: the whole default vitest include"
    return ""


def scan_ci(ci_path: str, text: str, idx: PathIndex) -> tuple[list[dict], list[Edge]]:
    lines = text.splitlines()
    steps_out, edges = [], []
    for step in parse_ci_steps(text):
        refs, seen = [], set()
        tokens = [t for line in step["run"].splitlines()
                  if not line.lstrip().startswith("#") for t in _TOKEN.findall(line)]
        tokens += [t for v in step["extra"] for t in _TOKEN.findall(str(v))]
        for tok in tokens:
            for piece in [tok] + _DOTTED.findall(tok):
                hit = idx.match(piece, ci_path)
                if not hit or (hit[0], piece) in seen:
                    continue
                seen.add((hit[0], piece))
                line = step["start"]
                for ln in range(step["start"] - 1, min(step["end"], len(lines))):
                    if piece in lines[ln]:
                        line = ln + 1
                        break
                refs.append({"token": piece, "target": hit[0], "type": hit[1], "line": line})
                context = f"{step['job_name']} / {step['name']}"
                edges.append(Edge(hit[0], ci_path, line, "ci", piece, hit[1], context))
        steps_out.append({
            "job": step["job"], "job_name": step["job_name"], "index": step["index"],
            "name": step["name"], "line": step["start"], "refs": refs,
            "implicit_scope": _implicit_scope(step["run"]),
        })
    return steps_out, edges


# ── Classification ──────────────────────────────────────────────────────────────────


def match_rule(path: str) -> tuple[str, str, str, str]:
    for rule in RULES:
        pat = rule[0]
        if pat.endswith("/"):
            if path.startswith(pat):
                return rule
        elif any(c in pat for c in "*?["):
            if fnmatch.fnmatchcase(path, pat):
                return rule
        elif path == pat:
            return rule
    return DEFAULT_RULE


def area_of(path: str) -> str:
    parts = path.split("/")
    if parts[0] == "src" and len(parts) >= 3 and parts[1] == "alienclaw":
        return "src/" + (parts[2] if len(parts) > 3 else "(top-level)")
    if parts[0] in ("test", "seed", "docs") and len(parts) >= 2:
        return parts[0] + "/" + (parts[1] if len(parts) > 2 else "(top-level)")
    if parts[0] == "assets" and len(parts) > 2:
        return "assets/" + parts[1]
    return "(root)" if len(parts) == 1 else parts[0]


def _stem(path: str) -> str:
    base = posixpath.basename(path)
    if base == "__init__.py":
        return posixpath.basename(posixpath.dirname(path))
    base = re.sub(r"(\.d)?\.[cm]?[jt]sx?$|\.pyi?$", "", base)
    base = re.sub(r"\.(test|spec)$", "", base)
    return re.sub(r"^test_", "", base)


def _names_match(test_path: str, target: str) -> bool:
    t, s = _stem(test_path), _stem(target)
    return bool(s) and (t == s or t.startswith(s + "-") or t.startswith(s + "_"))


def classify(paths: list[str], edges: list[Edge], idx: PathIndex) -> dict[str, dict]:
    info = {}
    for p in paths:
        pat, verdict, mode, reason = match_rule(p)
        info[p] = {"verdict": verdict, "mode": mode, "rule": pat or "(default)",
                   "reason": reason, "default": verdict}
    inbound: dict[str, list[Edge]] = defaultdict(list)
    outbound: dict[str, list[Edge]] = defaultdict(list)
    named_dirs = {(e.src, posixpath.dirname(e.target) + "/") for e in edges
                  if e.ttype == "file"}
    for e in edges:
        if e.kind in ("ci", "mention"):
            continue  # CI is edited with the teardown, and prose is not a use
        outbound[e.src].append(e)
        if e.ttype == "dir":
            # A directory reference keeps a derived data file (fixture) alive only when it
            # names the file's own directory and the same source names no specific file
            # there (otherwise it is just a base path); code is kept alive by imports alone.
            if (e.src, e.target) in named_dirs:
                continue
            targets = [t for t in idx.files_under(e.target)
                       if posixpath.dirname(t) + "/" == e.target
                       and not t.endswith(SCAN_EXT_JS + SCAN_EXT_PY)]
        else:
            targets = [e.target]
        for t in targets:
            if info.get(t, {}).get("mode") == "derived":
                inbound[t].append(e)

    def target_verdict(e: Edge) -> str:
        if e.ttype == "dir":
            vs = {info[f]["verdict"] for f in idx.files_under(e.target)}
            return "DROP" if vs == {"DROP"} else "MIXED"
        return info[e.target]["verdict"]

    for _round in range(50):
        changed = False
        for p in paths:
            rec = info[p]
            if rec["mode"] == "derived":
                refs = sorted({e.src for e in inbound[p] if e.src != p})
                surv = [r for r in refs if info[r]["verdict"] in SURVIVING]
                if surv:
                    best = min(SURVIVING.index(info[r]["verdict"]) for r in surv)
                    new = SURVIVING[best]
                    note = "referenced by " + ", ".join(
                        f"{r} ({info[r]['verdict']})" for r in surv[:4])
                    if len(surv) > 4:
                        note += f" and {len(surv) - 4} more"
                elif refs:
                    new, note = "DROP", "referenced only by DROP files"
                else:
                    new, note = rec["default"], "no references found"
            elif rec["mode"] == "auto":
                # Primary subjects: code and data outside test/ that is not shared
                # infrastructure (derived files). Fall back to the shared files only when
                # the test touches nothing else.
                subj = [e for e in outbound[p] if not e.target.startswith("test/")]
                primary = [e for e in subj if info.get(e.target, {}).get("mode") != "derived"]
                vs = {target_verdict(e) for e in (primary or subj)}
                named = sorted({e.target for e in subj if e.kind in ("runtime", "type-only")
                                and e.ttype == "file" and info[e.target]["verdict"] == "DROP"
                                and _names_match(p, e.target)})
                if vs == {"DROP"}:
                    new, note = "DROP", "only exercises DROP code"
                elif named:
                    new, note = "DROP", f"named after the DROP module {named[0]}"
                else:
                    new, note = rec["default"], ""
            else:
                continue
            if new != rec["verdict"] or rec.get("derived_note") != note:
                changed = changed or new != rec["verdict"]
                rec["verdict"], rec["derived_note"] = new, note
        if not changed:
            break
    return info


# ── Pass 1, archive ─────────────────────────────────────────────────────────────────


def pass1_status(repo: str, ref: str, pass1_ref: str, ref_tree: dict) -> dict:
    base = git(repo, "merge-base", ref, pass1_ref).decode().strip()
    base_tree = ls_tree(repo, base)
    p1_tree = ls_tree(repo, pass1_ref)
    raw = git(repo, "log", "--first-parent", "-m", "--no-renames", "--diff-filter=D",
              "--name-only", "-z", "--format=", f"{base}..{pass1_ref}")
    deleted_ever = {p.decode("utf-8", "surrogateescape").strip("\n")
                    for p in raw.split(b"\0") if p.strip(b"\n")}
    status = {}
    for path in ref_tree:
        b0 = base_tree.get(path, {}).get("sha")
        b1 = p1_tree.get(path, {}).get("sha")
        if b0 is None:
            status[path] = "untouched"
        elif b1 is None:
            status[path] = "deleted-in-pass1"
        elif b1 != b0:
            status[path] = "modified-in-pass1"
        elif path in deleted_ever:
            status[path] = "restored-in-pass1"
        else:
            status[path] = "untouched"
    added = sorted(p for p in p1_tree if p not in base_tree and not is_env_file(p))
    return {"merge_base": base, "status": status, "added_in_pass1": added}


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def archive_block(repo: str, tag: str, bundle: str, verify: bool,
                  lock_cmd: str | None) -> dict:
    tag_commit = rev_parse(repo, f"{tag}^{{commit}}")
    block: dict = {
        "tag": tag,
        "tag_commit": tag_commit,
        "tag_object": rev_parse(repo, f"refs/tags/{tag}"),
        "bundle": {"path": bundle, "exists": os.path.isfile(bundle)},
    }
    b = block["bundle"]
    if b["exists"]:
        b["bytes"] = os.path.getsize(bundle)
        b["sha256"] = sha256_file(bundle)
        heads = git(repo, "bundle", "list-heads", bundle, check=False).decode().splitlines()
        b["ref_count"] = len(heads)
        tag_lines = [h for h in heads if h.endswith(f"refs/tags/{tag}")]
        b["tag_in_bundle"] = tag_lines[0].split()[0] if tag_lines else None
        if verify:
            cmd = ([lock_cmd] if lock_cmd else []) + ["git", "-C", repo, "bundle", "verify",
                                                     bundle]
            proc = subprocess.run(cmd, capture_output=True, check=False)
            text = (proc.stdout + proc.stderr).decode("utf-8", "replace").splitlines()
            keep = [ln for ln in text if not re.match(r"^[0-9a-f]{40} ", ln)]
            b["verify"] = {"ran": True, "ok": proc.returncode == 0,
                           "exit_code": proc.returncode, "output": keep[-6:]}
        else:
            b["verify"] = {"ran": False, "ok": None}
    restore_name = posixpath.basename(bundle).rsplit(".bundle", 1)[0] + "-restore"
    block["restore"] = {
        "clone_from_bundle": f"git clone {bundle} {restore_name} && "
                             f"git -C {restore_name} checkout {tag}",
        "fetch_tag_into_existing_clone": f"git fetch {bundle} "
                                         f"refs/tags/{tag}:refs/tags/{tag}",
        "restore_path": f"git checkout {tag} -- <path>",
        "restore_exact_blob": "git cat-file -p <blob> > <path>  "
                              "# then: git hash-object <path> must print <blob>",
    }
    return block


# ── Assembly ────────────────────────────────────────────────────────────────────────


def drop_roots(drop: set[str], idx: PathIndex) -> list[str]:
    """Smallest set of paths (fully-DROP dirs ending in "/", or files) covering DROP."""
    full = {}
    for d in sorted(idx.dirs):
        under = idx.files_under(d)
        full[d] = bool(under) and all(f in drop for f in under)
    roots = set()
    for f in drop:
        parts = f.split("/")
        top = f
        for i in range(1, len(parts)):
            d = "/".join(parts[:i])
            if full.get(d):
                top = d + "/"
                break
        roots.add(top)
    return sorted(roots)


def build_manifest(repo: str, ref: str = DEFAULT_REF, pass1_ref: str = DEFAULT_PASS1_REF,
                   ci: str = DEFAULT_CI, tag: str = DEFAULT_TAG, bundle: str = DEFAULT_BUNDLE,
                   verify_bundle: bool = True, lock_cmd: str | None = None) -> dict:
    ref_sha = rev_parse(repo, f"{ref}^{{commit}}")
    if not ref_sha:
        raise SystemExit(f"cannot resolve --ref {ref}")
    p1_sha = rev_parse(repo, f"{pass1_ref}^{{commit}}")
    if not p1_sha:
        raise SystemExit(f"cannot resolve --pass1-ref {pass1_ref}")
    full_tree = ls_tree(repo, ref_sha, long=True)
    tree = {p: e for p, e in full_tree.items() if not is_env_file(p)}
    env_count = len(full_tree) - len(tree)
    paths = sorted(tree)
    blob_shas = sorted({e["sha"] for e in tree.values() if e["type"] == "blob"})
    blobs = read_blobs(repo, blob_shas)
    idx = PathIndex(paths)

    # CI workflow: from the ref when tracked there, else from the filesystem.
    ci_rel = ci
    if os.path.isabs(ci):
        try:
            ci_rel = os.path.relpath(ci, repo).replace(os.sep, "/")
        except ValueError:
            ci_rel = ci
    if ci_rel in tree:
        ci_text = blobs[tree[ci_rel]["sha"]].decode("utf-8", "replace")
        ci_source = {"path": ci_rel, "from": "ref", "blob": tree[ci_rel]["sha"]}
    else:
        disk = ci if os.path.isabs(ci) else os.path.join(repo, ci)
        with open(disk, encoding="utf-8") as fh:
            ci_text = fh.read()
        ci_source = {"path": ci_rel, "from": "filesystem",
                     "blob": hashlib.sha1(f"blob {len(ci_text.encode())}\0".encode()
                                          + ci_text.encode()).hexdigest()}

    edges: list[Edge] = []
    for p in paths:
        e = tree[p]
        if e["type"] != "blob" or e["mode"] == "120000":
            continue
        edges += scan_file(p, blobs[e["sha"]], idx, ci_rel)
    ci_steps, ci_edges = scan_ci(ci_rel, ci_text, idx)
    info = classify(paths, edges, idx)
    drop = {p for p in paths if info[p]["verdict"] == "DROP"}
    if ci_rel in info and info[ci_rel]["verdict"] == "DROP":
        ci_edges = []

    def is_drop_target(e: Edge) -> bool:
        if e.ttype == "dir":
            under = idx.files_under(e.target)
            return bool(under) and all(f in drop for f in under)
        return e.target in drop

    inbound = sorted({
        e for e in edges + ci_edges
        if (e.src == ci_rel or info[e.src]["verdict"] in SURVIVING) and is_drop_target(e)
    })

    p1 = pass1_status(repo, ref_sha, p1_sha, tree)
    tag_tree = ls_tree(repo, tag) if rev_parse(repo, f"{tag}^{{commit}}") else {}

    # Per-file records.
    inbound_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for e in inbound:
        targets = idx.files_under(e.target) if e.ttype == "dir" else [e.target]
        for t in targets:
            inbound_counts[t][e.kind] += 1
    files = []
    for p in paths:
        e = tree[p]
        data = blobs.get(e["sha"], b"") if e["type"] == "blob" else b""
        rec = info[p]
        tag_sha = tag_tree.get(p, {}).get("sha")
        files.append({
            "path": p,
            "area": area_of(p),
            "verdict": rec["verdict"],
            "rule": rec["rule"],
            "reason": rec["reason"] + (f"; {rec['derived_note']}"
                                       if rec.get("derived_note") else ""),
            "bytes": e.get("size"),
            "loc": count_loc(data) if e["type"] == "blob" else None,
            "blob": e["sha"],
            "mode": e["mode"],
            "pass1": p1["status"][p],
            "archived": ("identical" if tag_sha == e["sha"] else
                         "differs" if tag_sha else "absent") if tag_tree else "no-tag",
            "inbound": dict(sorted(inbound_counts[p].items())) if p in drop else {},
        })

    # Area summary.
    areas: dict[str, dict[str, dict[str, int]]] = defaultdict(dict)
    totals = {v: {"files": 0, "loc": 0, "bytes": 0} for v in VERDICTS}
    for f in files:
        bucket = areas[f["area"]].setdefault(f["verdict"], {"files": 0, "loc": 0, "bytes": 0})
        for b in (bucket, totals[f["verdict"]]):
            b["files"] += 1
            b["loc"] += f["loc"] or 0
            b["bytes"] += f["bytes"] or 0
    pass1_counts = {v: {s: 0 for s in PASS1_STATUSES} for v in VERDICTS}
    for f in files:
        pass1_counts[f["verdict"]][f["pass1"]] += 1

    edge_dicts = [_edge_dict(e, info) for e in inbound]
    blockers = _group(edge_dicts, BLOCKING_KINDS, idx)
    soft = _group(edge_dicts, ("type-only",), idx)
    cut_list = defaultdict(set)
    for e in edge_dicts:
        if e["kind"] in BLOCKING_KINDS:
            cut_list[e["from"]].add(e["to"])

    drop_steps = []
    for s in ci_steps:
        refs = [r for r in s["refs"] if is_drop_target(Edge(r["target"], ci_rel, 0, "ci", "",
                                                             r["type"]))]
        for r in refs:
            under = idx.files_under(r["target"]) if r["type"] == "dir" else [r["target"]]
            r["areas"] = sorted({area_of(u) for u in under})
        partial = []
        for r in s["refs"]:
            if r["type"] != "dir" or r in refs or r["target"].count("/") < 2:
                continue
            under = idx.files_under(r["target"])
            n_drop = sum(1 for u in under if u in drop)
            if n_drop:
                partial.append({"token": r["token"], "target": r["target"], "line": r["line"],
                                "drop_files": n_drop, "files": len(under)})
        drop_steps.append({**s, "refs": refs, "partial_refs": partial,
                           "drop_areas": sorted({a for r in refs for a in r["areas"]})})

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_from": {
            "tool": "staging/tools/build_drop_manifest.py",
            "ref": ref, "ref_commit": ref_sha,
            "ref_tree": git(repo, "rev-parse", f"{ref_sha}^{{tree}}").decode().strip(),
            "pass1_ref": pass1_ref, "pass1_commit": p1_sha, "pass1_merge_base": p1["merge_base"],
            "ci": ci_source,
            "excluded": {"pattern": ".env*", "count": env_count,
                         "note": "never read or listed"},
        },
        "archive": archive_block(repo, tag, bundle, verify_bundle, lock_cmd),
        "totals": totals,
        "areas": {a: dict(sorted(v.items())) for a, v in sorted(areas.items())},
        "pass1": {"counts": pass1_counts, "added_in_pass1": p1["added_in_pass1"]},
        "drop_roots": drop_roots(drop, idx),
        "blockers": blockers,
        "type_only_edges": soft,
        "cut_list": {k: sorted(v) for k, v in sorted(cut_list.items())},
        "inbound_edges": edge_dicts,
        "ci_steps": drop_steps,
        "rules": [{"pattern": r[0], "verdict": r[1], "mode": r[2], "reason": r[3]}
                  for r in RULES],
        "files": files,
    }


def _edge_dict(e: Edge, info: dict) -> dict:
    d = {"from": e.src, "line": e.line, "to": e.target, "to_type": e.ttype, "kind": e.kind,
         "spec": e.spec, "from_verdict": info.get(e.src, {}).get("verdict", "KEEP")}
    if e.context:
        d["context"] = e.context
    return d


def _group(edges: list[dict], kinds: tuple[str, ...], idx: PathIndex) -> list[dict]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for e in edges:
        if e["kind"] in kinds:
            grouped[e["to"]].append(e)
    out = []
    for target, es in sorted(grouped.items()):
        under = idx.files_under(target) if target.endswith("/") else [target]
        out.append({
            "to": target,
            "areas": sorted({area_of(u) for u in under}),
            "files_covered": len(under),
            "kinds": sorted({e["kind"] for e in es}),
            "edges": [{k: v for k, v in e.items() if k != "to"} for e in es],
        })
    return out


# ── Markdown ────────────────────────────────────────────────────────────────────────


def _fmt_int(n) -> str:
    return "-" if n is None else f"{n:,}"


def render_markdown(m: dict) -> str:
    g, a, t = m["generated_from"], m["archive"], m["totals"]
    out = ["# DROP Archive Manifest", "",
           "Generated by `staging/tools/build_drop_manifest.py`. Do not edit by hand; "
           "regenerate (see the last section). Machine-readable twin: "
           "`docs/salvage/drop-manifest.json`.", "",
           f"- Ref: `{g['ref']}` = `{g['ref_commit']}` (tree `{g['ref_tree']}`)",
           f"- Pass 1: `{g['pass1_ref']}` = `{g['pass1_commit']}`, merge base "
           f"`{g['pass1_merge_base']}`",
           f"- CI workflow: `{g['ci']['path']}` (from {g['ci']['from']}, blob "
           f"`{g['ci']['blob']}`)",
           f"- Excluded: {g['excluded']['count']} tracked `.env*` file(s), never read or "
           "listed", "", "## Totals", "",
           "| Verdict | Files | LOC | Bytes |", "|---|---:|---:|---:|"]
    for v in VERDICTS:
        out.append(f"| {v} | {_fmt_int(t[v]['files'])} | {_fmt_int(t[v]['loc'])} | "
                   f"{_fmt_int(t[v]['bytes'])} |")
    out += ["", "LOC is the line count of text files (a last line without a newline counts); "
            "binary files have no LOC and add 0.", ""]

    out += ["## Blockers: KEEP-side references that must be cut before deletion", "",
            "Each row is a DROP file (or a fully-DROP directory, ending in `/`) that a "
            "surviving file (KEEP, DEFER or REVIEW) imports at runtime, reads as data, or "
            "that a CI step names. Deleting the target without cutting the edge breaks the "
            "source file or the CI step.", ""]
    if not m["blockers"]:
        out += ["None.", ""]
    else:
        out += ["Ordered: runtime imports first, then data reads, then CI-only references.", ""]

    def _rank(b: dict) -> tuple:
        ks = b["kinds"]
        return (0 if "runtime" in ks else 1 if "data" in ks else 2, b["to"])

    for b in sorted(m["blockers"], key=_rank):
        out.append(f"### `{b['to']}`")
        out.append("")
        out.append(f"Areas: {', '.join(b['areas'])}. Files covered: {b['files_covered']}.")
        out.append("")
        out.append("| From | Line | Kind | Verdict | Reference |")
        out.append("|---|---:|---|---|---|")
        for e in b["edges"]:
            ref = e["spec"].replace("|", "\\|")
            if e.get("context"):
                ref += f" (step: {e['context']})"
            out.append(f"| `{e['from']}` | {e['line']} | {e['kind']} | {e['from_verdict']} | "
                       f"`{ref}` |")
        out.append("")

    out += ["## Files that must change before deletion", "",
            "The same blockers grouped by the surviving file that holds the reference.", "",
            "| File | Verdict | DROP targets |", "|---|---|---|"]
    verdict_of = {f["path"]: f["verdict"] for f in m["files"]}
    for src, targets in m["cut_list"].items():
        v = verdict_of.get(src, "KEEP")
        out.append(f"| `{src}` | {v} | {', '.join(f'`{x}`' for x in targets)} |")
    out.append("")

    out += ["## Type-only references", "",
            "Python `TYPE_CHECKING` imports and TypeScript `import type`. They do not run, "
            "but a TypeScript one still fails `tsc --noEmit` once the target is gone.", ""]
    if not m["type_only_edges"]:
        out += ["None.", ""]
    else:
        out += ["| From | Line | To | Reference |", "|---|---:|---|---|"]
        for b in m["type_only_edges"]:
            for e in b["edges"]:
                out.append(f"| `{e['from']}` | {e['line']} | `{b['to']}` | `{e['spec']}` |")
        out.append("")

    out += ["## CI steps that reference DROP", "",
            f"From `{g['ci']['path']}`. Steps with no DROP reference are listed only when "
            "they cover DROP files implicitly.", "",
            "| Job | Step | Line | DROP areas | References |", "|---|---|---:|---|---|"]
    for s in m["ci_steps"]:
        if s["refs"]:
            toks = ", ".join(sorted({f"`{r['token']}`" for r in s["refs"]}))
            out.append(f"| {s['job_name']} | {s['name']} | {s['line']} | "
                       f"{', '.join(s['drop_areas'])} | {toks} |")
    partial = [s for s in m["ci_steps"] if s["partial_refs"]]
    if partial:
        out += ["", "Partial coverage (the step names a directory or package that still holds "
                "DROP files; deleting them shrinks what the step runs or measures, so coverage "
                "floors may move):", ""]
        for s in partial:
            bits = ", ".join(f"`{r['token']}` ({r['drop_files']}/{r['files']} DROP)"
                             for r in s["partial_refs"])
            out.append(f"- {s['job_name']} / {s['name']} (line {s['line']}): {bits}")
    implicit = [s for s in m["ci_steps"] if not s["refs"] and s["implicit_scope"]]
    if implicit:
        out += ["", "Implicit coverage (no path named, but the step runs DROP files today):",
                ""]
        for s in implicit:
            out.append(f"- {s['job_name']} / {s['name']} (line {s['line']}): "
                       f"{s['implicit_scope']}")
    out.append("")

    mentions = [e for e in m["inbound_edges"] if e["kind"] == "mention"]
    out += ["## Mentions (non-blocking)", "",
            "DROP paths named inside prose strings (report text, fixture descriptions). "
            "Nothing breaks when the target goes; the text goes stale.", ""]
    if not mentions:
        out += ["None.", ""]
    else:
        out += ["| From | Line | To |", "|---|---:|---|"]
        out += [f"| `{e['from']}` | {e['line']} | `{e['to']}` |" for e in mentions]
        out.append("")

    out += ["## DROP by area", "",
            "| Area | DROP files | DROP LOC | DROP bytes | Other files in area |",
            "|---|---:|---:|---:|---|"]
    for area, by_v in m["areas"].items():
        d = by_v.get("DROP")
        if not d:
            continue
        others = ", ".join(f"{v} {by_v[v]['files']}" for v in VERDICTS
                           if v != "DROP" and v in by_v)
        out.append(f"| {area} | {d['files']} | {_fmt_int(d['loc'])} | {_fmt_int(d['bytes'])} "
                   f"| {others or '-'} |")
    out.append("")

    out += ["## Pass-1 status", "",
            "Status of each file at the ref relative to teardown pass 1, measured from the "
            "merge base: deleted, deleted then restored, modified, or untouched.", "",
            "| Verdict | " + " | ".join(PASS1_STATUSES) + " |",
            "|---|" + "---:|" * len(PASS1_STATUSES)]
    for v in VERDICTS:
        c = m["pass1"]["counts"][v]
        out.append(f"| {v} | " + " | ".join(str(c[s]) for s in PASS1_STATUSES) + " |")
    restored = [f["path"] for f in m["files"] if f["pass1"] == "restored-in-pass1"]
    modified = [f["path"] for f in m["files"] if f["pass1"] == "modified-in-pass1"]
    if restored:
        out += ["", f"Deleted then restored in pass 1 ({len(restored)}): "
                + ", ".join(_by_parent(restored)) + "."]
    if modified:
        out += ["", "Modified in pass 1: " + ", ".join(f"`{p}`" for p in modified) + "."]
    if m["pass1"]["added_in_pass1"]:
        out += ["", "Added in pass 1 (not at the ref): "
                + ", ".join(f"`{p}`" for p in m["pass1"]["added_in_pass1"]) + "."]
    out.append("")

    nonidentical = [f for f in m["files"] if f["verdict"] == "DROP" and f["archived"]
                    != "identical"]
    out += ["## Archive and restore", "",
            f"- Tag `{a['tag']}` -> commit `{a['tag_commit']}`"]
    b = a["bundle"]
    if b["exists"]:
        v = b["verify"]
        vtxt = ("not run" if not v["ran"] else
                ("OK" if v["ok"] else f"FAILED (exit {v['exit_code']})"))
        out += [f"- Bundle `{b['path']}`: {_fmt_int(b['bytes'])} bytes, sha256 "
                f"`{b['sha256']}`, {b['ref_count']} refs, tag in bundle: "
                f"`{b['tag_in_bundle']}`",
                f"- `git bundle verify`: {vtxt}"]
        if v.get("output"):
            out += ["", "```text", *v["output"], "```"]
    else:
        out.append(f"- Bundle `{b['path']}`: MISSING")
    out += ["", f"DROP files whose blob at the ref differs from the tag: {len(nonidentical)}"
            + ("." if not nonidentical else ": " + ", ".join(
                f"`{f['path']}` ({f['archived']})" for f in nonidentical) + "."), "",
            "Restore recipes:", "", "```bash",
            "# whole repository as it was before the teardown",
            a["restore"]["clone_from_bundle"],
            "# make the tag available in an existing clone",
            a["restore"]["fetch_tag_into_existing_clone"],
            "# one path or directory",
            a["restore"]["restore_path"],
            "# exact bytes of one file, using the blob sha recorded in drop-manifest.json",
            a["restore"]["restore_exact_blob"], "```", "",
            "Restore units (fully-DROP directories and loose DROP files):", "", "```bash"]
    for r in m["drop_roots"]:
        out.append(f"git checkout {a['tag']} -- {r}")
    out += ["```", ""]

    out += ["## Classification rules", "",
            "First match wins. `derived` files take the verdict of the files that reference "
            "them; `auto` test files become DROP when everything outside `test/` that they "
            "import or read is DROP. Per-file reasons are in the JSON.", "",
            "| Pattern | Verdict | Mode | Files | Reason |", "|---|---|---|---:|---|"]
    per_rule: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for f in m["files"]:
        per_rule[f["rule"]][f["verdict"]] += 1
    for r in m["rules"] + [{"pattern": "(default)", "verdict": "KEEP", "mode": "static",
                            "reason": DEFAULT_RULE[3]}]:
        c = per_rule.get(r["pattern"] or "(default)", {})
        cnt = ", ".join(f"{v} {n}" for v, n in sorted(c.items())) or "0"
        out.append(f"| `{r['pattern']}` | {r['verdict']} | {r['mode']} | {cnt} | "
                   f"{r['reason']} |")
    derived = [f for f in m["files"] if f["rule"] in {r["pattern"] for r in m["rules"]
                                                      if r["mode"] == "derived"}
               and f["path"].startswith("src/")]
    if derived:
        out += ["", "Top-level `src/alienclaw` files judged by their importers:", ""]
        for f in derived:
            out.append(f"- `{f['path']}`: {f['verdict']}. {f['reason']}")
    out += ["", "## Regenerate", "", "```bash",
            "H=staging/tools/heavy.sh",
            "python3 staging/tools/build_drop_manifest.py --repo . --ref HEAD \\",
            "  --pass1-ref origin/chore/teardown-pass1 --ci .github/workflows/ci.yml \\",
            "  --lock-cmd \"$H\" \\",
            "  --json docs/salvage/drop-manifest.json --md docs/salvage/DROP-ARCHIVE-MANIFEST.md",
            "```", "",
            "Output is byte-identical for the same refs and bundle. See "
            "`staging/tools/README.md`.", ""]
    return "\n".join(out)


def _by_parent(paths: list[str]) -> list[str]:
    """Group paths by parent directory, for display."""
    groups: dict[str, int] = defaultdict(int)
    for p in paths:
        groups[posixpath.dirname(p) + "/"] += 1
    return [f"`{d}` ({n})" for d, n in sorted(groups.items())]


# ── CLI ─────────────────────────────────────────────────────────────────────────────


def write_outputs(manifest: dict, json_out: str | None, md_out: str | None) -> None:
    if json_out:
        os.makedirs(os.path.dirname(os.path.abspath(json_out)), exist_ok=True)
        with open(json_out, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=2, sort_keys=True, ensure_ascii=False)
            fh.write("\n")
    if md_out:
        os.makedirs(os.path.dirname(os.path.abspath(md_out)), exist_ok=True)
        with open(md_out, "w", encoding="utf-8") as fh:
            fh.write(render_markdown(manifest))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--repo", default=".")
    ap.add_argument("--ref", default=DEFAULT_REF)
    ap.add_argument("--pass1-ref", default=DEFAULT_PASS1_REF)
    ap.add_argument("--ci", default=DEFAULT_CI,
                    help="workflow path; read from --ref when tracked there")
    ap.add_argument("--json", dest="json_out")
    ap.add_argument("--md", dest="md_out")
    ap.add_argument("--tag", default=DEFAULT_TAG)
    ap.add_argument("--bundle", default=DEFAULT_BUNDLE)
    ap.add_argument("--no-bundle-verify", action="store_true")
    ap.add_argument("--lock-cmd", help="wrapper to run `git bundle verify` under (heavy.sh)")
    args = ap.parse_args(argv)
    manifest = build_manifest(
        os.path.abspath(args.repo), ref=args.ref, pass1_ref=args.pass1_ref, ci=args.ci,
        tag=args.tag, bundle=args.bundle, verify_bundle=not args.no_bundle_verify,
        lock_cmd=args.lock_cmd,
    )
    write_outputs(manifest, args.json_out, args.md_out)
    t = manifest["totals"]["DROP"]
    print(f"DROP: {t['files']} files, {t['loc']} LOC, {t['bytes']} bytes; "
          f"blockers: {len(manifest['blockers'])}; "
          f"CI steps referencing DROP: {sum(1 for s in manifest['ci_steps'] if s['refs'])}",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
