#!/usr/bin/env python3
"""Check staged packages under staging/ for drift against their in-tree sources.

Every staged package has a PROVENANCE.json that records, per staged file, the in-tree
source path and the git blob sha of that source at staging time:

    {"package": "<name>", "source_commit": "<sha>",
     "files": [{"staged": "<repo-relative path>", "source": "<repo-relative path>",
                "source_blob": "<git blob sha>", "relation": "verbatim|adapted"}],
     "divergences": ["<free text>"],
     "new_files": ["<package-relative path or glob>"]}       (new_files is optional)

The package directory is the directory that holds the PROVENANCE.json. For each entry:

  ERROR  the staged file is missing, the source is missing from the working tree, the
         staged path is outside the package directory, or the entry breaks the schema
  DRIFT  `git hash-object <source>` differs from source_blob (source changed since
         staging), or a "verbatim" staged copy no longer hashes to source_blob
  INFO   a source-like staged file (.py .ts .mts .cts .tsx .js .mjs .cjs .jsx, or .json
         under a fixtures/ directory) has no provenance entry and is not allowlisted.
         Allowlisted: files matching a "new_files" entry (fnmatch, package- or
         repo-relative), and files under a test/ or tests/ directory whose package- or
         repo-relative path appears in a "divergences" string. Unknown keys are INFO too.
         The scan is skipped when the PROVENANCE.json has no usable "files" list.

Findings are ordered by package (PROVENANCE.json path), then severity, staged path, code.

Hidden directories, __pycache__, node_modules, build, dist, coverage and venv are not
scanned, and neither is a subdirectory that holds its own PROVENANCE.json.

Exit status: 0 when there is no DRIFT or ERROR, 1 when there is, 2 when the check cannot
run (not a git work tree, git missing, staging directory missing). Read-only: the only
git commands are rev-parse, hash-object (without -w) and cat-file. Stdlib only.

Usage: check_drift.py [--repo PATH] [--staging DIR] [--json]
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import posixpath
import re
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

PROVENANCE_NAME = "PROVENANCE.json"
RELATIONS = ("verbatim", "adapted")
TOP_KEYS = ("package", "source_commit", "files", "divergences")
OPTIONAL_TOP_KEYS = ("new_files",)
ENTRY_KEYS = ("staged", "source", "source_blob", "relation")
OPTIONAL_ENTRY_KEYS = ("source_commit", "source_ref")
CODE_SUFFIXES = frozenset({".py", ".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"})
FIXTURE_SUFFIXES = frozenset({".json"})
FIXTURE_DIRS = frozenset({"fixtures"})
TEST_DIRS = frozenset({"test", "tests"})
PRUNE_DIRS = frozenset({"__pycache__", "node_modules", "build", "dist", "coverage", "venv"})
SHA_RE = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})\Z")
SEVERITIES = ("ERROR", "DRIFT", "INFO")
_SEVERITY_RANK = {name: rank for rank, name in enumerate(SEVERITIES)}
EXIT_OK, EXIT_PROBLEMS, EXIT_FATAL = 0, 1, 2


class FatalError(RuntimeError):
    """The check cannot run at all."""


class _DuplicateKeyError(ValueError):
    pass


@dataclass(frozen=True)
class Finding:
    severity: str
    code: str
    message: str
    staged: str | None = None
    source: str | None = None
    expected: str | None = None
    actual: str | None = None

    def sort_key(self) -> tuple:
        return (_SEVERITY_RANK[self.severity], self.staged or "", self.code, self.message)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class Entry:
    staged: str   # normalised repo-relative posix path
    source: str   # normalised repo-relative posix path
    blob: str
    relation: str
    # Source not on this branch (e.g. an unmerged PR): verified as <source_commit>:<source>.
    source_commit: str | None = None
    source_ref: str | None = None  # human label only, e.g. "PR #630 head"


@dataclass
class PackageReport:
    provenance: str            # display path of the PROVENANCE.json
    directory: str             # display path of the package directory
    package: str | None = None
    entries: int = 0
    findings: list[Finding] = field(default_factory=list)

    def add(self, severity: str, code: str, message: str, **extra: str | None) -> None:
        self.findings.append(Finding(severity, code, message, **extra))

    def count(self, severity: str) -> int:
        return sum(1 for f in self.findings if f.severity == severity)

    @property
    def failed(self) -> bool:
        return any(f.severity in ("ERROR", "DRIFT") for f in self.findings)

    def to_dict(self) -> dict:
        return {
            "provenance": self.provenance, "directory": self.directory,
            "package": self.package, "entries": self.entries,
            "counts": {s.lower(): self.count(s) for s in SEVERITIES},
            "status": "fail" if self.failed else "ok",
            "findings": [f.to_dict() for f in self.findings],
        }


@dataclass
class _Plan:
    """A parsed provenance file waiting for its hashes."""

    report: PackageReport
    pkg_dir: Path
    entries: list[Entry]
    claimed: set[str]          # package-relative staged paths that have an entry
    new_files: list[str]
    divergences: list[str]
    scan_untracked: bool = False   # only once "files" parsed as a list


# --------------------------------------------------------------------------- git


def _git(repo: Path, args: list[str], stdin: str | None = None) -> str:
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo), *args], input=stdin, capture_output=True,
            text=True, encoding="utf-8", errors="surrogateescape", check=False,
        )
    except FileNotFoundError as exc:
        raise FatalError("git executable not found on PATH") from exc
    if proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, args, proc.stdout, proc.stderr)
    return proc.stdout


def repo_toplevel(path: Path) -> Path:
    if not path.is_dir():
        raise FatalError(f"repo path is not a directory: {path}")
    try:
        out = _git(path, ["rev-parse", "--show-toplevel"])
    except subprocess.CalledProcessError as exc:
        raise FatalError(f"not a git work tree: {path} ({exc.stderr.strip()})") from exc
    return Path(out.strip()).resolve()


def hash_objects(repo: Path, paths: list[str]) -> dict[str, str | None]:
    """`git hash-object` each repo-relative path; None where git could not hash it."""
    unique = sorted(set(paths))
    if not unique:
        return {}
    try:
        out = _git(repo, ["hash-object", "--stdin-paths"], "".join(p + "\n" for p in unique))
        shas = out.split()
        if len(shas) == len(unique):
            return dict(zip(unique, shas))
    except subprocess.CalledProcessError:
        pass
    result: dict[str, str | None] = {}
    for path in unique:  # one bad file aborts the batch; retry one by one
        try:
            result[path] = _git(repo, ["hash-object", "--", path]).strip()
        except subprocess.CalledProcessError:
            result[path] = None
    return result


def objects_present(repo: Path, shas: list[str]) -> set[str]:
    unique = sorted(set(shas))
    if not unique:
        return set()
    try:
        out = _git(repo, ["cat-file", "--batch-check"], "".join(s + "\n" for s in unique))
    except subprocess.CalledProcessError:
        return set()
    return {line.split()[0] for line in out.splitlines() if line and not line.endswith(" missing")}


def blobs_at(repo: Path, specs: list[str]) -> dict[str, str | None]:
    """Map each "<commit>:<path>" spec to the blob sha it names, or None if it doesn't exist."""
    unique = sorted(set(specs))
    if not unique:
        return {}
    try:
        out = _git(repo, ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
                   "".join(s + "\n" for s in unique))
    except subprocess.CalledProcessError:
        return dict.fromkeys(unique)
    result: dict[str, str | None] = {}
    for spec, line in zip(unique, out.splitlines()):
        sha, _, kind = line.partition(" ")
        result[spec] = sha if kind == "blob" else None
    return result


