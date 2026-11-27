"""Unit tests for validate_bounds: valid and invalid bounds blocks, CLI exit codes, --json."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
import validate_bounds as vb

GOOD_INT = {
    "type": "integer",
    "default": 10,
    "bounds": {
        "min": 5,
        "max": 50,
        "step": 1,
        "unit": "threads",
        "direction": "increases_aggressiveness",
        "evolvable": True,
        "rationale": "profiles: 5/20/50",
    },
}
GOOD_STR = {
    "type": "string",
    "default": "-T3",
    "enum": ["-T1", "-T2", "-T3", "-T4", "-T5"],
    "bounds": {
        "min": 2,
        "max": 5,
        "value_template": "-T{value}",
        "direction": "increases_aggressiveness",
        "evolvable": True,
        "rationale": "profiles: T2/T4/T5",
    },
}


def doc_with(spec: dict, name: str = "p") -> dict:
    return {"name": "tool", "params": {name: copy.deepcopy(spec)}}


def errors_for(spec: dict) -> list[str]:
    return vb.validate_document(doc_with(spec)).errors


_DROP = object()


def mutate(spec: dict, **bounds_changes) -> dict:
    out = copy.deepcopy(spec)
    for k, v in bounds_changes.items():
        if v is _DROP:
            out["bounds"].pop(k, None)
        else:
            out["bounds"][k] = v
    return out


# --- documents without bounds stay valid -------------------------------------------------

@pytest.mark.parametrize(
    "doc",
    [
        {"name": "t"},
        {"name": "t", "params": None},
        {"name": "t", "params": {}},
        {"name": "t", "params": {"target": {"required": True, "type": "string"}}},
        {"name": "t", "params": {"x": {"type": "integer", "minimum": 1, "maximum": 200}}},
        {"name": "t", "params": {"weird": "not-a-mapping"}},
    ],
)
def test_no_bounds_is_valid(doc):
    rep = vb.validate_document(doc)
    assert rep.ok and not rep.warnings and rep.bounded_params == []


def test_good_specs_are_clean():
    for spec in (GOOD_INT, GOOD_STR):
        rep = vb.validate_document(doc_with(spec))
        assert rep.errors == [] and rep.warnings == []
        assert rep.bounded_params == ["p"]


def test_number_param_accepts_float_bounds():
    spec = {"type": "number", "bounds": {**GOOD_INT["bounds"], "min": 0.0, "max": 2.5,
                                         "step": 0.5}}
    assert errors_for(spec) == []


def test_non_evolvable_needs_no_range():
    spec = {"type": "integer",
            "bounds": {"direction": "neutral", "evolvable": False, "rationale": "doc"}}
    assert errors_for(spec) == []


# --- structural errors ----------------------------------------------------------------------

@pytest.mark.parametrize(
    "doc, fragment",
    [
        ([], "document must be a mapping"),
        ({"params": ["target"]}, "params must be a mapping"),
        ({"params": {"p": {"type": "integer", "bounds": [1, 2]}}}, "must be a mapping"),
    ],
)
def test_structural_errors(doc, fragment):
    rep = vb.validate_document(doc)
    assert any(fragment in e for e in rep.errors), rep.errors


# --- invalid bounds ------------------------------------------------------------------------

@pytest.mark.parametrize(
    "spec, fragment",
    [
        (mutate(GOOD_INT, min=50, max=5), "must be less than max"),
        (mutate(GOOD_INT, min=7, max=7), "must be less than max"),
        (mutate(GOOD_INT, min="5"), "must be a finite number"),
        (mutate(GOOD_INT, max=True), "must be a finite number"),
        (mutate(GOOD_INT, max=float("inf")), "must be a finite number"),
        (mutate(GOOD_INT, min=5.5), "integer param needs an integer"),
        (mutate(GOOD_INT, step=0), "step: must be a number > 0"),
        (mutate(GOOD_INT, step=-1), "step: must be a number > 0"),
        (mutate(GOOD_INT, direction="maximize"), "direction"),
        (mutate(GOOD_INT, direction=_DROP), "missing required key 'direction'"),
        (mutate(GOOD_INT, evolvable="yes"), "evolvable: must be true/false"),
        (mutate(GOOD_INT, evolvable=_DROP), "missing required key 'evolvable'"),
        (mutate(GOOD_INT, rationale=""), "rationale: must be a non-empty string"),
        (mutate(GOOD_INT, rationale=_DROP), "missing required key 'rationale'"),
        (mutate(GOOD_INT, unit=""), "unit: must be a non-empty string"),
        (mutate(GOOD_INT, maximum=50), "unknown key 'maximum'"),
        (mutate(GOOD_INT, max=_DROP), "min and max must be given together"),
        (mutate(GOOD_INT, min=_DROP, max=_DROP), "evolvable param needs numeric min and max"),
        (mutate(GOOD_STR, value_template=_DROP), "string param needs value_template"),
        (mutate(GOOD_STR, value_template="-T"), "must be a string containing {value}"),
        (mutate(GOOD_STR, value_template="{value}{value}"), "exactly one {value}"),
        (mutate(GOOD_STR, value_template="{value.__class__}"), "containing {value}"),
        (mutate(GOOD_STR, value_template="{0}-{value}"), "exactly one {value}"),
        (mutate(GOOD_STR, min=0), "not in params.p.enum"),
        ({**GOOD_INT, "type": "boolean"}, "not allowed on params of type boolean"),
        ({**GOOD_INT, "type": "array"}, "not allowed on params of type array"),
        ({**GOOD_INT, "minimum": 10}, "below params.p.minimum"),
        ({**GOOD_INT, "maximum": 20}, "above params.p.maximum"),
    ],
)
def test_invalid_bounds(spec, fragment):
    errs = errors_for(spec)
    assert any(fragment in e for e in errs), errs


# --- warnings never fail ----------------------------------------------------------------------

@pytest.mark.parametrize(
    "spec, fragment",
    [
        ({**GOOD_INT, "default": 100}, "lies outside"),
        ({**GOOD_STR, "default": "-T1"}, "not a rendered value"),
        (mutate(GOOD_INT, step=10, max=52), "not a whole number of steps"),
        ({**GOOD_STR, "bounds": {**GOOD_STR["bounds"], "max": 10**6}, "enum": ["-T2"]},
         "too large to check against enum"),
    ],
)
def test_warnings(spec, fragment):
    rep = vb.validate_document(doc_with(spec))
    assert rep.ok, rep.errors
    assert any(fragment in w for w in rep.warnings), rep.warnings


# --- helpers ------------------------------------------------------------------------------

def test_render_and_grid():
    b = GOOD_STR["bounds"]
    assert [vb.render(b, v) for v in vb.grid(b)] == ["-T2", "-T3", "-T4", "-T5"]
    assert vb.render({"value_template": "{value}ms"}, 250) == "250ms"
    assert vb.render({}, 7) == 7
    assert vb.grid({"min": 0.0, "max": 1.0, "step": 0.25}) == [0.0, 0.25, 0.5, 0.75, 1.0]
    assert vb.grid({"min": 0, "max": 10**6}, limit=10) is None


def test_evolvable_genes_skips_non_evolvable():
    doc = {"name": "t", "params": {
        "a": copy.deepcopy(GOOD_INT),
        "b": {"type": "integer", "bounds": {**GOOD_INT["bounds"], "evolvable": False}},
        "c": {"type": "string"},
    }}
    genes = vb.evolvable_genes(doc)
    assert [g["param"] for g in genes] == ["a"]
    assert genes[0] == {"tool": "t", "param": "a", "min": 5, "max": 50, "step": 1,
                        "direction": "increases_aggressiveness", "value_template": None,
                        "unit": "threads"}


# --- CLI ----------------------------------------------------------------------------------

def _write(tmp_path: Path, rel: str, text: str) -> Path:
    p = tmp_path / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)
    return p


GOOD_YAML = """\
name: t
params:
  threads:
    type: integer
    bounds: {min: 1, max: 4, direction: neutral, evolvable: true, rationale: r}
