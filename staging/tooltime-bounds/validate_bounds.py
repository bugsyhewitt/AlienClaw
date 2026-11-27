#!/usr/bin/env python3
"""Validate the proposed ``params.<name>.bounds`` extension in ToolTime tool.yaml files.

The extension is additive: a tool.yaml with no ``bounds`` anywhere is valid and
produces no findings. When a param carries ``bounds``, the validator checks:

  * ``bounds`` is a mapping with only known keys
  * ``direction`` is one of increases_aggressiveness | decreases_aggressiveness | neutral
  * ``evolvable`` is a real boolean, ``rationale`` a non-empty string
  * ``min`` / ``max`` are numeric (not bool), appear together, and ``min < max``
  * an evolvable param has numeric ``min`` and ``max``
  * an ``integer`` param has integer ``min`` / ``max`` / ``step``
  * a ``string`` param has a ``value_template`` containing ``{value}`` (and no other braces)
  * ``boolean`` / ``array`` params carry no bounds
  * ``step`` is > 0
  * the range sits inside the param's existing hard ``minimum`` / ``maximum``
  * every rendered value lies in the param's ``enum`` when it has one

Warnings (never change the exit code): a ``default`` outside the range, a range
not divisible by ``step``, a range too large to check against ``enum``.

Usage:
    python3 validate_bounds.py PATH [PATH ...]     # files or dirs (recursive [*.]tool.yaml)
    python3 validate_bounds.py --json PATH ...     # machine-readable report

Exit codes: 0 = no errors, 1 = at least one error (or a file could not be read/parsed).
Dependencies: stdlib + PyYAML.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

DIRECTIONS = ("increases_aggressiveness", "decreases_aggressiveness", "neutral")
BOUNDS_KEYS = frozenset(
    {"min", "max", "step", "unit", "direction", "evolvable", "rationale", "value_template",
     "source"}
)
REQUIRED_KEYS = ("direction", "evolvable", "rationale")
NO_BOUNDS_TYPES = frozenset({"boolean", "array"})
PLACEHOLDER = "{value}"
ENUM_CHECK_LIMIT = 10_000


@dataclass
class Report:
    """Findings for one tool.yaml document."""

    path: str
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    bounded_params: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def as_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "ok": self.ok,
            "errors": self.errors,
            "warnings": self.warnings,
            "bounded_params": self.bounded_params,
        }


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def render(bounds: dict[str, Any], value: int | float) -> Any:
    """Turn a gene value into the param's value (string params use ``value_template``)."""
    template = bounds.get("value_template")
    if template is None:
        return value
    text = str(int(value)) if float(value).is_integer() else repr(value)
    return template.replace(PLACEHOLDER, text)


def grid(bounds: dict[str, Any], limit: int = ENUM_CHECK_LIMIT) -> list[int | float] | None:
    """All gene values from min to max by step; None if more than ``limit`` values."""
    lo, hi = bounds["min"], bounds["max"]
    step = bounds.get("step", 1)
    count = int(math.floor((hi - lo) / step + 1e-9)) + 1
    if count > limit:
        return None
    if all(_is_int(x) for x in (lo, hi, step)):
        return list(range(lo, hi + 1, step))
    return [round(lo + i * step, 9) for i in range(count)]


def _check_bounds(name: str, spec: dict[str, Any], rep: Report) -> None:
    where = f"params.{name}.bounds"
    b = spec["bounds"]
    if not isinstance(b, dict):
        rep.errors.append(f"{where}: must be a mapping, got {type(b).__name__}")
        return
    rep.bounded_params.append(name)

    for key in sorted(set(b) - BOUNDS_KEYS):
        rep.errors.append(f"{where}: unknown key {key!r}")
    for key in REQUIRED_KEYS:
        if key not in b:
            rep.errors.append(f"{where}: missing required key {key!r}")

    if "direction" in b and b["direction"] not in DIRECTIONS:
        rep.errors.append(f"{where}.direction: {b['direction']!r} not in {list(DIRECTIONS)}")
    if "evolvable" in b and not isinstance(b["evolvable"], bool):
        rep.errors.append(f"{where}.evolvable: must be true/false, got {b['evolvable']!r}")
    if "rationale" in b and not (isinstance(b["rationale"], str) and b["rationale"].strip()):
        rep.errors.append(f"{where}.rationale: must be a non-empty string")
    for key in ("unit", "source"):
        if key in b and not (isinstance(b[key], str) and b[key].strip()):
            rep.errors.append(f"{where}.{key}: must be a non-empty string")

    ptype = spec.get("type")
    if ptype in NO_BOUNDS_TYPES:
        rep.errors.append(f"{where}: bounds are not allowed on params of type {ptype}")
        return

    template = b.get("value_template")
    if template is not None:
        rest = template.replace(PLACEHOLDER, "", 1) if isinstance(template, str) else ""
        if not isinstance(template, str) or PLACEHOLDER not in template:
            rep.errors.append(f"{where}.value_template: must be a string containing {PLACEHOLDER}")
        elif "{" in rest or "}" in rest:
            rep.errors.append(
                f"{where}.value_template: exactly one {PLACEHOLDER} and no other braces allowed"
            )
    elif ptype == "string":
        rep.errors.append(f"{where}: a string param needs value_template to render numeric genes")

    has_min, has_max = "min" in b, "max" in b
    if has_min != has_max:
        rep.errors.append(f"{where}: min and max must be given together")
    if b.get("evolvable") is True and not (has_min and has_max):
        rep.errors.append(f"{where}: an evolvable param needs numeric min and max")

    range_ok = True
    for key in ("min", "max"):
        if key in b and not _is_number(b[key]):
            rep.errors.append(f"{where}.{key}: must be a finite number, got {b[key]!r}")
            range_ok = False
    if "step" in b:
        if not _is_number(b["step"]) or b["step"] <= 0:
            rep.errors.append(f"{where}.step: must be a number > 0, got {b['step']!r}")
            range_ok = False
    if ptype == "integer":
        for key in ("min", "max", "step"):
            if key in b and _is_number(b[key]) and not _is_int(b[key]):
                rep.errors.append(f"{where}.{key}: integer param needs an integer, got {b[key]!r}")
                range_ok = False
    if not (has_min and has_max and range_ok):
        return

    lo, hi = b["min"], b["max"]
    if not lo < hi:
        rep.errors.append(f"{where}: min ({lo}) must be less than max ({hi})")
        return
    step = b.get("step", 1)
    span = (hi - lo) / step
    if abs(span - round(span)) > 1e-9:
        rep.warnings.append(f"{where}: range {lo}..{hi} is not a whole number of steps of {step}")

    hard_lo, hard_hi = spec.get("minimum"), spec.get("maximum")
    if _is_number(hard_lo) and lo < hard_lo:
        rep.errors.append(f"{where}.min ({lo}) is below params.{name}.minimum ({hard_lo})")
    if _is_number(hard_hi) and hi > hard_hi:
        rep.errors.append(f"{where}.max ({hi}) is above params.{name}.maximum ({hard_hi})")

    values = grid(b)
    enum = spec.get("enum")
    if isinstance(enum, list):
        if values is None:
            rep.warnings.append(f"{where}: range too large to check against enum")
        else:
            missing = [render(b, v) for v in values if render(b, v) not in enum]
            if missing:
                rep.errors.append(
                    f"{where}: rendered values {missing} are not in params.{name}.enum"
                )

    if "default" in spec:
        _check_default(where, spec["default"], b, values, rep)


