#!/usr/bin/env python3
"""Render docs/parity.md, the block-list parity page (gate G3 evidence).

    python3 tools/render_parity.py           write docs/parity.md
    python3 tools/render_parity.py --check   write nothing; exit 1 if docs/parity.md is stale

Inputs, all read-only and relative to the root that holds policy/ and vectors/:

    policy/blocklist.v1.json   every entry, its python/ts columns and the profile in force
    policy/gen_python.py       imported for load() (schema validation), is_on() and
                               excluded(), so this page and the generated tables cannot
                               disagree about what an entry means
    vectors/DIFFERENCES.md     its "Summary by range" table and the counts its text states
    vectors/ssrf-vectors.json  the recorded verdicts, to cross-check those counts

The root is found from this file's location: its parent directory (repository layout,
tools/render_parity.py) or the parent's parent (staging layout, repo-skeleton/tools/).
Stdlib only. The output has no timestamps and no absolute paths, so a fresh render is
byte-identical to the committed page until an input changes; each input's SHA-256 is in
the page header, so any edit to an input (a rationale too) makes the page stale.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import ipaddress
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any

HERE = Path(__file__).resolve().parent
POLICY = "policy/blocklist.v1.json"
GENERATOR = "policy/gen_python.py"
DIFFERENCES = "vectors/DIFFERENCES.md"
CORPUS = "vectors/ssrf-vectors.json"
LANGS = ("python", "ts")
LABEL = {"python": "Python", "ts": "TS"}
STRICTEST = "strictest-wins"
SUMMARY_HEADING = "## Summary by range"
SUMMARY_HEADER = ["Group", "Range / rule", "Vectors", "Python", "TS", "Strictest wins"]

_TOTAL = re.compile(r"Of (\d+) vectors, \*\*(\d+) differ\*\*")
_STRICTER = re.compile(r"Python is the stricter side on (\d+) vectors, and TS on (\d+)")
_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_LEADING_INT = re.compile(r"(\d+)")


class RenderError(ValueError):
    """An input is missing or does not have the shape this renderer reads."""


@dataclass(frozen=True)
class GroupRow:
    group: str
    rule: str
    vectors: int
    python: str
    ts: str
    strictest: str


@dataclass(frozen=True)
class Differences:
    total: int
    differ: int
    prose_stricter: tuple[int, int] | None  # (Python stricter, TS stricter) as the text says
    rows: tuple[GroupRow, ...]


def default_root() -> Path:
    for candidate in (HERE.parent, HERE.parent.parent):
        if (candidate / POLICY).is_file():
            return candidate
    raise RenderError(f"no {POLICY} above {HERE}; pass --root")


def default_out() -> Path:
    return HERE.parent / "docs" / "parity.md"


def _read(root: Path, rel: str) -> bytes:
    try:
        return (root / rel).read_bytes()
    except OSError as exc:
        raise RenderError(f"cannot read {rel}: {exc.strerror or exc}") from None


def _load_generator(root: Path) -> ModuleType:
    path = root / GENERATOR
    spec = importlib.util.spec_from_file_location("_parity_gen_python", path)
    if spec is None or spec.loader is None or not path.is_file():
        raise RenderError(f"cannot import {GENERATOR}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _cell(text: str) -> str:
    return " ".join(text.split()).replace("|", "\\|")


def _cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def parse_differences(text: str) -> Differences:
    """Read the counts and the summary table out of vectors/DIFFERENCES.md."""
    total = _TOTAL.search(text)
    if total is None:
        raise RenderError(f"{DIFFERENCES}: no 'Of N vectors, **M differ**' sentence")
    stricter = _STRICTER.search(text)
    lines = text.splitlines()
    if SUMMARY_HEADING not in lines:
        raise RenderError(f"{DIFFERENCES}: no '{SUMMARY_HEADING}' heading")
    table: list[str] = []
    for line in lines[lines.index(SUMMARY_HEADING) + 1:]:
        if line.startswith("|"):
            table.append(line)
        elif table or line.startswith("#"):
            break
    if len(table) < 3 or _cells(table[0]) != SUMMARY_HEADER:
        raise RenderError(f"{DIFFERENCES}: the summary table must have the columns "
                          f"{SUMMARY_HEADER}")
    rows = []
    for line in table[2:]:
        cells = _cells(line)
        count = _LEADING_INT.match(cells[2]) if len(cells) == len(SUMMARY_HEADER) else None
        if count is None:
            raise RenderError(f"{DIFFERENCES}: summary row not understood: {line!r}")
        group = _LINK.sub(r"\1", cells[0])
        rows.append(GroupRow(group, cells[1], int(count.group(1)), cells[3], cells[4],
                             cells[5]))
    return Differences(
        total=int(total.group(1)),
        differ=int(total.group(2)),
        prose_stricter=(int(stricter.group(1)), int(stricter.group(2))) if stricter else None,
        rows=tuple(rows),
    )


def corpus_counts(corpus: dict[str, Any]) -> dict[str, int]:
    vectors = corpus.get("vectors")
    if not isinstance(vectors, list):
        raise RenderError(f"{CORPUS}: no 'vectors' list")
    counts = {"total": len(vectors), "differ": 0, "python_stricter": 0, "ts_stricter": 0}
    for vector in vectors:
        expected = vector.get("expected", {}) if isinstance(vector, dict) else {}
        py, ts = expected.get("python"), expected.get("ts")
        if py not in ("block", "allow") or ts not in ("block", "allow"):
            raise RenderError(f"{CORPUS}: vector {vector!r:.60} has no recorded verdicts")
        if py != ts:
            counts["differ"] += 1
            counts["python_stricter" if py == "block" else "ts_stricter"] += 1
    return counts


def _shadowing(doc: dict[str, Any], entry: dict[str, Any], lang: str, profile: str,
               gen: ModuleType) -> list[str]:
    """Block entries that cover exactly a decode entry's prefix (policy/README.md rule 3)."""
    net = ipaddress.ip_network(entry["cidr"])
    return [
        e["id"] for e in doc["entries"]
        if e["family"] == "ipv6" and e["effect"] == "block"
        and ipaddress.ip_network(e["cidr"]) == net and gen.is_on(e, lang, profile)
    ]


