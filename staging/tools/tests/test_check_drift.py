"""Tests for staging/tools/check_drift.py.

Most tests build a synthetic git repository in tmp_path with two in-tree sources, a
fixture, and a staged package (one verbatim copy, one adapted copy, one verbatim
fixture, one new test named in divergences). Expected blob shas are computed here with
hashlib, independently of the git calls the checker makes. One smoke test runs against
the real staging/ directory of this worktree.
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

TOOL = Path(__file__).resolve().parents[1] / "check_drift.py"
REAL_REPO = Path(__file__).resolve().parents[3]
_spec = importlib.util.spec_from_file_location("check_drift_under_test", TOOL)
cd = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = cd
_spec.loader.exec_module(cd)

GIT_ENV = {
    "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
    "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid",
    "GIT_AUTHOR_DATE": "2026-01-01T00:00:00Z", "GIT_COMMITTER_DATE": "2026-01-01T00:00:00Z",
    "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull,
}
GIT_SCRUB = ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY")

MOD_PY = "def f():\n    return 1\n"
UTIL_PY = "X = 1\n"
UTIL_ADAPTED = "# adapted for the package\nX = 1\n"
DATA_JSON = '{"vectors": [1, 2, 3]}\n'
PKG = "staging/demo"


def blob_sha(data: bytes | str) -> str:
    raw = data.encode() if isinstance(data, str) else data
    return hashlib.sha1(b"blob %d\0" % len(raw) + raw).hexdigest()


def _env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in GIT_SCRUB}
    env.update(GIT_ENV)
    return env


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=repo, env=_env(), check=True,
                          capture_output=True, text=True).stdout


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


@pytest.fixture(autouse=True)
def _isolated_git(monkeypatch):
    for key in GIT_SCRUB:
        monkeypatch.delenv(key, raising=False)
    for key, value in GIT_ENV.items():
        monkeypatch.setenv(key, value)


def entry(staged: str, source: str, text: str, relation: str) -> dict:
    return {"staged": f"{PKG}/{staged}", "source": source,
            "source_blob": blob_sha(text), "relation": relation}


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    root.mkdir()
    git(root, "init", "-q", "-b", "main")
    write(root / "src/pkg/mod.py", MOD_PY)
    write(root / "src/pkg/util.py", UTIL_PY)
    write(root / "test/fixtures/data.json", DATA_JSON)
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "sources")
    commit = git(root, "rev-parse", "HEAD").strip()
    write(root / PKG / "src/demo/mod.py", MOD_PY)
    write(root / PKG / "src/demo/util.py", UTIL_ADAPTED)
    write(root / PKG / "tests/fixtures/data.json", DATA_JSON)
    write(root / PKG / "tests/test_new.py", "def test_x():\n    assert True\n")
    write(root / PKG / "pyproject.toml", "[project]\nname = 'demo'\n")
    write(root / PKG / "package.json", "{}\n")
    write(root / PKG / "README.md", "# demo\n")
    write_provenance(root, {
        "package": "demo", "source_commit": commit,
        "files": [
            entry("src/demo/mod.py", "src/pkg/mod.py", MOD_PY, "verbatim"),
            entry("src/demo/util.py", "src/pkg/util.py", UTIL_PY, "adapted"),
            entry("tests/fixtures/data.json", "test/fixtures/data.json", DATA_JSON, "verbatim"),
        ],
        "divergences": ["New, not derived from a source: tests/test_new.py."],
    })
    return root


def write_provenance(root: Path, doc: object, pkg: str = PKG) -> Path:
    text = doc if isinstance(doc, str) else json.dumps(doc, indent=2)
    return write(root / pkg / "PROVENANCE.json", text)


def load_provenance(root: Path, pkg: str = PKG) -> dict:
    return json.loads((root / pkg / "PROVENANCE.json").read_text())


def run_json(root: Path, *extra: str, capsys) -> tuple[int, dict]:
    code = cd.main(["--repo", str(root), "--json", *extra])
    return code, json.loads(capsys.readouterr().out)


def findings(report: dict, severity: str | None = None) -> list[dict]:
    out = [f for p in report["packages"] for f in p["findings"]]
    return [f for f in out if severity is None or f["severity"] == severity]


def codes(report: dict, severity: str | None = None) -> list[str]:
    return [f["code"] for f in findings(report, severity)]


# --------------------------------------------------------------------------- core matrix


def test_clean_package_exits_zero(repo, capsys):
    code, report = run_json(repo, capsys=capsys)
    assert code == 0
    assert report["ok"] is True and report["exit_code"] == 0
    assert report["staging"] == "staging"
    assert report["totals"] == {"packages": 1, "entries": 3, "error": 0, "drift": 0, "info": 0}
    pkg = report["packages"][0]
    assert pkg["package"] == "demo" and pkg["directory"] == PKG and pkg["status"] == "ok"


@pytest.mark.parametrize("source, staged, relation", [
    ("src/pkg/mod.py", f"{PKG}/src/demo/mod.py", "verbatim"),
    ("src/pkg/util.py", f"{PKG}/src/demo/util.py", "adapted"),
])
def test_modified_source_is_drift(repo, capsys, source, staged, relation):
    write(repo / source, "# fixed in-tree\n" + (repo / source).read_text())
    code, report = run_json(repo, capsys=capsys)
    assert code == 1
    drift = findings(report, "DRIFT")
    assert [(f["code"], f["staged"], f["source"]) for f in drift] == [
        ("source_changed", staged, source)]
    assert drift[0]["expected"] != drift[0]["actual"]
    assert drift[0]["actual"] == blob_sha((repo / source).read_text())
    assert "source changed since staging" in drift[0]["message"]
    assert report["packages"][0]["counts"]["drift"] == 1


def test_edited_verbatim_copy_is_drift(repo, capsys):
    write(repo / PKG / "src/demo/mod.py", MOD_PY + "# local edit\n")
    code, report = run_json(repo, capsys=capsys)
    assert code == 1
    [f] = findings(report, "DRIFT")
    assert f["code"] == "verbatim_edited" and f["staged"] == f"{PKG}/src/demo/mod.py"
    assert f["expected"] == blob_sha(MOD_PY)
    assert f["actual"] == blob_sha(MOD_PY + "# local edit\n")


def test_edited_adapted_copy_is_ok(repo, capsys):
    write(repo / PKG / "src/demo/util.py", UTIL_ADAPTED + "Y = 2\n")
    code, report = run_json(repo, capsys=capsys)
    assert code == 0 and findings(report) == []


def test_verbatim_resynced_without_blob_update_says_so(repo, capsys):
    new = MOD_PY + "# fixed\n"
    write(repo / "src/pkg/mod.py", new)
    write(repo / PKG / "src/demo/mod.py", new)
    code, report = run_json(repo, capsys=capsys)
    assert code == 1
    assert codes(report, "DRIFT") == ["source_changed", "verbatim_edited"]
    assert "only source_blob is stale" in findings(report, "DRIFT")[1]["message"]


def test_missing_staged_file_is_error(repo, capsys):
    (repo / PKG / "src/demo/util.py").unlink()
    code, report = run_json(repo, capsys=capsys)
    assert code == 1
    [f] = findings(report, "ERROR")
    assert f["code"] == "staged_missing" and f["staged"] == f"{PKG}/src/demo/util.py"


def test_missing_source_is_error_and_reports_object_store(repo, capsys):
    (repo / "src/pkg/mod.py").unlink()
    code, report = run_json(repo, capsys=capsys)
    assert code == 1
    [f] = findings(report, "ERROR")
    assert f["code"] == "source_missing" and f["source"] == "src/pkg/mod.py"
    assert "is in the object store" in f["message"]  # it was committed
    assert codes(report, "DRIFT") == []  # the verbatim copy still matches the record


def test_missing_uncommitted_source_reports_blob_absent(repo, capsys):
    doc = load_provenance(repo)
    doc["files"].append(entry("src/demo/gone.py", "src/pkg/gone.py", "never\n", "adapted"))
    write_provenance(repo, doc)
    write(repo / PKG / "src/demo/gone.py", "never\n")
    code, report = run_json(repo, capsys=capsys)
    assert code == 1
    [f] = findings(report, "ERROR")
    assert f["code"] == "source_missing" and "is not in the object store" in f["message"]


def test_malformed_json_is_error_and_other_packages_still_checked(repo, capsys):
    write(repo / "staging/broken/PROVENANCE.json", '{"package": "broken", "files": [')
    write(repo / "staging/broken/src/x.py", "x = 1\n")
    code, report = run_json(repo, capsys=capsys)
    assert code == 1
    by_dir = {p["directory"]: p for p in report["packages"]}
    assert list(by_dir) == ["staging/broken", PKG]  # sorted, deterministic
    [f] = by_dir["staging/broken"]["findings"]
    assert f["code"] == "invalid_json" and "line 1" in f["message"]
    assert by_dir[PKG]["status"] == "ok"


def test_untracked_staged_file_is_info_only(repo, capsys):
    write(repo / PKG / "src/demo/extra.py", "E = 1\n")
    code, report = run_json(repo, capsys=capsys)
    assert code == 0
    [f] = findings(report)
    assert (f["severity"], f["code"], f["staged"]) == (
        "INFO", "untracked_staged", f"{PKG}/src/demo/extra.py")
    assert report["totals"]["info"] == 1


# --------------------------------------------------------------------------- allowlists


def test_new_files_allowlist_accepts_paths_and_globs(repo, capsys):
    write(repo / PKG / "src/demo/extra.py", "E = 1\n")
    write(repo / PKG / "src/demo/gen/a.ts", "export {};\n")
    write(repo / PKG / "src/demo/gen/b.ts", "export {};\n")
    write(repo / PKG / "src/demo/keep.js", "1;\n")
    doc = load_provenance(repo)
    doc["new_files"] = ["./src/demo/extra.py", f"{PKG}/src/demo/gen/*.ts"]
    write_provenance(repo, doc)
    code, report = run_json(repo, capsys=capsys)
    assert code == 0
    assert [f["staged"] for f in findings(report)] == [f"{PKG}/src/demo/keep.js"]


def test_tests_named_in_divergences_are_ignored_others_are_info(repo, capsys):
    write(repo / PKG / "tests/test_unnamed.py", "def test_y():\n    pass\n")
    write(repo / PKG / "test/named.test.ts", "export {};\n")
    write(repo / PKG / "src/demo/index.ts", "export {};\n")
    write(repo / PKG / "tests/test_new_two.py", "")  # "tests/test_new.py" must not cover it
    doc = load_provenance(repo)
    doc["divergences"].append("test/named.test.ts and src/demo/index.ts are new.")
    write_provenance(repo, doc)
    code, report = run_json(repo, capsys=capsys)
    assert code == 0
    info = {f["staged"]: f["message"] for f in findings(report, "INFO")}
    assert sorted(info) == [f"{PKG}/src/demo/index.ts", f"{PKG}/tests/test_new_two.py",
                            f"{PKG}/tests/test_unnamed.py"]
    assert "named in divergences" in info[f"{PKG}/src/demo/index.ts"]
    assert "named in divergences" not in info[f"{PKG}/tests/test_unnamed.py"]


def test_non_source_cache_and_nested_package_files_are_not_scanned(repo, capsys):
    write(repo / PKG / "tests/__pycache__/x.py", "")
    write(repo / PKG / ".hypothesis/x.json", "{}")
    write(repo / PKG / "node_modules/dep/index.js", "")
    write(repo / PKG / "tsconfig.json", "{}")
    write(repo / PKG / "docs/notes.txt", "")
    nested = f"{PKG}/sub"
    write(repo / nested / "lib.py", MOD_PY)
    write_provenance(repo, {
        "package": "demo-sub", "source_commit": "0" * 40,
        "files": [{"staged": f"{nested}/lib.py", "source": "src/pkg/mod.py",
                   "source_blob": blob_sha(MOD_PY), "relation": "verbatim"}],
        "divergences": [],
    }, pkg=nested)
    code, report = run_json(repo, capsys=capsys)
    assert code == 0, findings(report)
    assert findings(report) == []
    assert [p["directory"] for p in report["packages"]] == [PKG, nested]


# --------------------------------------------------------------------------- schema


def _mutate(doc: dict, how: str) -> object:
    files = doc["files"]
    if how == "missing_key":
        del files[0]["source_blob"]
    elif how == "bad_relation":
        files[0]["relation"] = "copied"
    elif how == "bad_blob":
        files[0]["source_blob"] = "ABC123"
    elif how == "non_string":
        files[0]["source"] = 7
    elif how == "entry_not_object":
        files.append("src/demo/mod.py")
    elif how == "files_not_list":
        doc["files"] = {"a": 1}
    elif how == "missing_divergences":
        del doc["divergences"]
    elif how == "divergence_not_string":
        doc["divergences"] = [1]
    elif how == "bad_new_files":
        doc["new_files"] = "src/demo/extra.py"
    elif how == "bad_commit":
        doc["source_commit"] = "HEAD"
    elif how == "empty_package":
        doc["package"] = ""
    elif how == "top_level_array":
        return [doc]
    return doc


@pytest.mark.parametrize("how", [
    "missing_key", "bad_relation", "bad_blob", "non_string", "entry_not_object",
    "files_not_list", "missing_divergences", "divergence_not_string", "bad_new_files",
    "bad_commit", "empty_package", "top_level_array",
])
def test_schema_violations_are_errors(repo, capsys, how):
    write_provenance(repo, _mutate(load_provenance(repo), how))
    code, report = run_json(repo, capsys=capsys)
    assert code == 1
    assert "schema" in codes(report, "ERROR")
    if how in ("missing_divergences", "divergence_not_string"):
        # the divergence text no longer names tests/test_new.py, so it is unaccounted
        assert [f["staged"] for f in findings(report, "INFO")] == [f"{PKG}/tests/test_new.py"]
    else:  # a broken entry or file list is not re-reported as untracked files
        assert codes(report, "INFO") == []


@pytest.mark.parametrize("bad, reason", [
    ("../outside.py", "escapes the repository"),
    ("/etc/passwd", "is absolute"),
    ("staging\\demo\\x.py", "backslashes"),
])
def test_invalid_paths_are_errors(repo, capsys, bad, reason):
    doc = load_provenance(repo)
    doc["files"][1]["source"] = bad
    write_provenance(repo, doc)
    code, report = run_json(repo, capsys=capsys)
    assert code == 1
    [f] = findings(report, "ERROR")
    assert f["code"] == "path_invalid" and reason in f["message"]


def test_duplicate_json_key_is_schema_error(repo, capsys):
    text = json.dumps(load_provenance(repo))
    write_provenance(repo, text[:-1] + ', "files": []}')
    code, report = run_json(repo, capsys=capsys)
    assert code == 1
    [f] = findings(report)
    assert f["code"] == "schema" and "duplicate JSON key 'files'" in f["message"]


def test_duplicate_staged_entry_is_error(repo, capsys):
    doc = load_provenance(repo)
    doc["files"].append(dict(doc["files"][0]))
    write_provenance(repo, doc)
    code, report = run_json(repo, capsys=capsys)
    assert code == 1 and codes(report, "ERROR") == ["duplicate_entry"]


def test_staged_path_outside_package_is_error(repo, capsys):
    write(repo / "staging/other/mod.py", MOD_PY)
    doc = load_provenance(repo)
    doc["files"][0]["staged"] = "staging/other/mod.py"
    write_provenance(repo, doc)
    (repo / PKG / "src/demo/mod.py").unlink()
    code, report = run_json(repo, capsys=capsys)
    assert code == 1
    [f] = findings(report, "ERROR")
    assert f["code"] == "staged_outside_package" and f["staged"] == "staging/other/mod.py"


def test_staged_symlink_escaping_package_is_error(repo, capsys):
    target = write(repo / "staging/other/mod.py", MOD_PY)
    staged = repo / PKG / "src/demo/mod.py"
    staged.unlink()
    staged.symlink_to(target)
    code, report = run_json(repo, capsys=capsys)
    assert code == 1
    [f] = findings(report, "ERROR")
    assert f["code"] == "staged_outside_package" and "symlink" in f["message"]


def test_extra_keys_are_tolerated_as_info(repo, capsys):
    doc = load_provenance(repo)
    doc["generated_by"] = "salvage-run"
    doc["files"][0]["note"] = "hand-checked"
    write_provenance(repo, doc)
    code, report = run_json(repo, capsys=capsys)
    assert code == 0
    assert codes(report) == ["unknown_key", "unknown_key"]


def test_sha256_blob_format_is_accepted_by_schema(repo, capsys):
    doc = load_provenance(repo)
    doc["files"][1]["source_blob"] = "a" * 64
    write_provenance(repo, doc)
    code, report = run_json(repo, capsys=capsys)
    assert code == 1 and codes(report) == ["source_changed"]  # format ok, hash differs


# --------------------------------------------------------------------------- CLI surface


def test_git_hash_object_honours_gitattributes(repo, capsys):
    write(repo / ".gitattributes", "* text=auto eol=lf\n")
    (repo / "src/pkg/mod.py").write_bytes(MOD_PY.replace("\n", "\r\n").encode())
    code, report = run_json(repo, capsys=capsys)
    assert code == 0, findings(report)  # CRLF in the work tree normalises to the same blob


def test_human_output_lines_and_summary(repo, capsys):
    write(repo / "src/pkg/mod.py", "changed = True\n")
    write(repo / PKG / "src/demo/extra.py", "E = 1\n")
    assert cd.main(["--repo", str(repo)]) == 1
    out = capsys.readouterr().out.splitlines()
    assert out[0].startswith(f"DRIFT  {PKG}/src/demo/mod.py: source changed since staging")
    assert out[1].startswith(f"INFO   {PKG}/src/demo/extra.py: staged file has no provenance")
    assert f"FAIL  {PKG}  (demo)  entries=3 drift=1 error=0 info=1" in out
    assert out[-1] == "total: 1 package(s), 3 entries, 1 drift, 0 error, 1 info -> exit 1"


def test_output_is_deterministic(repo, capsys):
    write(repo / "src/pkg/util.py", "changed = True\n")
    for name in ("z.py", "a.py", "m.ts"):
        write(repo / PKG / "src/demo" / name, "")
    write(repo / "staging/aaa/PROVENANCE.json", "nope")
    first = run_json(repo, capsys=capsys)
    second = run_json(repo, capsys=capsys)
    assert first == second
    staged = [f["staged"] for f in findings(first[1], "INFO")]
    assert staged == sorted(staged)
    assert [p["directory"] for p in first[1]["packages"]] == ["staging/aaa", PKG]


def test_staging_option_and_repo_subdirectory(repo, capsys):
    other = repo / "elsewhere"
    write(other / "pkg/PROVENANCE.json", json.dumps({
        "package": "p", "source_commit": "1" * 40, "divergences": [],
        "files": [{"staged": "elsewhere/pkg/m.py", "source": "src/pkg/mod.py",
                   "source_blob": blob_sha(MOD_PY), "relation": "verbatim"}]}))
    write(other / "pkg/m.py", MOD_PY)
    code = cd.main(["--repo", str(repo / "src"), "--staging", str(other), "--json"])
    report = json.loads(capsys.readouterr().out)
    assert code == 0, findings(report)
    assert report["staging"] == "elsewhere" and report["totals"]["packages"] == 1


def test_empty_staging_is_ok(repo, capsys):
    (repo / "empty").mkdir()
    assert cd.main(["--repo", str(repo), "--staging", str(repo / "empty")]) == 0
    assert "no PROVENANCE.json found under empty" in capsys.readouterr().out


def test_fatal_errors_exit_2(tmp_path, repo, capsys, monkeypatch):
    plain = tmp_path / "plain"
    plain.mkdir()
    monkeypatch.setenv("GIT_CEILING_DIRECTORIES", str(tmp_path))
    assert cd.main(["--repo", str(plain), "--json"]) == 2
    out = capsys.readouterr()
    assert json.loads(out.out)["fatal"].startswith("not a git work tree")
    assert cd.main(["--repo", str(repo), "--staging", str(repo / "nope")]) == 2
    assert "staging directory not found" in capsys.readouterr().err


def test_script_runs_as_subprocess(repo):
    proc = subprocess.run([sys.executable, str(TOOL), "--json"], cwd=repo / "src", env=_env(),
                          capture_output=True, text=True, check=False)
    assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout)["totals"]["entries"] == 3


def test_smoke_real_staging():
    if not (REAL_REPO / "staging").is_dir():
        pytest.skip("no staging/ next to this tool")
    if subprocess.run(["git", "-C", str(REAL_REPO), "rev-parse", "--show-toplevel"],
                      capture_output=True, check=False).returncode != 0:
        pytest.skip("tool is not inside a git work tree")
    proc = subprocess.run([sys.executable, str(TOOL), "--repo", str(REAL_REPO), "--json"],
                          capture_output=True, text=True, check=False, timeout=120)
    assert proc.returncode in (0, 1), proc.stderr
    report = json.loads(proc.stdout)
    assert report["exit_code"] == proc.returncode
    assert report["totals"]["packages"] >= 1
    for pkg in report["packages"]:
        assert pkg["provenance"].startswith("staging/")
        for f in pkg["findings"]:
            assert f["severity"] in ("ERROR", "DRIFT", "INFO")