# --------------------------------------------------------------------------- paths


def _display(path: Path, repo: Path) -> str:
    try:
        return path.relative_to(repo).as_posix() or "."
    except ValueError:
        return str(path)


def _normalise_rel(value: str) -> tuple[str | None, str | None]:
    """Return (normalised repo-relative posix path, None) or (None, reason)."""
    if not value:
        return None, "is empty"
    if "\n" in value or "\0" in value or "\r" in value:
        return None, "contains a control character"
    if "\\" in value:
        return None, "uses backslashes; paths must be posix"
    if value.startswith("/") or re.match(r"[A-Za-z]:", value):
        return None, "is absolute; paths must be repo-relative"
    norm = posixpath.normpath(value)
    if norm == ".." or norm.startswith("../"):
        return None, "escapes the repository"
    if norm == ".":
        return None, "names the repository root"
    return norm, None


def _is_source_like(rel: str) -> bool:
    name = posixpath.basename(rel)
    suffix = posixpath.splitext(name)[1]
    if suffix in CODE_SUFFIXES:
        return True
    parents = rel.split("/")[:-1]
    return suffix in FIXTURE_SUFFIXES and name != PROVENANCE_NAME and bool(
        FIXTURE_DIRS.intersection(parents))


def _named_in(texts: list[str], candidates: list[str]) -> bool:
    for cand in candidates:
        # not preceded by a path character; not followed by one (a trailing "." is fine)
        pattern = re.compile(r"(?<![\w./-])" + re.escape(cand) + r"(?![\w/-]|\.[\w/-])")
        if any(pattern.search(text) for text in texts):
            return True
    return False


def _iter_package_files(pkg_dir: Path) -> list[str]:
    found: list[str] = []
    for root, dirs, files in os.walk(pkg_dir):
        here = Path(root)
        dirs[:] = sorted(
            d for d in dirs
            if not d.startswith(".") and d not in PRUNE_DIRS
            and not (here / d / PROVENANCE_NAME).is_file()
        )
        for name in files:
            found.append((here / name).relative_to(pkg_dir).as_posix())
    return sorted(found)


def find_provenance_files(staging: Path) -> list[Path]:
    found: list[Path] = []
    for root, dirs, files in os.walk(staging):
        dirs[:] = sorted(d for d in dirs if not d.startswith(".") and d not in PRUNE_DIRS)
        if PROVENANCE_NAME in files:
            found.append(Path(root) / PROVENANCE_NAME)
    return sorted(found)


# --------------------------------------------------------------------------- parsing


def _reject_duplicates(pairs: list[tuple[str, object]]) -> dict:
    seen: dict[str, object] = {}
    for key, value in pairs:
        if key in seen:
            raise _DuplicateKeyError(key)
        seen[key] = value
    return seen


def _load_json(path: Path, report: PackageReport) -> object | None:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        report.add("ERROR", "unreadable", f"cannot read provenance: {exc}")
        return None
    try:
        return json.loads(text, object_pairs_hook=_reject_duplicates)
    except _DuplicateKeyError as exc:
        report.add("ERROR", "schema", f"duplicate JSON key {str(exc)!r}")
    except json.JSONDecodeError as exc:
        report.add("ERROR", "invalid_json",
                   f"malformed JSON: {exc.msg} (line {exc.lineno}, column {exc.colno})")
    return None


def _string_list(data: dict, key: str, report: PackageReport) -> list[str]:
    value = data.get(key)
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        report.add("ERROR", "schema", f"{key!r} must be a list of strings")
        return []
    return value


def _parse_entry(index: int, raw: object, report: PackageReport) -> Entry | None:
    where = f"files[{index}]"
    if not isinstance(raw, dict):
        report.add("ERROR", "schema", f"{where} must be an object")
        return None
    staged_raw = raw.get("staged") if isinstance(raw.get("staged"), str) else None
    subject = {"staged": staged_raw} if staged_raw else {}
    for key in sorted(set(raw) - set(ENTRY_KEYS) - set(OPTIONAL_ENTRY_KEYS)):
        report.add("INFO", "unknown_key", f"{where} has unknown key {key!r}", **subject)
    source_ref = raw.get("source_ref")
    if source_ref is not None and not (isinstance(source_ref, str) and source_ref.strip()):
        report.add("ERROR", "schema", f"{where}.source_ref must be a non-empty string", **subject)
        return None
    source_commit = raw.get("source_commit")
    if source_commit is not None and not (isinstance(source_commit, str)
                                          and SHA_RE.match(source_commit)):
        report.add("ERROR", "schema",
                   f"{where}.source_commit {source_commit!r} is not a lowercase hex git sha",
                   **subject)
        return None
    problems: list[str] = []
    missing = [k for k in ENTRY_KEYS if k not in raw]
    if missing:
        problems.append("missing " + ", ".join(repr(k) for k in missing))
    wrong = [k for k in ENTRY_KEYS if k in raw and not isinstance(raw[k], str)]
    if wrong:
        problems.append("non-string " + ", ".join(repr(k) for k in wrong))
    blob, relation = raw.get("source_blob"), raw.get("relation")
    if isinstance(blob, str) and not SHA_RE.match(blob):
        problems.append(f"source_blob {blob!r} is not a lowercase hex git sha")
    if isinstance(relation, str) and relation not in RELATIONS:
        problems.append(f"relation {relation!r} is not one of {', '.join(RELATIONS)}")
    paths: dict[str, str] = {}
    for key in ("staged", "source"):
        if isinstance(raw.get(key), str):
            norm, reason = _normalise_rel(raw[key])
            if norm is None:
                report.add("ERROR", "path_invalid", f"{where}.{key} {raw[key]!r} {reason}",
                           **subject)
            else:
                paths[key] = norm
    if problems:
        report.add("ERROR", "schema", f"{where}: " + "; ".join(problems), **subject)
    if problems or len(paths) != 2:
        return None
    return Entry(paths["staged"], paths["source"], blob, relation, source_commit, source_ref)