def entry_state(doc: dict[str, Any], entry: dict[str, Any], lang: str, profile: str,
                gen: ModuleType) -> str:
    """What ``lang`` does with ``entry`` under ``profile``, in a few words."""
    if not gen.is_on(entry, lang, profile):
        return "off"
    if entry["effect"] != "decode":
        return str(entry["effect"])
    shadow = _shadowing(doc, entry, lang, profile, gen)
    if shadow:
        return f"decode, shadowed by `{shadow[0]}`"
    skipped = sorted(gen.excluded(entry, lang, profile))
    if skipped:
        return "decode, skips " + ", ".join(f"`{s}`" for s in skipped)
    return "decode"


def _target(entry: dict[str, Any]) -> str:
    if "cidr" in entry:
        return f"`{entry['cidr']}`"
    if "name_suffix" in entry:
        return f"`*{entry['name_suffix']}`"
    return f"`{entry['name']}`"


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def render(root: Path) -> str:
    policy_bytes = _read(root, POLICY)
    diff_bytes = _read(root, DIFFERENCES)
    corpus_bytes = _read(root, CORPUS)
    gen = _load_generator(root)
    try:
        doc = gen.load(policy_bytes.decode("utf-8"))
    except gen.PolicyError as exc:
        raise RenderError(f"{POLICY}: {exc}") from None
    try:
        corpus = json.loads(corpus_bytes.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise RenderError(f"{CORPUS}: not JSON: {exc}") from None
    diffs = parse_differences(diff_bytes.decode("utf-8"))
    counts = corpus_counts(corpus)
    profile = doc["profile"]
    entries = doc["entries"]

    rows: list[str] = []
    agree = 0
    moves: dict[str, list[str]] = {lang: [] for lang in LANGS}
    for number, entry in enumerate(entries, 1):
        now = {lang: entry_state(doc, entry, lang, profile, gen) for lang in LANGS}
        strict = {lang: entry_state(doc, entry, lang, STRICTEST, gen) for lang in LANGS}
        if strict["python"] != strict["ts"]:
            raise RenderError(f"{entry['id']}: strictest-wins is not symmetric: {strict}")
        agree += now["python"] == now["ts"]
        moved = []
        for lang in LANGS:
            if now[lang] != strict[lang]:
                moves[lang].append(entry["id"])
                moved.append(f"{LABEL[lang]}: {now[lang]} → {strict[lang]}")
        rows.append("| " + " | ".join([
            str(number), f"`{entry['id']}`", entry["family"], entry["effect"], _target(entry),
            now["python"], now["ts"], strict["python"], "; ".join(moved) or "-",
            _cell("; ".join(entry["refs"])),
        ]) + " |")

    def tally(key: str) -> str:
        found: dict[str, int] = {}
        for entry in entries:
            found[entry[key]] = found.get(entry[key], 0) + 1
        return ", ".join(f"{name} {count}" for name, count in found.items())

    out = [
        "<!-- GENERATED by tools/render_parity.py: do not edit. "
        "Regenerate: python3 tools/render_parity.py -->",
        f"<!-- {POLICY} sha256 {_sha256(policy_bytes)} -->",
        f"<!-- {DIFFERENCES} sha256 {_sha256(diff_bytes)} -->",
        f"<!-- {CORPUS} sha256 {_sha256(corpus_bytes)} -->",
        "",
        "# Block-list parity: Python and TypeScript",
        "",
        f"Every entry of [`{POLICY}`](../{POLICY}) (schema {doc['schema_version']}, "
        f"{len(entries)} entries), the table both languages' SSRF guards are generated from, "
        "with what each language enforces today and what the `strictest-wins` profile would "
        "make both enforce. The vector counts at the end come from "
        f"[`{DIFFERENCES}`](../{DIFFERENCES}) and are cross-checked against the recorded "
        f"verdicts in [`{CORPUS}`](../{CORPUS}). Entry semantics: "
        "[`policy/README.md`](../policy/README.md).",
        "",
        f"Profile in force: **`{profile}`**. "
        + ("Each language reads its own column, so this page records current behaviour; "
           "it is not a decision about the v1 default."
           if profile != STRICTEST else
           "Both languages enforce the same entries."),
        "",
        "## How to read the columns",
        "",
        "- **Python**, **TS**: what that language does with the entry under the profile in "
        "force. `block` and `exempt` (a carve-out from the block entries) are in force; "
        "`decode` judges an embedded IPv4 by its last 32 bits; `off` is not in force.",
        "- **Strictest wins**: what both languages would do under `profile: "
        "\"strictest-wins\"`. A block or decode entry is in force if either column is true, "
        "an exemption only if both are, and a decode skips only the entries both columns "
        "skip.",
        "- *shadowed*: a block entry with exactly the decode entry's prefix is in force, and "
        "it wins (policy/README.md, matching rule 3), so the decode never runs.",
        "- **Moves**: the language whose behaviour changes if the profile is switched.",
        "",
        "## Summary",
        "",
        "| Count | Value |",
        "|---|---|",
        f"| Entries | {len(entries)} ({tally('family')}) |",
        f"| By effect | {tally('effect')} |",
        f"| Python and TS columns agree | {agree} of {len(entries)} |",
        f"| Entries `strictest-wins` changes for Python | {len(moves['python'])} |",
        f"| Entries `strictest-wins` changes for TS | {len(moves['ts'])} |",
        "",
        "## Every entry",
        "",
        "| # | Id | Family | Effect | Range / name | Python | TS | Strictest wins | Moves | Refs |",
        "|---|---|---|---|---|---|---|---|---|---|",
        *rows,
        "",
    ]
    out += _render_corpus(diffs, counts)
    return "\n".join(out) + "\n"


def _render_corpus(diffs: Differences, counts: dict[str, int]) -> list[str]:
    differing = [r for r in diffs.rows if r.python != r.ts]
    table = {
        "differ": sum(r.vectors for r in differing),
        "python_stricter": sum(r.vectors for r in differing
                               if r.python == "block" and r.ts == "allow"),
        "ts_stricter": sum(r.vectors for r in differing
                           if r.ts == "block" and r.python == "allow"),
    }
    prose = diffs.prose_stricter
    checks = [
        ("Vectors in the corpus", counts["total"], None, diffs.total),
        ("Python and TS differ", counts["differ"], table["differ"], diffs.differ),
        ("Python blocks, TS allows", counts["python_stricter"], table["python_stricter"],
         prose[0] if prose else None),
        ("TS blocks, Python allows", counts["ts_stricter"], table["ts_stricter"],
         prose[1] if prose else None),
    ]
    closed = [r for r in differing if r.strictest.startswith("block")]
    parser = [r for r in differing if r.strictest.startswith("reject")]
    other = [r for r in differing if r not in closed and r not in parser]

    def show(value: int | None) -> str:
        return "-" if value is None else str(value)

    out = [
        "## Shared-corpus differences",
        "",
        f"From the summary table of [`{DIFFERENCES}`](../{DIFFERENCES}), one row per group "
        "of vectors on which the languages differ (or used to).",
        "",
        "| Group | Range / rule | Vectors | Python | TS | Strictest wins |",
        "|---|---|---|---|---|---|",
    ]
    for r in diffs.rows:
        link = f"[{r.group}](../{DIFFERENCES}#{r.group})"
        out.append("| " + " | ".join([link, _cell(r.rule), str(r.vectors), r.python, r.ts,
                                      _cell(r.strictest)]) + " |")
    out += [
        "",
        "### Do the counts agree?",
        "",
        f"`{CORPUS}` is what both test suites assert; the other two columns are what "
        f"`{DIFFERENCES}` says. A `NO` means that file needs updating.",
        "",
        f"| Count | `{CORPUS}` | summary table | text | Agree |",
        "|---|---|---|---|---|",
    ]
    for label, corpus_value, table_value, text_value in checks:
        stated = {v for v in (corpus_value, table_value, text_value) if v is not None}
        out.append(f"| {label} | {corpus_value} | {show(table_value)} | {show(text_value)} | "
                   f"{'yes' if len(stated) == 1 else '**NO**'} |")
    out += [
        "",
        "### What the block list can close",
        "",
        f"`{DIFFERENCES}` writes `block` in the *Strictest wins* column for a range rule (an "
        "entry above) and `reject` for a URL-parser rule, which is not in the block list. "
        "Read that way:",
        "",
        "| | Vectors |",
        "|---|---|",
        f"| Closed by `strictest-wins` (range rules) | "
        f"{sum(r.vectors for r in closed)} |",
        f"| of which Python verdicts move (allow → block) | "
        f"{sum(r.vectors for r in closed if r.python == 'allow')} |",
        f"| of which TS verdicts move (allow → block) | "
        f"{sum(r.vectors for r in closed if r.ts == 'allow')} |",
        f"| Left to URL-parser rules | {sum(r.vectors for r in parser)} "
        f"({', '.join(r.group for r in parser) or 'none'}) |",
    ]
    if other:
        out.append(f"| Not classified | {sum(r.vectors for r in other)} "
                   f"({', '.join(r.group for r in other)}) |")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="exit 1 if the page is out of date")
    ap.add_argument("--root", type=Path, help="directory holding policy/ and vectors/")
    ap.add_argument("--out", type=Path, help="the page (default: ../docs/parity.md)")
    args = ap.parse_args(argv)
    out = args.out or default_out()
    try:
        wanted = render(args.root or default_root())
    except RenderError as exc:
        print(f"render_parity: {exc}", file=sys.stderr)
        return 2
    current = out.read_bytes().decode("utf-8") if out.exists() else None
    if args.check:
        if current != wanted:
            print(f"{out} is out of date: run tools/render_parity.py", file=sys.stderr)
            return 1
        return 0
    if current != wanted:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(wanted.encode("utf-8"))
        print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
