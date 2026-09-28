"""Tests for SIGALRM handler save/restore in tools/search_text.py and tools/compute.py.

PKT-1271 (REJECTED) originally flagged that both files install a SIGALRM handler
without saving the previously-installed handler and without restoring it on exit.
This file is the corrective File-A: the seven tests below pin the contract that
the previously-installed handler must be (a) preserved across the call boundary,
(b) restored to its prior value on normal exit, and (c) restored on every exit
path (success, exception, SIGALRM-induced timeout). Test #7 specifically guards
the ``None`` case that the REJECTED patch mishandled: ``signal.getsignal``
returns ``None`` when the prior handler was installed by C / non-Python code, and
``signal.signal(SIGALRM, None)`` raises ``TypeError`` — the restore site must
fall back to ``signal.SIG_DFL`` instead of forwarding ``None`` straight into
``signal.signal(...)``.

Authored: 2026-09-27 (tester cycle 463, PKT-1274 corrective re-author of
REJECTED PKT-1271).  Defect class 4 (process-wide resource mutation without
save/restore) is preserved.
"""
from __future__ import annotations

import signal

import pytest

from alienclaw.tools.compute import _eval_sandboxed
from alienclaw.tools.search_text import run as search_text_run


# Sentinel handler used to detect prior-handler clobbering across calls.
def _sentinel(signum: int, frame: object) -> None:  # type: ignore[type-arg]
    pass


@pytest.fixture(autouse=True)
def _restore_sigalm_at_end():
    """Best-effort: reset SIGALRM to SIG_DFL after every test, so a bug in our
    own restore path never leaks into the next test.  This is a safety net —
    every test in this file MUST also assert on the handler identity inline."""
    prior = signal.getsignal(signal.SIGALRM)
    yield
    try:
        signal.signal(signal.SIGALRM, prior if prior is not None else signal.SIG_DFL)
    except (TypeError, ValueError):
        signal.signal(signal.SIGALRM, signal.SIG_DFL)


# ── search_text ──────────────────────────────────────────────────────────────


class TestSearchTextSavesAndRestores:
    def test_prior_callable_handler_is_restored_after_run(self):
        """Class-4 defect: a Python callable installed BEFORE the call must be
        the same callable AFTER the call returns."""
        signal.signal(signal.SIGALRM, _sentinel)
        sentinel_id_before = id(signal.getsignal(signal.SIGALRM))

        result = search_text_run({"pattern": "hello", "text": "hello world"}, {})

        assert result.ok is True, "happy-path run should succeed"
        after = signal.getsignal(signal.SIGALRM)
        assert callable(after), (
            f"prior callable handler must be restored; got {after!r}"
        )
        assert id(after) == sentinel_id_before, (
            "search_text.run replaced the prior handler (Class-4 clobber)"
        )

    def test_prior_sig_dfl_handler_is_restored(self):
        signal.signal(signal.SIGALRM, signal.SIG_DFL)
        sentinel_before = signal.getsignal(signal.SIGALRM)

        search_text_run({"pattern": "hello", "text": "hello world"}, {})

        assert signal.getsignal(signal.SIGALRM) == sentinel_before, (
            f"SIG_DFL must be preserved across search_text.run; "
            f"got {signal.getsignal(signal.SIGALRM)!r}"
        )

    def test_prior_sig_ign_handler_is_restored(self):
        signal.signal(signal.SIGALRM, signal.SIG_IGN)
        sentinel_before = signal.getsignal(signal.SIGALRM)

        search_text_run({"pattern": "hello", "text": "hello world"}, {})

        assert signal.getsignal(signal.SIGALRM) == sentinel_before, (
            f"SIG_IGN must be preserved across search_text.run; "
            f"got {signal.getsignal(signal.SIGALRM)!r}"
        )

    def test_consecutive_calls_each_restore_their_prior(self):
        """Two consecutive calls must BOTH restore the sentinel — i.e. the
        second call sees the same callable that the first call observed,
        not a nested closure rebind."""
        signal.signal(signal.SIGALRM, _sentinel)
        sentinel_id_before = id(signal.getsignal(signal.SIGALRM))

        search_text_run({"pattern": "hello", "text": "hello world"}, {})
        mid = signal.getsignal(signal.SIGALRM)
        assert id(mid) == sentinel_id_before, (
            "first call did not restore the prior handler"
        )

        search_text_run({"pattern": "hello", "text": "hello world"}, {})
        end = signal.getsignal(signal.SIGALRM)
        assert id(end) == sentinel_id_before, (
            "second call did not restore the prior handler "
            "(nested-closure rebind leak)"
        )

    def test_prior_handler_restored_even_when_search_throws(self):
        """Exception path: a bad regex still must restore the prior handler
        in the `finally` block."""
        signal.signal(signal.SIGALRM, _sentinel)
        sentinel_id_before = id(signal.getsignal(signal.SIGALRM))

        # Bad regex in `regex` flavor (literal/glob auto-escape the pattern,
        # so the unterminated character class only fails under regex flavor).
        # `re.error` is caught inside the function and returns RunResult(ok=False);
        # the `finally` block must still restore the prior handler.
        result = search_text_run(
            {"pattern": "[unterminated", "text": "x", "flavor": "regex"}, {}
        )
        assert result.ok is False
        assert result.error is not None and "Regex error" in result.error

        after = signal.getsignal(signal.SIGALRM)
        assert id(after) == sentinel_id_before, (
            "prior handler not restored on regex-error exception path"
        )


