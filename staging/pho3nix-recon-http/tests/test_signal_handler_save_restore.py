"""search_text must save and restore the previously-installed SIGALRM handler.

Ported from the search_text half of the in-tree test_signal_handler_save_restore.py
(PKT-1274; the compute half has no staged counterpart). signal.signal() mutates
process-global state, so the handler installed before the call must be (a) preserved
across the call, (b) restored on normal exit, and (c) restored on every exit path.
The ``None`` case: ``signal.getsignal`` returns ``None`` for a handler installed from
C, and ``signal.signal(SIGALRM, None)`` raises TypeError; the tool falls back to
SIG_DFL instead.
"""
from __future__ import annotations

import signal

import pytest

import pho3nix_recon_http.search_text as st_mod
from pho3nix_recon_http.search_text import run as search_text_run

pytestmark = pytest.mark.skipif(not hasattr(signal, "SIGALRM"), reason="SIGALRM is Unix-only")


def _sentinel(signum: int, frame: object) -> None:
    pass


@pytest.fixture(autouse=True)
def _restore_sigalrm_at_end():
    prior = signal.getsignal(signal.SIGALRM)
    yield
    try:
        signal.signal(signal.SIGALRM, prior if prior is not None else signal.SIG_DFL)
    except (TypeError, ValueError):
        signal.signal(signal.SIGALRM, signal.SIG_DFL)


class TestSearchTextSavesAndRestores:
    def test_prior_callable_handler_is_restored_after_run(self):
        signal.signal(signal.SIGALRM, _sentinel)
        before = id(signal.getsignal(signal.SIGALRM))
        result = search_text_run({"pattern": "hello", "text": "hello world"}, {})
        assert result.ok is True
        after = signal.getsignal(signal.SIGALRM)
        assert callable(after)
        assert id(after) == before, "search_text.run replaced the prior handler"

    @pytest.mark.parametrize("prior", [signal.SIG_DFL, signal.SIG_IGN], ids=["dfl", "ign"])
    def test_prior_builtin_handler_is_restored(self, prior):
        signal.signal(signal.SIGALRM, prior)
        search_text_run({"pattern": "hello", "text": "hello world"}, {})
        assert signal.getsignal(signal.SIGALRM) == prior

    def test_consecutive_calls_each_restore_their_prior(self):
        signal.signal(signal.SIGALRM, _sentinel)
        before = id(signal.getsignal(signal.SIGALRM))
        search_text_run({"pattern": "hello", "text": "hello world"}, {})
        assert id(signal.getsignal(signal.SIGALRM)) == before
        search_text_run({"pattern": "hello", "text": "hello world"}, {})
        assert id(signal.getsignal(signal.SIGALRM)) == before

    def test_prior_handler_restored_even_when_search_throws(self):
        signal.signal(signal.SIGALRM, _sentinel)
        before = id(signal.getsignal(signal.SIGALRM))
        result = search_text_run({"pattern": "[unterminated", "text": "x", "flavor": "regex"}, {})
        assert result.ok is False
        assert result.error is not None and "Regex error" in result.error
        assert id(signal.getsignal(signal.SIGALRM)) == before

    def test_prior_handler_restored_after_timeout(self, monkeypatch):
        """No in-tree counterpart: the SIGALRM timeout path also restores."""
        monkeypatch.setattr(st_mod, "_REGEX_TIMEOUT_S", 1)
        signal.signal(signal.SIGALRM, _sentinel)
        before = id(signal.getsignal(signal.SIGALRM))
        # 25 a's: ~4 s uninterrupted, so the test stays bounded even on an interpreter
        # whose regex engine does not poll for signals mid-match.
        result = search_text_run({"text": "a" * 25 + "b", "pattern": "(a+)+$", "regex": True})
        assert result.ok is False
        assert "exceeded 5-second budget" in result.error
        assert id(signal.getsignal(signal.SIGALRM)) == before


class TestNonePriorHandlerSafety:
    def test_search_text_restores_when_prior_handler_was_none(self, monkeypatch):
        monkeypatch.setattr(st_mod.signal, "getsignal", lambda signum: None)
        result = search_text_run({"pattern": "hello", "text": "hello world"}, {})
        assert result.ok is True
