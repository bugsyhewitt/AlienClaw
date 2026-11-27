"""Regression (2026-11-26 review, finding 3): file_read's open is race-safe.

Every check runs on paths before the open, so the file can be swapped after them:
- a FIFO swapped in made os.open(O_RDONLY) block forever (no writer ever comes);
- the 10 MiB limit used os.path.getsize() on the path, not the file actually opened;
- O_NOFOLLOW guards only the final component, so a directory swapped for a symlink
  was still followed.
file_read now opens with O_NOFOLLOW | O_NONBLOCK, walking from the root with one
dir fd per component (O_NOFOLLOW | O_DIRECTORY) where the platform supports dir_fd,
then fstat()s the fd: it must be S_ISREG, and the size limit uses its st_size.

The swap is injected at os.open, i.e. after every check. All fixtures live in tmp_path.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path

import pytest

import alienclaw.tools.file_read as file_read
from alienclaw.tools.file_read import run as file_read_run

TIMEOUT_S = 5.0


def _swap_at_open(monkeypatch: pytest.MonkeyPatch, name: str, swap) -> None:
    """Run swap() once, just before the first os.open whose final component is `name`."""
    real_open = os.open
    done = []

    def spy(path, flags, *args, **kwargs):
        if not done and os.path.basename(os.fspath(path)) == name:
            done.append(True)
            swap()
        return real_open(path, flags, *args, **kwargs)

    monkeypatch.setattr(os, "open", spy)


@pytest.mark.skipif(not hasattr(os, "mkfifo"), reason="platform has no FIFOs")
def test_fifo_swapped_in_after_checks_returns_promptly(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "f.txt"
    target.write_text("regular\n")

    def to_fifo() -> None:
        target.unlink()
        os.mkfifo(target)

    _swap_at_open(monkeypatch, "f.txt", to_fifo)
    result = []
    worker = threading.Thread(
        target=lambda: result.append(file_read_run({"path": "f.txt"})), daemon=True
    )
    worker.start()
    worker.join(TIMEOUT_S)
    hung = worker.is_alive()
    if hung:  # unblock the reader so the thread does not outlive the test
        fd = os.open(target, os.O_WRONLY | os.O_NONBLOCK)
        os.close(fd)
        worker.join(TIMEOUT_S)
    assert not hung, f"file_read blocked > {TIMEOUT_S}s opening a FIFO"
    r = result[0]
    assert r.ok is False
    assert r.error == "Not a file: f.txt"


def test_size_limit_applies_to_the_opened_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(file_read, "_MAX_BYTES", 16)
    target = tmp_path / "f.txt"
    target.write_text("tiny\n")

    def grow() -> None:
        bigger = tmp_path / "bigger.tmp"
        bigger.write_text("B" * 64)
        os.replace(bigger, target)

    _swap_at_open(monkeypatch, "f.txt", grow)
    r = file_read_run({"path": "f.txt"})
    assert r.ok is False, f"over-limit file was read: {r.output!r}"
    assert r.error == "File exceeds 10 MiB (64 bytes)"


@pytest.mark.skipif(
    not (hasattr(os, "O_NOFOLLOW") and hasattr(os, "O_DIRECTORY"))
    or os.open not in os.supports_dir_fd,
    reason="no O_NOFOLLOW/O_DIRECTORY/dir_fd: ancestor swaps are a documented limitation",
)
def test_directory_swapped_for_symlink_after_checks_is_not_followed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ws = tmp_path / "ws"
    (ws / "sub").mkdir(parents=True)
    (ws / "sub" / "f.txt").write_text("inside\n")
    (tmp_path / "outside").mkdir()
    (tmp_path / "outside" / "f.txt").write_text("OUTSIDE_FIXTURE\n")
    monkeypatch.setenv("ALIENCLAW_FILE_WORKSPACE_ROOT", str(ws))
    real_open = os.open
    done = []

    def swap_on_first_open(path, flags, *args, **kwargs):
        if not done:
            done.append(True)
            (ws / "sub").rename(ws / "sub_moved")
            (ws / "sub").symlink_to(tmp_path / "outside")
        return real_open(path, flags, *args, **kwargs)

    monkeypatch.setattr(os, "open", swap_on_first_open)
    r = file_read_run({"path": "sub/f.txt"})
    assert done, "os.open was never reached"
    assert r.ok is False, f"swapped-in directory symlink was followed: {r.output!r}"
    assert "OUTSIDE_FIXTURE" not in repr(r.output)
    assert (r.error or "").startswith("Read error: ")


def test_regular_file_still_read_and_size_reported(tmp_path: Path) -> None:
    (tmp_path / "d").mkdir()
    (tmp_path / "d" / "f.txt").write_text("a\r\nb\n")
    r = file_read_run({"path": "d/f.txt"})
    assert r.ok is True, r.error
    assert r.output["content"] == "a\nb\n"
    assert r.output["sizeBytes"] == len("a\r\nb\n")


def test_no_fd_leak_on_any_outcome(tmp_path: Path) -> None:
    if not os.path.isdir("/proc/self/fd"):
        pytest.skip("needs /proc/self/fd")
    (tmp_path / "d").mkdir()
    (tmp_path / "d" / "f.txt").write_text("x\n")
    if hasattr(os, "mkfifo"):
        os.mkfifo(tmp_path / "d" / "pipe")
    before = len(os.listdir("/proc/self/fd"))
    for p in ("d/f.txt", "d/pipe", "d", "d/missing.txt"):
        file_read_run({"path": p})
    assert len(os.listdir("/proc/self/fd")) == before
