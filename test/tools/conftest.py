"""Shared fixtures for test/tools — pins workspace boundaries to the per-test tmp_path
so every test runs inside an isolated workspace root and boundary tests can probe
paths outside it.  ALIENCLAW_FILE_WORKSPACE_ROOT / ALIENCLAW_FILE_WRITE_WORKSPACE are
consumed by _boundary.py (added in PKT-576).

Production uses ALIENCLAW_HOME; tests override with explicit env vars so that
file_write's output-subdir default (workspace/output) does not break existing tests
that write directly to tmp_path rather than tmp_path/output.
"""
import pytest


@pytest.fixture(autouse=True)
def _pin_workspace_root(tmp_path, monkeypatch):
    """Set both workspace boundaries to tmp_path for every tool test.

    - ALIENCLAW_FILE_WORKSPACE_ROOT → read boundary (file_read)
    - ALIENCLAW_FILE_WRITE_WORKSPACE → write boundary (file_write)

    Setting both to tmp_path keeps all pre-PKT-576 write tests green (they write
    under tmp_path rather than tmp_path/output) while still enabling
    outside-boundary probes via tmp_path.parent in the boundary rejection tests.
    """
    monkeypatch.setenv("ALIENCLAW_FILE_WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setenv("ALIENCLAW_FILE_WRITE_WORKSPACE", str(tmp_path))
