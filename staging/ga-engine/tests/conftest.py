"""Suite-wide isolation for the staged GA engine tests.

The ported test modules already pin ALIENCLAW_POPULATIONS_ROOT per file (as
in-tree). This autouse fixture is a belt-and-braces guard so that no test,
including new ones, can write under the real home directory: HOME and
ALIENCLAW_POPULATIONS_ROOT both point into the per-test tmp_path. Per-file
fixtures that set ALIENCLAW_POPULATIONS_ROOT again simply override it.

Hypothesis's example database is disabled so runs leave no .hypothesis/ dir.
"""
import pytest
from hypothesis import settings

settings.register_profile("alienclaw_ga", database=None)
settings.load_profile("alienclaw_ga")


@pytest.fixture(autouse=True)
def _isolate_home(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield
