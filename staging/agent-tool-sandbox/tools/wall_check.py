#!/usr/bin/env python3
"""G12 wall-check: find source-project names and private paths in the publishable files.

Scans the files of the two staged packages that would ship or be imported into the public
repository, and prints every line that names the project they were lifted from (or its
parts and processes), a ticket number, or a private path:

    python/  src/**, README.md, pyproject.toml, MANIFEST.in
    ts/      src/**, README.md, package.json, tsconfig.json, tsconfig.build.json

Not scanned: PROVENANCE.json (it stays private, in the source repository) and the
parity-in-tree tests (tests/test_parity_in_tree.py, test/parity-in-tree.test.ts), which
import the in-tree code and must stay while the code lives there. ``--tests`` adds every
other test file (they go into the import commit, so G12 covers them too).

Terms (case-insensitive): see TERMS. The hosting-provider names are stored rot13 so that
this file does not name the provider in plain text if it is copied into the public repo;
``--show-terms`` prints them decoded.

Output: ``path:line: [term, ...] text`` per matching line, then the count per file and the
total. Exit status 1 when anything matched, 0 when clean, 2 on a usage error. Report-only:
it never edits a file. Stdlib only.

Usage: wall_check.py [--root DIR] [--tests] [--show-terms]

Hits at 2026-11-26 (publishable files only): 17 matching lines in 4 files. Clearing them
belongs to the import commit, not to this tool:

    python/README.md          6   divergence notes naming the reference jail's env/paths
    ts/README.md              8   staged-copy notes, in-tree paths, a PR number, license
    ts/package.json           1   description ends "Staged from <project>."
    ts/src/hardened-fetch.ts  2   header comment naming the in-tree source file

By term: alienclaw 10, openclaw 5, leaderboard 4, pr # 2; none for pkt-, genome, martian,
packet, /home/, ~/dev or the hosting provider (a line can carry several terms).
With ``--tests``: 37 lines in 11 files, i.e. 20 more in 7 test files (python
test_file_boundary.py 4, test_url_fetch_ssrf_cgnat.py 1; ts ssrf-vectors 6, fs-jail 3,
jail-ssrf 3, hardening 2, cgnat 1).
"""
from __future__ import annotations

import argparse
import codecs
import re
import sys
from collections import Counter
from pathlib import Path

# Hosting-provider names, rot13 (see the module docstring).
_PROVIDERS_ROT13 = ("ubfgvatre", "ufgte")

TERMS: tuple[str, ...] = (
    "alienclaw",
    "openclaw",
    "pkt-",
    "leaderboard",
    "genome",
    "martian",
    "packet",
    "pr #",
    "/home/",
    "~/dev",
    *(codecs.decode(name, "rot13") for name in _PROVIDERS_ROT13),
)
_PROVIDER_TERMS = frozenset(codecs.decode(name, "rot13") for name in _PROVIDERS_ROT13)
_PATTERN = re.compile("|".join(re.escape(term) for term in TERMS), re.IGNORECASE)

PUBLISHABLE: dict[str, tuple[str, ...]] = {
    "python": ("src/**/*", "README.md", "pyproject.toml", "MANIFEST.in"),
    "ts": ("src/**/*", "README.md", "package.json", "tsconfig.json", "tsconfig.build.json"),
}
TESTS: dict[str, tuple[str, ...]] = {"python": ("tests/**/*",), "ts": ("test/**/*",)}
NEVER: frozenset[str] = frozenset({
    "python/PROVENANCE.json",
    "ts/PROVENANCE.json",
    "python/tests/test_parity_in_tree.py",
    "ts/test/parity-in-tree.test.ts",
})
_SKIP_DIRS = frozenset({"__pycache__", "node_modules", "dist", "build", ".hypothesis"})


def _files(root: Path, include_tests: bool) -> list[Path]:
    found: set[Path] = set()
    for package, globs in PUBLISHABLE.items():
        patterns = globs + (TESTS[package] if include_tests else ())
        for pattern in patterns:
            for path in (root / package).glob(pattern):
                rel = path.relative_to(root)
                if (path.is_file() and rel.as_posix() not in NEVER
                        and not _SKIP_DIRS.intersection(rel.parts)
                        and not any(part.endswith(".egg-info") for part in rel.parts)
                        and rel.suffix != ".pyc"):
                    found.add(path)
    return sorted(found)


def _label(term: str) -> str:
    return "hosting provider" if term in _PROVIDER_TERMS else term


def scan(root: Path, include_tests: bool = False) -> tuple[list[str], Counter, Counter]:
    """(report lines, matching lines per file, matching lines per term)."""
    report: list[str] = []
    per_file: Counter = Counter()
    per_term: Counter = Counter()
    for path in _files(root, include_tests):
        rel = path.relative_to(root).as_posix()
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError) as exc:
            report.append(f"{rel}: unreadable ({exc.__class__.__name__}), not scanned")
            continue
        for number, line in enumerate(text.splitlines(), 1):
            terms = sorted({_label(m.group(0).lower()) for m in _PATTERN.finditer(line)})
            if not terms:
                continue
            per_file[rel] += 1
            per_term.update(terms)
            shown = line.strip()
            if len(shown) > 160:
                shown = shown[:157] + "..."
            report.append(f"{rel}:{number}: [{', '.join(terms)}] {shown}")
    return report, per_file, per_term


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent,
                        help="the directory holding python/ and ts/ (default: this tool's ..)")
    parser.add_argument("--tests", action="store_true",
                        help="also scan the test files (not the parity-in-tree tests)")
    parser.add_argument("--show-terms", action="store_true", help="print the terms and exit")
    args = parser.parse_args(argv)
    if args.show_terms:
        print("\n".join(TERMS))
        return 0
    root = args.root.resolve()
    if not all((root / package).is_dir() for package in PUBLISHABLE):
        print(f"wall_check: {root} does not hold python/ and ts/", file=sys.stderr)
        return 2
    report, per_file, per_term = scan(root, args.tests)
    for line in report:
        print(line)
    if per_file:
        print()
        width = max(len(rel) for rel in per_file)
        for rel, count in sorted(per_file.items()):
            print(f"{rel:<{width}}  {count}")
    labels = dict.fromkeys(_label(term) for term in TERMS)
    print("by term: " + ", ".join(f"{label} {per_term[label]}" for label in labels))
    total = sum(per_file.values())
    print(f"wall_check: {total} matching line(s) in {len(per_file)} file(s)")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
