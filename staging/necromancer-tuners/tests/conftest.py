"""Suite-wide isolation for the necromancer-tuners tests.

- Bytecode writing is off, so importing the in-tree tuners (parity test) or
  anything else never drops __pycache__ next to sources outside this folder.
- Fake ``mangle`` / ``ouija`` packages are registered before any tuner module is
  imported (see tuner_fakes.py); the real fuzzer and Ollama are never reached.
- Every test gets HOME, ALIENCLAW_POPULATIONS_ROOT, TMPDIR and tempfile.tempdir
  pointed into its own tmp_path, so the adapters' mkdtemp() calls and the GA's
  population store land there and nothing is written under the real home.
- Network connects and subprocess spawns raise, as a backstop for the mocks.
- Hypothesis's example database is disabled.
"""

import sys

sys.dont_write_bytecode = True

import socket  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402

import pytest  # noqa: E402
from hypothesis import settings  # noqa: E402

import tuner_fakes  # noqa: E402

tuner_fakes.install()

settings.register_profile("necromancer_tuners", database=None)
settings.load_profile("necromancer_tuners")


def _deny(what):
    def _raise(*args, **kwargs):
        raise RuntimeError(f"{what} is disabled in necromancer-tuners tests")
    return _raise


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    scratch = tmp_path / "tmp"
    scratch.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    monkeypatch.setenv("TMPDIR", str(scratch))
    monkeypatch.setattr(tempfile, "tempdir", str(scratch))
    monkeypatch.setattr(socket.socket, "connect", _deny("socket.connect"))
    monkeypatch.setattr(socket.socket, "connect_ex", _deny("socket.connect_ex"))
    monkeypatch.setattr(socket, "create_connection", _deny("socket.create_connection"))
    monkeypatch.setattr(subprocess, "Popen", _deny("subprocess.Popen"))
    yield


@pytest.fixture
def scratch_dir(tmp_path):
    """The per-test directory that tempfile.mkdtemp() writes into."""
    return tmp_path / "tmp"
