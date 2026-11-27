"""Tests for staging/tools/build_drop_manifest.py.

Most tests build a small synthetic git repository in tmp_path: a few KEEP and DROP
files that import each other, a fake CI workflow, and a pass-1 branch with two commits
(delete + modify, then restore) so every pass-1 status shows up. One smoke test runs
against the real worktree when it is a git repository.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

TOOL = Path(__file__).resolve().parents[1] / "build_drop_manifest.py"
_spec = importlib.util.spec_from_file_location("build_drop_manifest_under_test", TOOL)
bdm = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = bdm
_spec.loader.exec_module(bdm)

GIT_ENV = {
    "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
    "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid",
    "GIT_AUTHOR_DATE": "2026-01-01T00:00:00Z", "GIT_COMMITTER_DATE": "2026-01-01T00:00:00Z",
    "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull,
}

CI_YML = """\
name: CI
on:
  push:
    branches: [main]
jobs:
  py:
    name: Python
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Lint
        run: ruff check src/alienclaw/evolution/ src/alienclaw/brains/
      - name: Test brains
        run: |
          PYTHONPATH=src pytest test/brains/ --cov=alienclaw.brains
      - name: Evolution only
        run: pytest test/evolution/test_gen.py
  ts:
    name: TS
    runs-on: ubuntu-latest
    steps:
      - name: Governance
        run: npx vitest run test/governance/ --coverage.include="src/alienclaw/governance/**/*.ts"
      - name: Typecheck
        run: npx tsc --noEmit
"""

READER_TS = """\
import { PATHS } from '../constants.js';
import type { Loop } from '../governance/loop.js';
import {
  parse,
} from '../martians/parser.js';
// import { nope } from '../governance/loop.js';
export const r = PATHS;
"""

GENERATION_PY = '''\
"""Docstring mentions seed/msb/compute.msb and alienclaw.bridge, which is not a use."""
from alienclaw.bridge.server import handle


def run():
    from alienclaw.brains import types
    return handle(types)
'''

EVO_TYPES_PY = """\
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from alienclaw.brains.types import BrainSpec
"""

CONFORMANCE_PY = """\
from pathlib import Path


def msb_dir():
    return Path(__file__).resolve().parents[3] / "seed" / "msb"