def _check_default(
    where: str, default: Any, b: dict[str, Any], values: list | None, rep: Report
) -> None:
    lo, hi = b["min"], b["max"]
    if b.get("value_template") is None:
        if _is_number(default) and not lo <= default <= hi:
            rep.warnings.append(f"{where}: default {default!r} lies outside {lo}..{hi}")
        return
    if values is not None and default not in {render(b, v) for v in values}:
        rep.warnings.append(f"{where}: default {default!r} is not a rendered value of {lo}..{hi}")


def validate_document(doc: Any, path: str = "<memory>") -> Report:
    """Validate one parsed tool.yaml document."""
    rep = Report(path=path)
    if not isinstance(doc, dict):
        rep.errors.append(f"document must be a mapping, got {type(doc).__name__}")
        return rep
    params = doc.get("params")
    if params is None:
        return rep
    if not isinstance(params, dict):
        rep.errors.append(f"params must be a mapping of name -> spec, got {type(params).__name__}")
        return rep
    for name, spec in params.items():
        if isinstance(spec, dict) and "bounds" in spec:
            _check_bounds(str(name), spec, rep)
    return rep


def validate_file(path: Path) -> Report:
    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, yaml.YAMLError) as exc:
        rep = Report(path=str(path))
        rep.errors.append(f"cannot read/parse: {exc.__class__.__name__}: {exc}")
        return rep
    return validate_document(doc, str(path))


def iter_tool_yamls(paths: Iterable[Path]) -> Iterator[Path]:
    """Expand directories to every ``tool.yaml`` / ``*.tool.yaml`` beneath them.

    Explicit file paths pass through unchanged.
    """
    for p in paths:
        if p.is_dir():
            yield from sorted(
                f for f in p.rglob("*tool.yaml")
                if f.is_file() and (f.name == "tool.yaml" or f.name.endswith(".tool.yaml"))
            )
        else:
            yield p


def evolvable_genes(doc: dict[str, Any], tool: str | None = None) -> list[dict[str, Any]]:
    """The gene space a GA would build from one validated tool.yaml (evolvable params only)."""
    tool = tool or doc.get("name", "")
    genes = []
    for name, spec in (doc.get("params") or {}).items():
        b = spec.get("bounds") if isinstance(spec, dict) else None
        if not isinstance(b, dict) or b.get("evolvable") is not True:
            continue
        genes.append({
            "tool": tool,
            "param": name,
            "min": b["min"],
            "max": b["max"],
            "step": b.get("step", 1),
            "direction": b["direction"],
            "value_template": b.get("value_template"),
            "unit": b.get("unit"),
        })
    return genes


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Validate tool.yaml params.<name>.bounds")
    ap.add_argument("paths", nargs="+", type=Path, help="tool.yaml files or directories")
    ap.add_argument("--json", action="store_true", help="print a JSON report")
    args = ap.parse_args(argv)

    reports = []
    for p in iter_tool_yamls(args.paths):
        reports.append(validate_file(p))
    if not reports:
        reports.append(Report(path=",".join(map(str, args.paths)), errors=["no tool.yaml found"]))

    n_err = sum(len(r.errors) for r in reports)
    summary = {
        "files": len(reports),
        "files_with_errors": sum(not r.ok for r in reports),
        "errors": n_err,
        "warnings": sum(len(r.warnings) for r in reports),
        "bounded_params": sum(len(r.bounded_params) for r in reports),
    }
    if args.json:
        out = {"ok": n_err == 0, "summary": summary, "files": [r.as_dict() for r in reports]}
        print(json.dumps(out, indent=2))
    else:
        for r in reports:
            for e in r.errors:
                print(f"ERROR {r.path}: {e}")
            for w in r.warnings:
                print(f"WARN  {r.path}: {w}")
        print(
            f"{summary['files']} file(s), {summary['bounded_params']} bounded param(s), "
            f"{summary['errors']} error(s), {summary['warnings']} warning(s)"
        )
    return 0 if n_err == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
