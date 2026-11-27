"""Regression (2026-11-26 security review, F3): the read itself is bounded, not only fstat().

file_read checked the 10 MiB cap on fstat()'s size and then read the fd to EOF, so a
file that grew after the fstat() (an outside appender, e.g. a log in the workspace)
was read in full: 20 MiB appended after the check came back as ok=True with the old
sizeBytes. It now reads at most cap + 1 bytes and refuses if more arrived.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from alienclaw.tools import file_read

CAP = 1024


@pytest.fixture
def ws(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "ws"
    root.mkdir()
    monkeypatch.setenv("ALIENCLAW_FILE_WORKSPACE_ROOT", str(root))
    monkeypatch.setattr(file_read, "_MAX_BYTES", CAP)
    return root


def _grow_after_fstat(monkeypatch: pytest.MonkeyPatch, target: Path, extra: bytes) -> None:
    real_fstat = os.fstat

    def fstat_then_grow(fd):
        st = real_fstat(fd)  # the size the check sees ...
        with open(target, "ab") as fh:  # ... then the file grows before the read
            fh.write(extra)
        return st

    monkeypatch.setattr(file_read.os, "fstat", fstat_then_grow)


def test_file_grown_past_the_cap_after_fstat_is_refused(
    ws: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = ws / "grow.log"
    target.write_text("small\n")
    _grow_after_fstat(monkeypatch, target, b"x" * (4 * CAP))
    r = file_read.run({"path": "grow.log"})
    assert r.ok is False
    assert r.error.startswith("File exceeds 10 MiB")


def test_file_grown_but_still_within_the_cap_is_read_with_its_real_size(
    ws: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = ws / "grow.log"
    target.write_text("small\n")
    _grow_after_fstat(monkeypatch, target, b"more\r\n")
    r = file_read.run({"path": "grow.log"})
    assert r.ok is True, r.error
    assert r.output["content"] == "small\nmore\n"  # universal newlines, as before
    assert r.output["sizeBytes"] == len(b"small\nmore\r\n")


def test_exactly_the_cap_is_read_and_one_more_byte_is_refused(ws: Path) -> None:
    (ws / "at.txt").write_bytes(b"a" * CAP)
    (ws / "over.txt").write_bytes(b"a" * (CAP + 1))
    at = file_read.run({"path": "at.txt"})
    assert at.ok is True, at.error
    assert at.output["sizeBytes"] == CAP
    over = file_read.run({"path": "over.txt"})
    assert over.ok is False
    assert over.error.startswith("File exceeds 10 MiB")


def test_decoding_is_unchanged(ws: Path) -> None:
    (ws / "mixed.txt").write_bytes(b"a\r\nb\rc\n\xff\n")
    r = file_read.run({"path": "mixed.txt"})
    assert r.ok is True, r.error
    assert r.output["content"] == "a\nb\nc\n�\n"
    assert r.output["sizeBytes"] == 9