"""

KEEP_TEST_TS = """\
import { r } from '../src/alienclaw/telemetry/telemetry-reader.js';
const soul = readFileSync(join(__dirname, '..', 'src', 'alienclaw', 'prompts', 'a.soul.md'));
"""

FILES: dict[str, bytes | str] = {
    "src/alienclaw/governance/loop.ts": "import { helper } from '../utils.js';\n"
                                        "export const loop = helper;\n",
    "src/alienclaw/martians/parser.ts": "export const parse = 1;\n",
    "src/alienclaw/constants.ts": "export const PATHS = {};\n",
    "src/alienclaw/utils.ts": "export const helper = 1;\n",
    "src/alienclaw/types.ts": "export type T = number;\n",
    "src/alienclaw/api/server.ts": "import type { T } from '../types.js';\nexport const s = 1;\n",
    "src/alienclaw/telemetry/telemetry-reader.ts": READER_TS,
    "src/alienclaw/bridge/__init__.py": "",
    "src/alienclaw/bridge/server.py": "def handle(x):\n    return x\n",
    "src/alienclaw/brains/__init__.py": "",
    "src/alienclaw/brains/types.py": "class BrainSpec:\n    pass\n",
    "src/alienclaw/evolution/__init__.py": "",
    "src/alienclaw/evolution/generation.py": GENERATION_PY,
    "src/alienclaw/evolution/types.py": EVO_TYPES_PY,
    "src/alienclaw/evolution/bridge_runner.py": "from alienclaw.bridge.server import handle\n",
    "src/alienclaw/fitness/conformance.py": CONFORMANCE_PY,
    "src/alienclaw/prompts/a.soul.md": "soul\n",
    "seed/msb/compute.msb": "brain\nno trailing newline",
    "installer/install.sh": "#!/bin/bash\necho hi\n",
    "docs/specs/SUBAGENT_SPEC.md": "# dead\n",
    "docs/specs/GENOME_SPEC.md": "# keep\n",
    "assets/chrome-extension/icon.png": b"\x89PNG\x00\x01\x02\n\n",
    "perf/k6/a.js": "export default 1;\n",
    "test/evolution/test_gen.py": "from alienclaw.evolution.generation import run\n",
    "test/evolution/test_bridge_runner.py": "from alienclaw.evolution.bridge_runner import handle\n"
                                            "from alienclaw.evolution import generation\n",
    "test/brains/test_types.py": "from alienclaw.brains.types import BrainSpec\n",
    "test/governance/loop.test.ts": "import { loop } from "
                                    "'../../src/alienclaw/governance/loop.js';\n",
    "test/top.test.ts": "import { parse } from '../src/alienclaw/martians/parser.js';\n",
    "test/keep.test.ts": KEEP_TEST_TS,
    ".github/workflows/ci.yml": CI_YML,
    ".env.example": "SECRET_VALUE_MUST_NOT_LEAK=1\n",
}


def _git(repo: Path, *args: str) -> str:
    env = {**os.environ, **GIT_ENV}
    out = subprocess.run(["git", "-C", str(repo), "-c", "commit.gpgsign=false",
                          "-c", "core.hooksPath=" + os.devnull, *args],
                         env=env, check=True, capture_output=True)
    return out.stdout.decode().strip()


def _write(repo: Path, rel: str, content: bytes | str) -> None:
    p = repo / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(content.encode() if isinstance(content, str) else content)


@pytest.fixture(scope="module")
def synth(tmp_path_factory) -> dict:
    root = tmp_path_factory.mktemp("synth")
    repo = root / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    for rel, content in FILES.items():
        _write(repo, rel, content)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "base")
    _git(repo, "tag", "pre-teardown-20261126")
    # Pass 1: delete three files, skip a test, add a handoff; then restore one deletion.
    _git(repo, "checkout", "-q", "-b", "pass1")
    _git(repo, "rm", "-q", "installer/install.sh", "docs/specs/SUBAGENT_SPEC.md",
         "seed/msb/compute.msb")
    _write(repo, "test/governance/loop.test.ts",
           "// skipped\n" + FILES["test/governance/loop.test.ts"])
    _write(repo, "HANDOFF.md", "# handoff\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "pass1 delete")
    _write(repo, "seed/msb/compute.msb", FILES["seed/msb/compute.msb"])
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "pass1 restore")
    _git(repo, "checkout", "-q", "main")
    bundle = root / "archive.bundle"
    _git(repo, "bundle", "create", "-q", str(bundle), "--all")
    manifest = bdm.build_manifest(str(repo), ref="HEAD", pass1_ref="pass1",
                                  ci=".github/workflows/ci.yml", bundle=str(bundle),
                                  verify_bundle=True)
    return {"repo": repo, "bundle": bundle, "m": manifest,
            "files": {f["path"]: f for f in manifest["files"]}}


def _edges(m: dict, src: str) -> list[dict]:
    return [e for e in m["inbound_edges"] if e["from"] == src]


# ── classification ──────────────────────────────────────────────────────────────


def test_static_verdicts(synth):
    f = synth["files"]
    assert f["src/alienclaw/governance/loop.ts"]["verdict"] == "DROP"
    assert f["src/alienclaw/bridge/server.py"]["verdict"] == "DROP"
    assert f["src/alienclaw/evolution/bridge_runner.py"]["verdict"] == "DROP"
    assert f["src/alienclaw/evolution/generation.py"]["verdict"] == "KEEP"
    assert f["src/alienclaw/api/server.ts"]["verdict"] == "DEFER"
    assert f["perf/k6/a.js"]["verdict"] == "REVIEW"
    assert f["docs/specs/SUBAGENT_SPEC.md"]["verdict"] == "DROP"
    assert f["docs/specs/GENOME_SPEC.md"]["verdict"] == "KEEP"
    assert f["seed/msb/compute.msb"]["verdict"] == "DROP"


def test_derived_verdicts_follow_importers(synth):
    f = synth["files"]
    assert f["src/alienclaw/constants.ts"]["verdict"] == "KEEP"  # telemetry-reader imports it
    assert f["src/alienclaw/utils.ts"]["verdict"] == "DROP"  # only governance imports it
    assert f["src/alienclaw/types.ts"]["verdict"] == "DEFER"  # only api/ imports it
    assert "telemetry-reader.ts (KEEP)" in f["src/alienclaw/constants.ts"]["reason"]


def test_auto_tests(synth):
    f = synth["files"]
    assert f["test/top.test.ts"]["verdict"] == "DROP"  # only imports martians/
    assert f["test/evolution/test_gen.py"]["verdict"] == "KEEP"
    # Mixed imports, but named after the DROP module it tests.
    assert f["test/evolution/test_bridge_runner.py"]["verdict"] == "DROP"
    assert f["test/keep.test.ts"]["verdict"] == "KEEP"
    assert f["test/governance/loop.test.ts"]["verdict"] == "DROP"


def test_areas_and_summary(synth):
    m, f = synth["m"], synth["files"]
    assert f["src/alienclaw/constants.ts"]["area"] == "src/(top-level)"
    assert f["test/top.test.ts"]["area"] == "test/(top-level)"
    assert f["assets/chrome-extension/icon.png"]["area"] == "assets/chrome-extension"
    drop = [x for x in m["files"] if x["verdict"] == "DROP"]
    assert m["totals"]["DROP"]["files"] == len(drop)
    assert m["totals"]["DROP"]["bytes"] == sum(x["bytes"] for x in drop)
    assert m["areas"]["src/evolution"]["DROP"]["files"] == 1
    assert "seed/" in m["drop_roots"] and "src/alienclaw/governance/" in m["drop_roots"]


# ── per-file facts ──────────────────────────────────────────────────────────────


def test_blob_sha_and_bytes(synth):
    for rel, content in FILES.items():
        if rel.startswith(".env"):
            continue
        data = content.encode() if isinstance(content, str) else content
        want = hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()
        assert synth["files"][rel]["blob"] == want, rel
        assert synth["files"][rel]["bytes"] == len(data), rel


def test_loc(synth):
    f = synth["files"]
    assert f["src/alienclaw/evolution/generation.py"]["loc"] == 7
    assert f["seed/msb/compute.msb"]["loc"] == 2  # last line has no newline
    assert f["src/alienclaw/bridge/__init__.py"]["loc"] == 0
    assert f["assets/chrome-extension/icon.png"]["loc"] is None  # binary
    assert bdm.count_loc(b"a\nb\n") == 2 and bdm.count_loc(b"a\nb") == 2


def test_env_files_never_listed(synth):
    text = json.dumps(synth["m"])
    assert ".env.example" not in text
    assert "SECRET_VALUE_MUST_NOT_LEAK" not in text
    assert synth["m"]["generated_from"]["excluded"]["count"] == 1


# ── edges ───────────────────────────────────────────────────────────────────────


def test_python_runtime_edges(synth):
    es = _edges(synth["m"], "src/alienclaw/evolution/generation.py")
    got = {(e["to"], e["line"], e["kind"]) for e in es}
    assert ("src/alienclaw/bridge/server.py", 2, "runtime") in got
    assert ("src/alienclaw/brains/types.py", 6, "runtime") in got  # lazy, in-function
    assert all(e["line"] != 1 for e in es)  # the docstring is not a reference


def test_python_type_checking_is_type_only(synth):
    es = _edges(synth["m"], "src/alienclaw/evolution/types.py")
    assert [(e["to"], e["line"], e["kind"]) for e in es] == [
        ("src/alienclaw/brains/types.py", 4, "type-only")]
    assert any(b["to"] == "src/alienclaw/brains/types.py" for b in synth["m"]["type_only_edges"])


def test_ts_edges(synth):
    es = _edges(synth["m"], "src/alienclaw/telemetry/telemetry-reader.ts")
    got = sorted((e["to"], e["line"], e["kind"]) for e in es)
    assert got == [
        ("src/alienclaw/governance/loop.ts", 2, "type-only"),
        ("src/alienclaw/martians/parser.ts", 3, "runtime"),  # multi-line import, start line
    ]  # the commented-out import on line 6 is ignored; constants.ts is KEEP


def test_data_edges(synth):
    py = _edges(synth["m"], "src/alienclaw/fitness/conformance.py")
    assert [(e["to"], e["to_type"], e["kind"], e["line"]) for e in py] == [
        ("seed/msb/", "dir", "data", 5)]
    ts = _edges(synth["m"], "test/keep.test.ts")
    assert [(e["to"], e["kind"], e["line"]) for e in ts] == [
        ("src/alienclaw/prompts/a.soul.md", "data", 2)]


def test_only_surviving_sources(synth):
    froms = {synth["files"][e["from"]]["verdict"] for e in synth["m"]["inbound_edges"]}
    assert froms <= {"KEEP", "DEFER", "REVIEW"}


def test_blockers(synth):
    b = {x["to"]: x for x in synth["m"]["blockers"]}
    assert "src/alienclaw/bridge/server.py" in b
    assert "src/alienclaw/martians/parser.ts" in b
    assert "seed/msb/" in b
    assert "src/alienclaw/governance/loop.ts" not in b  # type-only edge, not a blocker
    assert "src/alienclaw/governance/" in b  # named by the CI coverage include
    cut = synth["m"]["cut_list"]
    assert cut["src/alienclaw/evolution/generation.py"] == [
        "src/alienclaw/brains/types.py", "src/alienclaw/bridge/server.py"]


# ── CI ──────────────────────────────────────────────────────────────────────────


def test_ci_mapping(synth):
    steps = {(s["job"], s["name"]): s for s in synth["m"]["ci_steps"]}
    lint = steps[("py", "Lint")]
    assert lint["drop_areas"] == ["src/brains"]
    assert [r["target"] for r in lint["partial_refs"]] == ["src/alienclaw/evolution/"]
    brains = steps[("py", "Test brains")]
    assert brains["drop_areas"] == ["src/brains", "test/brains"]
    assert {r["token"] for r in brains["refs"]} == {"test/brains/", "alienclaw.brains"}
    assert all(r["line"] == 15 for r in brains["refs"])
    assert steps[("py", "Evolution only")]["refs"] == []
    gov = steps[("ts", "Governance")]
    assert gov["drop_areas"] == ["src/governance", "test/governance"]
    assert "tsc" in steps[("ts", "Typecheck")]["implicit_scope"]
    ci_edges = [e for e in synth["m"]["inbound_edges"] if e["kind"] == "ci"]
    assert all(e["from"] == ".github/workflows/ci.yml" and e["context"] for e in ci_edges)


# ── pass 1 and archive ──────────────────────────────────────────────────────────


def test_pass1_status(synth):
    f = synth["files"]
    assert f["installer/install.sh"]["pass1"] == "deleted-in-pass1"
    assert f["docs/specs/SUBAGENT_SPEC.md"]["pass1"] == "deleted-in-pass1"
    assert f["seed/msb/compute.msb"]["pass1"] == "restored-in-pass1"
    assert f["test/governance/loop.test.ts"]["pass1"] == "modified-in-pass1"
    assert f["src/alienclaw/utils.ts"]["pass1"] == "untouched"
    assert synth["m"]["pass1"]["added_in_pass1"] == ["HANDOFF.md"]
    assert synth["m"]["pass1"]["counts"]["DROP"]["deleted-in-pass1"] == 2


def test_archive_block(synth):
    a = synth["m"]["archive"]
    head = _git(synth["repo"], "rev-parse", "HEAD")
    assert a["tag_commit"] == head
    assert a["bundle"]["exists"] and a["bundle"]["verify"]["ok"] is True
    assert a["bundle"]["tag_in_bundle"] == head
    assert a["bundle"]["sha256"] == hashlib.sha256(synth["bundle"].read_bytes()).hexdigest()
    assert "git checkout pre-teardown-20261126 -- <path>" in a["restore"]["restore_path"]
    assert all(f["archived"] == "identical" for f in synth["m"]["files"])


def test_missing_bundle_is_recorded(synth, tmp_path):
    m = bdm.build_manifest(str(synth["repo"]), pass1_ref="pass1",
                           bundle=str(tmp_path / "nope.bundle"), verify_bundle=False)
    assert m["archive"]["bundle"] == {"path": str(tmp_path / "nope.bundle"), "exists": False}


# ── determinism and CLI ─────────────────────────────────────────────────────────


def test_deterministic_cli_output(synth, tmp_path):
    outs = []
    for n in (1, 2):
        j, md = tmp_path / f"m{n}.json", tmp_path / f"m{n}.md"
        rc = bdm.main(["--repo", str(synth["repo"]), "--ref", "HEAD", "--pass1-ref", "pass1",
                       "--ci", ".github/workflows/ci.yml", "--bundle", str(synth["bundle"]),
                       "--no-bundle-verify", "--json", str(j), "--md", str(md)])
        assert rc == 0
        outs.append((j.read_bytes(), md.read_bytes()))
    assert outs[0] == outs[1]
    data = json.loads(outs[0][0])
    assert [f["path"] for f in data["files"]] == sorted(f["path"] for f in data["files"])
    md_text = outs[0][1].decode()
    assert "## Blockers" in md_text and "src/alienclaw/bridge/server.py" in md_text


# ── scanner units ───────────────────────────────────────────────────────────────


def test_strip_js_comments_keeps_strings():
    src = "const u = 'http://x'; // tail\n/* a\n b */ const v = 1;\n"
    out = bdm.strip_js_comments(src)
    assert "'http://x'" in out and "tail" not in out and " b " not in out
    assert out.count("\n") == src.count("\n")


def test_inline_type_specifiers_are_type_only():
    idx = bdm.PathIndex(["a/x.ts", "a/y.ts"])
    es = bdm.scan_js("a/y.ts", "import { type A, type B } from './x.js';\n", idx)
    assert [(e.target, e.kind) for e in es] == [("a/x.ts", "type-only")]
    es = bdm.scan_js("a/y.ts", "export { type A, b } from './x.js';\n", idx)
    assert [(e.target, e.kind) for e in es] == [("a/x.ts", "runtime")]


def test_prose_strings_are_mentions():
    idx = bdm.PathIndex(["seed/msb/a.msb", "k.py"])
    es = bdm.scan_python("k.py", 'X = "**Source:** `seed/msb/a.msb` line 3"\n', idx)
    assert [(e.target, e.kind) for e in es] == [("seed/msb/a.msb", "mention")]


# ── real repository smoke test ──────────────────────────────────────────────────


def test_real_repo_smoke():
    repo = Path(__file__).resolve().parents[3]
    probe = subprocess.run(["git", "-C", str(repo), "rev-parse", "--is-inside-work-tree"],
                           capture_output=True, check=False)
    if probe.returncode != 0:
        pytest.skip("worktree is not a git repository")
    if bdm.rev_parse(str(repo), f"{bdm.DEFAULT_PASS1_REF}^{{commit}}") is None:
        pytest.skip("pass-1 ref is not available")
    m = bdm.build_manifest(str(repo), bundle=str(repo / "no-such.bundle"), verify_bundle=False)
    assert set(m) == {
        "schema_version", "generated_from", "archive", "totals", "areas", "pass1",
        "drop_roots", "blockers", "type_only_edges", "cut_list", "inbound_edges",
        "ci_steps", "rules", "files",
    }
    assert m["totals"]["DROP"]["files"] > 0