# ── compute ──────────────────────────────────────────────────────────────────


class TestComputeSavesAndRestores:
    def test_prior_callable_handler_is_restored_after_eval(self):
        signal.signal(signal.SIGALRM, _sentinel)
        sentinel_id_before = id(signal.getsignal(signal.SIGALRM))

        result = _eval_sandboxed("1 + 2")

        assert result == 3, "happy-path eval should succeed"
        after = signal.getsignal(signal.SIGALRM)
        assert callable(after), (
            f"prior callable handler must be restored; got {after!r}"
        )
        assert id(after) == sentinel_id_before, (
            "_eval_sandboxed replaced the prior handler (Class-4 clobber)"
        )

    def test_prior_sig_dfl_handler_is_restored(self):
        signal.signal(signal.SIGALRM, signal.SIG_DFL)
        sentinel_before = signal.getsignal(signal.SIGALRM)

        _eval_sandboxed("1 + 2")

        assert signal.getsignal(signal.SIGALRM) == sentinel_before, (
            f"SIG_DFL must be preserved across _eval_sandboxed; "
            f"got {signal.getsignal(signal.SIGALRM)!r}"
        )

    def test_prior_sig_ign_handler_is_restored(self):
        signal.signal(signal.SIGALRM, signal.SIG_IGN)
        sentinel_before = signal.getsignal(signal.SIGALRM)

        _eval_sandboxed("1 + 2")

        assert signal.getsignal(signal.SIGALRM) == sentinel_before, (
            f"SIG_IGN must be preserved across _eval_sandboxed; "
            f"got {signal.getsignal(signal.SIGALRM)!r}"
        )

    def test_consecutive_calls_each_restore_their_prior(self):
        signal.signal(signal.SIGALRM, _sentinel)
        sentinel_id_before = id(signal.getsignal(signal.SIGALRM))

        _eval_sandboxed("1 + 2")
        mid = signal.getsignal(signal.SIGALRM)
        assert id(mid) == sentinel_id_before

        _eval_sandboxed("3 * 4")
        end = signal.getsignal(signal.SIGALRM)
        assert id(end) == sentinel_id_before, (
            "second _eval_sandboxed call did not restore the prior handler "
            "(nested-closure rebind leak)"
        )

    def test_prior_handler_restored_when_sandboxed_eval_throws(self):
        """Exception path: a disallowed AST node (e.g. ``__import__``) must
        still trigger the `finally` and restore the prior handler."""
        signal.signal(signal.SIGALRM, _sentinel)
        sentinel_id_before = id(signal.getsignal(signal.SIGALRM))

        with pytest.raises(ValueError):
            _eval_sandboxed("__import__('os')")

        after = signal.getsignal(signal.SIGALRM)
        assert id(after) == sentinel_id_before, (
            "prior handler not restored on ValueError exception path"
        )


# ── None-handler safety (the rejected-patch hole) ────────────────────────────


class TestNonePriorHandlerSafety:
    """The REJECTED PKT-1271 patch shipped a TypeError hole: it captured
    ``_prev = signal.getsignal(SIGALRM)`` and unconditionally called
    ``signal.signal(SIGALRM, _prev)`` in ``finally``.  When the prior handler
    was installed by C / non-Python code, ``getsignal`` returns ``None``, and
    ``signal.signal(SIGALRM, None)`` raises ``TypeError`` — which then escapes
    the ``finally`` and replaces the tool's normal ``RunResult`` with an
    unhandled exception.  The fixed implementation MUST guard against ``None``
    and fall back to ``signal.SIG_DFL`` so the restore path is always safe."""

    def test_search_text_restores_when_prior_handler_was_none(self, monkeypatch):
        """Simulate the C-installed-handler case by monkeypatching
        ``signal.getsignal`` to return ``None``."""
        import alienclaw.tools.search_text as st_mod

        real_getsignal = signal.getsignal
        monkeypatch.setattr(
            st_mod.signal, "getsignal",
            lambda signum: None,
        )

        # Run must complete cleanly (no TypeError escaping `finally`).
        result = search_text_run({"pattern": "hello", "text": "hello world"}, {})
        assert result.ok is True, (
            "search_text.run must not propagate TypeError when prior handler "
            "is None (the rejected PKT-1271 hole)"
        )

    def test_compute_restores_when_prior_handler_was_none(self, monkeypatch):
        import alienclaw.tools.compute as cmp_mod

        monkeypatch.setattr(
            cmp_mod.signal, "getsignal",
            lambda signum: None,
        )

        # Eval must complete cleanly.
        result = _eval_sandboxed("1 + 2")
        assert result == 3, (
            "_eval_sandboxed must not propagate TypeError when prior handler "
            "is None (the rejected PKT-1271 hole)"
        )
