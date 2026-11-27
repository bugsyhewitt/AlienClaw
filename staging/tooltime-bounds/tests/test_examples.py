"""Every example validates cleanly with validate_bounds."""

from __future__ import annotations

import json

import pytest
import validate_bounds as vb
import yaml
from conftest import EXAMPLES

EXAMPLE_FILES = sorted(EXAMPLES.glob("*.tool.yaml"))
EXPECTED = {"gobuster", "nmap", "nuclei", "sqlmap"}


def load(path):
    return yaml.safe_load(path.read_text())


def test_expected_examples_present():
    assert {p.name.split(".")[0] for p in EXAMPLE_FILES} == EXPECTED


@pytest.mark.parametrize("path", EXAMPLE_FILES, ids=lambda p: p.name)
def test_example_validates_without_errors_or_warnings(path):
    rep = vb.validate_file(path)
    assert rep.errors == [] and rep.warnings == []
    assert rep.bounded_params, "an example must carry at least one bounds block"


def test_cli_over_examples_dir_exits_zero(capsys):
    assert vb.main(["--json", str(EXAMPLES)]) == 0  # directory mode picks up *.tool.yaml
    report = json.loads(capsys.readouterr().out)
    assert report["ok"] is True
    assert report["summary"]["files"] == len(EXPECTED)
    assert report["summary"]["bounded_params"] == 11  # nmap 1, gobuster 3, nuclei 3, sqlmap 4


def test_nuclei_is_metadata_only():
    """Owner parked Pho3nix rate-limit/concurrency/timeout logging: nothing in nuclei evolves."""
    doc = load(EXAMPLES / "nuclei.tool.yaml")
    bounded = {n: s["bounds"] for n, s in doc["params"].items() if "bounds" in s}
    assert set(bounded) == {"rate_limit", "concurrency", "timeout"}
    assert all(b["evolvable"] is False for b in bounded.values())
    assert vb.evolvable_genes(doc) == []


def test_examples_keep_existing_params_untouched():
    """The extension only adds keys: pre-existing params keep their original spec."""
    nmap = load(EXAMPLES / "nmap.tool.yaml")["params"]["timing"]
    assert {k: v for k, v in nmap.items() if k != "bounds"} == {
        "required": False,
        "type": "string",
        "default": "-T3",
        "enum": ["-T1", "-T2", "-T3", "-T4", "-T5"],
        "description": "Timing template. T1=slow, T3=normal, T4=aggressive, T5=insane.",
    }