"""
BAD_YAML = GOOD_YAML.replace("min: 1, max: 4", "min: 4, max: 1")


def test_cli_exit_zero_on_valid(tmp_path, capsys):
    p = _write(tmp_path, "a/pho3nix_config/tool.yaml", GOOD_YAML)
    assert vb.main([str(p)]) == 0
    assert "0 error(s)" in capsys.readouterr().out


def test_cli_exit_one_on_invalid(tmp_path, capsys):
    p = _write(tmp_path, "a/tool.yaml", BAD_YAML)
    assert vb.main([str(p)]) == 1
    assert "ERROR" in capsys.readouterr().out


def test_cli_exit_one_on_unparseable_and_missing(tmp_path):
    bad = _write(tmp_path, "x/tool.yaml", "name: [unclosed\n")
    assert vb.main([str(bad)]) == 1
    assert vb.main([str(tmp_path / "nope.yaml")]) == 1
    empty = tmp_path / "empty"
    empty.mkdir()
    assert vb.main([str(empty)]) == 1


def test_cli_directory_and_json(tmp_path, capsys):
    _write(tmp_path, "a/pho3nix_config/tool.yaml", GOOD_YAML)
    _write(tmp_path, "b/pho3nix_config/tool.yaml", BAD_YAML)
    _write(tmp_path, "c/pho3nix_config/other.yaml", BAD_YAML)  # not named tool.yaml: ignored
    assert vb.main(["--json", str(tmp_path)]) == 1
    report = json.loads(capsys.readouterr().out)
    assert report["ok"] is False
    assert report["summary"] == {"files": 2, "files_with_errors": 1, "errors": 1,
                                 "warnings": 0, "bounded_params": 2}
    by_path = {Path(f["path"]).parent.parent.name: f for f in report["files"]}
    assert by_path["a"]["ok"] is True and by_path["b"]["ok"] is False
    assert by_path["b"]["bounded_params"] == ["threads"]