def plan_package(repo: Path, prov: Path) -> _Plan:
    pkg_dir = prov.parent
    report = PackageReport(_display(prov, repo), _display(pkg_dir, repo))
    plan = _Plan(report, pkg_dir, [], set(), [], [])
    data = _load_json(prov, report)
    if data is None:
        return plan
    if not isinstance(data, dict):
        report.add("ERROR", "schema", "top level must be a JSON object")
        return plan
    for key in sorted(set(data) - set(TOP_KEYS) - set(OPTIONAL_TOP_KEYS)):
        report.add("INFO", "unknown_key", f"unknown top-level key {key!r}")
    missing = [k for k in TOP_KEYS if k not in data]
    if missing:
        report.add("ERROR", "schema", "missing top-level " + ", ".join(repr(k) for k in missing))
    package = data.get("package")
    if isinstance(package, str) and package:
        report.package = package
    elif "package" in data:
        report.add("ERROR", "schema", "'package' must be a non-empty string")
    commit = data.get("source_commit")
    if "source_commit" in data and not (isinstance(commit, str) and SHA_RE.match(commit)):
        report.add("ERROR", "schema", f"source_commit {commit!r} is not a lowercase hex git sha")
    if "divergences" in data:
        plan.divergences = _string_list(data, "divergences", report)
    if "new_files" in data:
        plan.new_files = _string_list(data, "new_files", report)
    files = data.get("files")
    if not isinstance(files, list):
        if "files" in data:
            report.add("ERROR", "schema", "'files' must be a list")
        return plan
    report.entries = len(files)
    plan.scan_untracked = True
    seen: set[tuple[str, str]] = set()
    relations_by_staged: dict[str, set[str]] = {}
    for index, raw in enumerate(files):
        entry = _parse_entry(index, raw, report)
        if entry is None:
            # still claim the path so a broken entry is not re-reported as untracked
            if isinstance(raw, dict) and isinstance(raw.get("staged"), str):
                norm, _ = _normalise_rel(raw["staged"])
                if norm is not None:
                    _claim(plan, repo, norm)
            continue
        # One staged file may merge several sources, but only as an adapted copy.
        key = (entry.staged, entry.source)
        earlier = relations_by_staged.get(entry.staged, set())
        if key in seen or (earlier and "verbatim" in earlier | {entry.relation}):
            report.add("ERROR", "duplicate_entry",
                       f"files[{index}] repeats a staged path listed earlier", staged=entry.staged)
            continue
        seen.add(key)
        relations_by_staged.setdefault(entry.staged, set()).add(entry.relation)
        plan.entries.append(entry)
        _claim(plan, repo, entry.staged)
    return plan


def _claim(plan: _Plan, repo: Path, staged: str) -> None:
    target = Path(posixpath.normpath(str(repo / staged)))
    if target.is_relative_to(plan.pkg_dir):
        plan.claimed.add(target.relative_to(plan.pkg_dir).as_posix())


# --------------------------------------------------------------------------- checks


