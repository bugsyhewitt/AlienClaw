"""Shared paths for the tooltime-bounds proposal tests."""

from __future__ import annotations

import sys
from pathlib import Path

PKG = Path(__file__).resolve().parent.parent          # staging/tooltime-bounds
REPO = PKG.parent.parent                              # AlienClaw worktree root
EXAMPLES = PKG / "examples"
SCHEMA = PKG / "schema" / "tool-param-bounds.schema.json"
TUNER_BOUNDS = REPO / "pho3nix_tuner" / "tooltime_bounds.py"

if str(PKG) not in sys.path:
    sys.path.insert(0, str(PKG))
