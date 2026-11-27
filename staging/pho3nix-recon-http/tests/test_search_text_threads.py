"""search_text off the main thread (staged divergence; no in-tree counterpart).

The reference installs a SIGALRM handler for its ReDoS timeout, and signal.signal()
raises ValueError off the main thread, so run() raised from a Flask request thread or a
Qt worker (``test_search_text_returns_a_result_from_a_worker_thread`` was the strict
xfail). Off the main thread the staged tool now runs the scan in a child interpreter
that is killed at the deadline, except a small literal search, which runs in-process.
See search_text.py for why a watchdog thread cannot do it (the regex engine holds the
GIL for the whole match).
"""
from __future__ import annotations

import dataclasses
import signal
import subprocess
import sys
import threading
import time

import pytest

import pho3nix_recon_http.search_text as st_mod
from pho3nix_recon_http.types import RunResult

RUNAWAY = {"text": "a" * 34 + "b", "pattern": "(a+)+$", "regex": True}  # minutes in-process


def _in_worker(inputs: dict, params: dict | None = None) -> RunResult:
    out: dict = {}

    def work() -> None:
        try:
            out["result"] = st_mod.run(inputs, {} if params is None else params)
        except Exception as exc:  # recorded, asserted by the caller
            out["error"] = exc

    t = threading.Thread(target=work)
    t.start()
    t.join(timeout=60)
    assert not t.is_alive(), "search_text did not return within 60 s"
    assert isinstance(out.get("result"), RunResult), out.get("error")
    return out["result"]


@pytest.fixture
def child_calls(monkeypatch: pytest.MonkeyPatch) -> list:
    """Records the argv of every scan process (the real subprocess.run still runs)."""
    calls: list = []
    real_run = subprocess.run

    def spy(args, *a, **kw):
        calls.append(list(args))
        return real_run(args, *a, **kw)

    monkeypatch.setattr(st_mod.subprocess, "run", spy)
    return calls


def test_search_text_returns_a_result_from_a_worker_thread() -> None:
    """Was the strict xfail."""
    r = _in_worker({"text": "hello", "pattern": "hello"})
    assert r.ok is True
    assert r.output["totalMatches"] == 1


TEXT = "alpha foo\nBeta FOO bar\n\ngamma f.o\nfoo*?\n" + "\n".join(
    f"line {i} foo" for i in range(12)
)
CORPUS = [
    ({"text": TEXT, "pattern": "foo"}, {}),
    ({"content": TEXT, "query": "FOO"}, {"max_results": 3}),
    ({"text": TEXT, "pattern": "foo", "case_sensitive": True}, {"context_lines": 3}),
    ({"text": TEXT, "pattern": r"f.o", "regex": True}, {}),
    ({"text": TEXT, "pattern": r"f.o", "flavor": "regex", "case_sensitive": True}, {}),
    ({"text": TEXT, "pattern": "*foo", "flavor": "glob"}, {}),
    ({"text": TEXT, "pattern": "line ? foo", "flavor": "glob"}, {"max_results": 2}),
    ({"text": TEXT, "pattern": "[unclosed", "regex": True}, {}),
    ({"text": TEXT, "pattern": "(?P<x>a)(?P<x>b)", "regex": True}, {}),
    ({"text": TEXT, "pattern": "^$", "regex": True}, {}),
    ({"text": "café\nCAFÉ\nstraße", "pattern": "CAFÉ"}, {}),
    ({"text": "a\r\nfoo\r\nb\x0bfoo foo", "pattern": "foo", "regex": True}, {}),
    ({"text": "lone \ud800 surrogate\nfoo", "pattern": "\ud800|foo", "regex": True}, {}),
    ({"text": "x" * 100, "pattern": "x" * 200}, {}),
]


@pytest.mark.parametrize("strategy", ["default", "child_only"])
def test_worker_thread_results_match_the_main_thread(strategy, monkeypatch) -> None:
    expected = [dataclasses.asdict(st_mod.run(i, p)) for i, p in CORPUS]  # main thread
    if strategy == "child_only":
        monkeypatch.setattr(st_mod, "_INLINE_LITERAL_BUDGET", -1)
    got = [dataclasses.asdict(_in_worker(i, p)) for i, p in CORPUS]
    for case, want, have in zip(CORPUS, expected, got):
        assert have == want, case


def test_small_literal_runs_in_process_and_the_rest_in_a_child(child_calls) -> None:
    assert _in_worker({"text": TEXT, "pattern": "foo"}).ok is True
    assert child_calls == []
    for inputs in ({"text": TEXT, "pattern": "f.o", "regex": True},
                   {"text": TEXT, "pattern": "*foo", "flavor": "glob"},
                   {"text": "a" * 50_001, "pattern": "a" * 200}):  # literal over the budget
        assert _in_worker(inputs).ok is True
    assert len(child_calls) == 3
    script = st_mod._scan.__file__
    assert all(argv == [sys.executable, "-I", "-S", script] for argv in child_calls)


