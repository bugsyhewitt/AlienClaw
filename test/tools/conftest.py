"""Shared fixtures for test/tools — pins workspace boundary to the per-test tmp_path
so every test runs inside an isolated workspace root and boundary tests can probe
paths outside it.  ALIENCLAW_FILE_WORKSPACE_ROOT is consumed by the _boundary helper
in src/alienclaw/tools/_boundary.py (added in PKT-576).
"""
import pytest


@pytest.fixture(autouse=True)
def _pin_workspace_root(tmp_path, monkeypatch):
    """Set workspace root = tmp_path for every tool test.

    Keeps all existing tests green (they write under tmp_path) and lets
    boundary-rejection tests probe absolute paths outside tmp_path.
    """
    monkeypatch.setenv("ALIENCLAW_FILE_WORKSPACE_ROOT", str(tmp_path))