def _short(sha: str | None) -> str:
    return sha[:12] if sha else "?"


def _check_entry(plan: _Plan, repo: Path, entry: Entry, hashes: dict[str, str | None],
                 present: set[str], pinned: dict[str, str | None]) -> None:
    report = plan.report
    ids = {"staged": entry.staged, "source": entry.source}
    staged_abs = Path(posixpath.normpath(str(repo / entry.staged)))
    if not staged_abs.is_relative_to(plan.pkg_dir):
        report.add("ERROR", "staged_outside_package",
                   f"staged path is outside the package directory {report.directory}", **ids)
    elif staged_abs.exists() and not staged_abs.resolve().is_relative_to(plan.pkg_dir.resolve()):
        report.add("ERROR", "staged_outside_package",
                   f"staged path resolves (symlink) outside {report.directory}", **ids)

    staged_ok = staged_abs.is_file()
    if not staged_ok:
        what = "is not a regular file" if staged_abs.exists() else "is missing"
        report.add("ERROR", "staged_missing", f"staged file {what}", **ids)

    source_abs = repo / entry.source
    source_hash = hashes.get(entry.source) if source_abs.is_file() else None
    if not source_abs.exists() and entry.source_commit:
        label = entry.source_ref or entry.source_commit[:12]
        at_commit = pinned.get(f"{entry.source_commit}:{entry.source}")
        if at_commit == entry.blob:
            report.add("INFO", "source_external",
                       f"source {entry.source} is not on this branch; verified at "
                       f"{entry.source_commit[:12]} ({label})", expected=entry.blob, **ids)
        else:
            report.add("ERROR", "source_pin_mismatch",
                       f"source {entry.source} at {entry.source_commit[:12]} ({label}) is "
                       f"{_short(at_commit) if at_commit else 'absent'}, recorded "
                       f"{_short(entry.blob)}", expected=entry.blob, actual=at_commit, **ids)
    elif not source_abs.is_file():
        what = "is not a regular file" if source_abs.exists() else "is missing from the work tree"
        known = "is" if entry.blob in present else "is not"
        report.add("ERROR", "source_missing",
                   f"source {entry.source} {what} (recorded blob {_short(entry.blob)} {known} "
                   "in the object store)", expected=entry.blob, **ids)
    elif source_hash is None:
        report.add("ERROR", "unreadable", f"git hash-object failed for source {entry.source}",
                   **ids)
    elif source_hash != entry.blob:
        todo = ("re-copy it and update source_blob" if entry.relation == "verbatim"
                else "port the change into the adapted copy and update source_blob")
        report.add("DRIFT", "source_changed",
                   f"source changed since staging: {entry.source} (recorded "
                   f"{_short(entry.blob)}, now {_short(source_hash)}); {todo}",
                   expected=entry.blob, actual=source_hash, **ids)

    if entry.relation == "verbatim" and staged_ok:
        staged_hash = hashes.get(entry.staged)
        if staged_hash is None:
            report.add("ERROR", "unreadable", "git hash-object failed for the staged copy", **ids)
        elif staged_hash != entry.blob:
            hint = ("; it matches the current source, so only source_blob is stale"
                    if staged_hash == source_hash else "")
            report.add("DRIFT", "verbatim_edited",
                       f"verbatim copy edited: hashes to {_short(staged_hash)}, source_blob is "
                       f"{_short(entry.blob)}{hint}",
                       expected=entry.blob, actual=staged_hash, **ids)


def _check_untracked(plan: _Plan, repo: Path) -> None:
    patterns = [p[2:] if p.startswith("./") else p for p in plan.new_files]
    prefix = _display(plan.pkg_dir, repo)
    for rel in _iter_package_files(plan.pkg_dir):
        if rel in plan.claimed or not _is_source_like(rel):
            continue
        repo_rel = f"{prefix}/{rel}"
        forms = [rel, repo_rel]
        if any(fnmatch.fnmatchcase(form, pat) for form in forms for pat in patterns):
            continue
        named = _named_in(plan.divergences, forms)
        if named and TEST_DIRS.intersection(rel.split("/")[:-1]):
            continue
        hint = "; it is named in divergences, list it in new_files" if named else ""
        plan.report.add("INFO", "untracked_staged",
                        f"staged file has no provenance entry{hint}", staged=repo_rel)