def test_runaway_regex_off_main_thread_is_killed_at_the_deadline(monkeypatch) -> None:
    monkeypatch.setattr(st_mod, "_REGEX_TIMEOUT_S", 1)
    ticks: list[float] = []
    done = threading.Event()
    out: dict = {}

    def work() -> None:
        out["result"] = st_mod.run(RUNAWAY)
        done.set()

    start = time.monotonic()
    threading.Thread(target=work).start()
    while not done.wait(0.05):  # the main thread keeps running meanwhile
        ticks.append(time.monotonic())
        assert time.monotonic() - start < 30, "the scan process was not killed"
    elapsed = time.monotonic() - start
    r = out["result"]
    assert r.ok is False and r.correctness == 0.0
    assert r.error == "search_text: regex execution exceeded 5-second budget"
    assert elapsed < 10
    gaps = [b - a for a, b in zip([start, *ticks], ticks)]
    assert max(gaps) < 0.5, "the main thread was blocked while the regex ran"


def test_signal_state_is_untouched_off_main_thread(monkeypatch) -> None:
    calls: list = []
    monkeypatch.setattr(st_mod.signal, "signal", lambda *a: calls.append(a))
    monkeypatch.setattr(st_mod.signal, "alarm", lambda *a: calls.append(a))
    assert _in_worker({"text": TEXT, "pattern": "f.o", "regex": True}).ok is True
    assert calls == []


def test_without_sigalrm_the_main_thread_uses_the_child_too(monkeypatch, child_calls) -> None:
    """The Windows case: no SIGALRM. The reference has no regex timeout at all there."""
    want = st_mod.run({"text": TEXT, "pattern": "f.o", "regex": True})  # via SIGALRM
    monkeypatch.setattr(st_mod, "_HAS_SIGALRM", False)
    monkeypatch.setattr(st_mod, "_REGEX_TIMEOUT_S", 1)
    r = st_mod.run({"text": TEXT, "pattern": "f.o", "regex": True})
    assert r == want and r.output["totalMatches"] == 16
    r = st_mod.run(RUNAWAY)
    assert r.error == "search_text: regex execution exceeded 5-second budget"
    assert len(child_calls) == 2


def test_sub_interpreter_style_signal_refusal_falls_back(monkeypatch, child_calls) -> None:
    """signal.signal() can raise ValueError even on a main thread (sub-interpreter)."""
    if not hasattr(signal, "SIGALRM"):
        pytest.skip("SIGALRM is Unix-only")

    def refuse(*args):
        raise ValueError("signal only works in main thread of the main interpreter")

    monkeypatch.setattr(st_mod.signal, "signal", refuse)
    r = st_mod.run({"text": TEXT, "pattern": "f.o", "regex": True})
    assert r.ok is True and r.output["totalMatches"] == 16
    assert len(child_calls) == 1


@pytest.mark.parametrize("how", ["frozen", "no_executable"])
def test_no_interpreter_fails_closed_for_glob_and_regex(how, monkeypatch) -> None:
    if how == "frozen":  # a frozen app's sys.executable is the app, not Python
        monkeypatch.setattr(sys, "frozen", True, raising=False)
    else:
        monkeypatch.setattr(sys, "executable", "")
    for inputs in ({"text": TEXT, "pattern": "f.o", "regex": True},
                   {"text": TEXT, "pattern": "*foo", "flavor": "glob"}):
        r = _in_worker(inputs)
        assert r.ok is False and r.correctness == 0.0
        assert r.error.startswith("search_text: no Python interpreter to run")
    assert _in_worker({"text": TEXT, "pattern": "foo"}).ok is True  # small literal: no child


def test_scan_process_failure_is_a_result_not_an_exception(monkeypatch) -> None:
    def broken(args, *a, **kw):
        return subprocess.CompletedProcess(args, 1, b"", b"Traceback ...\nMemoryError")

    monkeypatch.setattr(st_mod.subprocess, "run", broken)
    r = _in_worker({"text": TEXT, "pattern": "f.o", "regex": True})
    assert r.ok is False
    assert r.error == "search_text: scan process failed (exit status 1) Traceback ...\nMemoryError"


def test_unstartable_scan_process_is_a_result(monkeypatch) -> None:
    def cannot(args, *a, **kw):
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(st_mod.subprocess, "run", cannot)
    r = _in_worker({"text": TEXT, "pattern": "f.o", "regex": True})
    assert r.ok is False
    assert r.error.startswith("search_text: cannot start the scan process")
