"""Suite-wide isolation: nothing a test does may land under the real home directory.

HOME and ALIENCLAW_POPULATIONS_ROOT point into the per-test tmp_path (the engine's
population store defaults to ~/.alienclaw/populations, and run_ga's default
--history is ~/.pho3nix_data/history/run_history.json). Hypothesis's example
database is disabled.
"""
from __future__ import annotations

import os
from pathlib import Path

import alienclaw_ga
import pytest
from hypothesis import settings

settings.register_profile("pho3nix_tuner", database=None)
settings.load_profile("pho3nix_tuner")

PKG_ROOT = Path(__file__).resolve().parents[1]
SRC = PKG_ROOT / "src"
ENGINE_SRC = Path(alienclaw_ga.__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def _isolate_home(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


@pytest.fixture
def sub_env(tmp_path):
    """Environment for subprocess runs: staged src + the engine this suite imported."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("PYTHON")}
    env["PYTHONPATH"] = os.pathsep.join([str(SRC), str(ENGINE_SRC)])
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["HOME"] = str(tmp_path / "home")
    env["ALIENCLAW_POPULATIONS_ROOT"] = str(tmp_path / "populations")
    return env