def run_check(repo: Path, staging: Path) -> list[PackageReport]:
    plans = [plan_package(repo, prov) for prov in find_provenance_files(staging)]
    to_hash: list[str] = []
    for plan in plans:
        for entry in plan.entries:
            if (repo / entry.source).is_file():
                to_hash.append(entry.source)
            if entry.relation == "verbatim" and (repo / entry.staged).is_file():
                to_hash.append(entry.staged)
    hashes = hash_objects(repo, to_hash)
    off_branch = [e for p in plans for e in p.entries if not (repo / e.source).is_file()]
    present = objects_present(repo, [e.blob for e in off_branch])
    pinned = blobs_at(repo, [f"{e.source_commit}:{e.source}" for e in off_branch
                             if e.source_commit])
    for plan in plans:
        for entry in plan.entries:
            _check_entry(plan, repo, entry, hashes, present, pinned)
        if plan.scan_untracked:
            _check_untracked(plan, repo)
        plan.report.findings.sort(key=Finding.sort_key)
    return [plan.report for plan in plans]


# --------------------------------------------------------------------------- output


def exit_code(reports: list[PackageReport]) -> int:
    return EXIT_PROBLEMS if any(r.failed for r in reports) else EXIT_OK


def _totals(reports: list[PackageReport]) -> dict:
    totals = {"packages": len(reports), "entries": sum(r.entries for r in reports)}
    for sev in SEVERITIES:
        totals[sev.lower()] = sum(r.count(sev) for r in reports)
    return totals


def render_json(repo: Path, staging: Path, reports: list[PackageReport]) -> str:
    code = exit_code(reports)
    doc = {
        "tool": "check_drift", "schema_version": 1,
        "repo": str(repo), "staging": _display(staging, repo),
        "exit_code": code, "ok": code == EXIT_OK,
        "totals": _totals(reports),
        "packages": [r.to_dict() for r in reports],
    }
    return json.dumps(doc, indent=2) + "\n"


def render_text(repo: Path, staging: Path, reports: list[PackageReport]) -> str:
    lines: list[str] = []
    for r in reports:
        for f in r.findings:
            lines.append(f"{f.severity:<5}  {f.staged or r.provenance}: {f.message}")
    if lines:
        lines.append("")
    if not reports:
        lines.append(f"no {PROVENANCE_NAME} found under {_display(staging, repo)}")
    for r in reports:
        label = r.package or "?"
        lines.append(
            f"{'FAIL' if r.failed else 'ok':<4}  {r.directory}  ({label})  entries={r.entries} "
            f"drift={r.count('DRIFT')} error={r.count('ERROR')} info={r.count('INFO')}")
    t = _totals(reports)
    lines.append(
        f"total: {t['packages']} package(s), {t['entries']} entries, {t['drift']} drift, "
        f"{t['error']} error, {t['info']} info -> exit {exit_code(reports)}")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--repo", default=".", help="git work tree the provenance paths are "
                    "relative to (default: the work tree containing the current directory)")
    ap.add_argument("--staging", help="directory searched for PROVENANCE.json files "
                    "(default: <repo>/staging)")
    ap.add_argument("--json", action="store_true", help="emit a machine-readable JSON report")
    args = ap.parse_args(argv)
    try:
        repo = repo_toplevel(Path(args.repo).resolve())
        staging = Path(args.staging).resolve() if args.staging else repo / "staging"
        if not staging.is_dir():
            raise FatalError(f"staging directory not found: {staging}")
        reports = run_check(repo, staging)
    except FatalError as exc:
        print(f"check_drift: {exc}", file=sys.stderr)
        if args.json:
            sys.stdout.write(json.dumps({"tool": "check_drift", "schema_version": 1,
                                         "exit_code": EXIT_FATAL, "ok": False,
                                         "fatal": str(exc)}, indent=2) + "\n")
        return EXIT_FATAL
    render = render_json if args.json else render_text
    sys.stdout.write(render(repo, staging, reports))
    return exit_code(reports)


if __name__ == "__main__":
    sys.exit(main())
