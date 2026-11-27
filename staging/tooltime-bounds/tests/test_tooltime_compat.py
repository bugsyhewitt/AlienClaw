"""Read-only backward-compatibility check against the real ToolTime catalog.

Runs the validator over every pho3nix_config/tool.yaml under $TOOLTIME_DIR (default
~/dev/tooltime). None of them carries bounds today, so all must pass unchanged. The test
only reads files; it skips when the catalog is absent.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
import validate_bounds as vb

TOOLTIME = Path(os.environ.get("TOOLTIME_DIR", Path.home() / "dev" / "tooltime")).expanduser()


@pytest.fixture(scope="module")
def real_files():
    if not TOOLTIME.is_dir():
        pytest.skip(f"ToolTime catalog not found at {TOOLTIME}")
    files = sorted(TOOLTIME.glob("agents/agent-*/tools/*/pho3nix_config/tool.yaml"))
    files += sorted(TOOLTIME.glob("output/**/pho3nix_config/tool.yaml"))
    if not files:
        pytest.skip(f"no pho3nix_config/tool.yaml under {TOOLTIME}")
    return files


@pytest.fixture(scope="module")
def reports(real_files):
    return [vb.validate_file(p) for p in real_files]


def test_real_tool_yaml_files_still_pass(reports):
    failing = {r.path: r.errors for r in reports if not r.ok}
    print(f"\nToolTime compatibility: {len(reports)} real tool.yaml files validated")
    assert failing == {}


def test_real_files_carry_no_bounds_yet(reports):
    """Documents the baseline: today's catalog has no bounds blocks at all."""
    bounded = {r.path: r.bounded_params for r in reports if r.bounded_params}
    assert bounded == {}, "ToolTime gained bounds: re-check this proposal against them"


def test_real_nmap_timing_accepts_proposed_bounds(real_files):
    """The proposed nmap bounds drop straight into the real nmap spec without errors."""
    import yaml

    path = next((p for p in real_files if p.parent.parent.name == "nmap"), None)
    if path is None:
        pytest.skip("real nmap tool.yaml not found")
    doc = yaml.safe_load(path.read_text())
    doc["params"]["timing"]["bounds"] = {
        "min": 2, "max": 5, "value_template": "-T{value}",
        "direction": "increases_aggressiveness", "evolvable": True, "rationale": "r",
    }
    rep = vb.validate_document(doc, str(path))
    assert rep.errors == [] and rep.warnings == []
