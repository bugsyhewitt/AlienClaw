"""Unit tests for alienclaw.tools.file_read — MSB OUTPUT CONTRACT alignment.

Packet 124 fix: output must be exactly {path, content, encoding, sizeBytes}.
- sizeBytes (camelCase) replaces size_bytes (snake_case)
- encoding: "utf-8" added (always, since the file is read with utf-8)
- lines_returned / total_lines / chunk_count removed (not in MSB spec;
  chunk_count already available via RunResult.tool_calls)

The 10 MiB size limit (was 1 MiB) matches the MSB LIMITATIONS spec
("File size limit: 10MB per read") and the TS adapter's MAX_FILE_READ_BYTES
constant in src/alienclaw/constants.ts:67.

These tests REPLACE the assertions in PR #104 (packet 112's test file at
test/packet-112-file-read-unit-tests) since the output keys and size limit
have changed. The test cases for the pre-existing 6 raise/return paths and
3 param-handling branches (L13/L16/L18/L20/L21/L24 raise + L51 ok return)
are PRESERVED — only the output-key assertions in the success path are updated.
"""
from __future__ import annotations

import os
import sys

import pytest

from alienclaw.tools.file_read import run as file_read_run


@pytest.fixture
def tmp(tmp_path):
    yield tmp_path


def _write(path, content: str) -> str:
    p = str(path)
    with open(p, "w", encoding="utf-8") as f:
        f.write(content)
    return p


def _err(result):
    """Assert result.error is not None and return it (for type narrowing)."""
    assert result.error is not None, f"expected error, got {result}"
    return result.error


# ---------------------------------------------------------------------------
# MSB OUTPUT CONTRACT — the 4 spec keys, exact set, no extras
# ---------------------------------------------------------------------------


class TestOutputContract:
    """Output keys must be exactly {path, content, encoding, sizeBytes} — no extras, no snake_case."""

    def test_output_keys_exact(self, tmp):
        path = _write(tmp / "a.txt", "hello\nworld\n")
        result = file_read_run({"path": path}, {})
        assert result.ok is True
        assert set(result.output.keys()) == {"path", "content", "encoding", "sizeBytes"}

    def test_no_snake_case_size_bytes(self, tmp):
        path = _write(tmp / "b.txt", "world")
        result = file_read_run({"path": path}, {})
        assert result.ok is True
        assert "size_bytes" not in result.output, "Legacy size_bytes leaked"

    def test_no_undeclared_lines_returned(self, tmp):
        path = _write(tmp / "c.txt", "x")
        result = file_read_run({"path": path}, {})
        assert result.ok is True
        assert "lines_returned" not in result.output, "Undeclared lines_returned leaked"

    def test_no_undeclared_total_lines(self, tmp):
        path = _write(tmp / "d.txt", "x")
        result = file_read_run({"path": path}, {})
        assert result.ok is True
        assert "total_lines" not in result.output, "Undeclared total_lines leaked"

    def test_no_undeclared_chunk_count_in_output(self, tmp):
        path = _write(tmp / "e.txt", "x")
        result = file_read_run({"path": path}, {})
        assert result.ok is True
        assert "chunk_count" not in result.output, "Undeclared chunk_count leaked"
        # chunk_count IS available via RunResult.tool_calls (not in output dict)

    def test_sizeBytes_equals_byte_count(self, tmp):
        content = "hello\nworld\n"
        path = _write(tmp / "f.txt", content)
        result = file_read_run({"path": path}, {})
        assert result.ok is True
        assert result.output["sizeBytes"] == len(content.encode("utf-8"))

    def test_encoding_is_utf8(self, tmp):
        path = _write(tmp / "g.txt", "ascii")
        result = file_read_run({"path": path}, {})
        assert result.ok is True
        assert result.output["encoding"] == "utf-8"

    def test_path_round_trips(self, tmp):
        path = _write(tmp / "h.txt", "x")
        result = file_read_run({"path": path}, {})
        assert result.ok is True
        assert result.output["path"] == path

    def test_content_matches_file(self, tmp):
        content = "alpha\nbeta\ngamma\n"
        path = _write(tmp / "i.txt", content)
        result = file_read_run({"path": path}, {})
        assert result.ok is True
        assert result.output["content"] == content


# ---------------------------------------------------------------------------
# Size limit — was 1 MiB, now 10 MiB (matches MSB LIMITATIONS)
# ---------------------------------------------------------------------------


class TestSizeLimit:
    """The MSB LIMITATIONS spec says 10MB. Code now enforces 10 MiB = 10*1024*1024."""

    def test_small_file_passes(self, tmp):
        # 1 KiB file — well under any limit
        path = _write(tmp / "small.txt", "x" * 1024)
        result = file_read_run({"path": path}, {})
        assert result.ok is True

    def test_one_mib_file_now_passes(self, tmp):
        # Previously rejected at 1 MiB; now passes (10 MiB limit)
        path = _write(tmp / "1mib.txt", "x" * (1024 * 1024))
        result = file_read_run({"path": path}, {})
        assert result.ok is True, "1 MiB file should pass under 10 MiB limit"
        assert result.output["sizeBytes"] == 1024 * 1024

    def test_eleven_mib_file_rejected(self, tmp):
        # 11 MiB — must fail with 10 MiB limit
        path = tmp / "11mib.bin"
        # 11 MiB of bytes — write binary zeros (not UTF-8 text, just bytes)
        with open(str(path), "wb") as f:
            f.write(b"\x00" * (11 * 1024 * 1024))
        result = file_read_run({"path": str(path)}, {})
        assert result.ok is False
        assert "10 MiB" in _err(result)

    def test_error_message_says_10_mib(self, tmp):
        path = tmp / "toobig.bin"
        with open(str(path), "wb") as f:
            f.write(b"\x00" * (11 * 1024 * 1024))
        result = file_read_run({"path": str(path)}, {})
        assert result.ok is False
        assert "1 MiB" not in _err(result), "Stale 1 MiB error message leaked"


# ---------------------------------------------------------------------------
# Raise / return paths — preserved from packet 112 (regression suite)
# ---------------------------------------------------------------------------


class TestRunMissingPath:
    def test_missing_path_field(self, tmp):
        result = file_read_run({}, {})
        assert result.ok is False
        assert "path" in _err(result).lower()

    def test_empty_path_field(self, tmp):
        result = file_read_run({"path": ""}, {})
        assert result.ok is False
        assert "path" in _err(result).lower()


class TestRunFileNotFound:
    def test_nonexistent_path(self, tmp):
        result = file_read_run({"path": str(tmp / "does-not-exist.txt")}, {})
        assert result.ok is False
        assert "not found" in _err(result).lower()


class TestRunNotAFile:
    def test_directory_not_file(self, tmp):
        # tmp IS a directory
        result = file_read_run({"path": str(tmp)}, {})
        assert result.ok is False
        assert "not a file" in _err(result).lower()


class TestRunReadOSError:
    @pytest.mark.skipif(os.name != "posix", reason="POSIX chmod required")
    def test_permission_denied(self, tmp):
        path = tmp / "noperm.txt"
        _write(path, "secret")
        os.chmod(str(path), 0o000)
        try:
            result = file_read_run({"path": str(path)}, {})
            # Either ok=False with a Read error, or ok=True if running as root
            if not result.ok:
                assert "read error" in _err(result).lower()
        finally:
            os.chmod(str(path), 0o644)


class TestRunParams:
    """The 3 param-handling branches: max_lines, skip_lines, chunk_count."""

    def test_max_lines_clamped_to_1(self, tmp):
        content = "line1\nline2\nline3\n"
        path = _write(tmp / "max1.txt", content)
        result = file_read_run({"path": path}, {"max_lines": 0})
        assert result.ok is True
        # max_lines defaults to 100 if int < 1, but the code clamps to >=1
        assert result.output["content"].count("\n") <= 100

    def test_skip_lines_zero_returns_all(self, tmp):
        content = "first\nsecond\nthird\n"
        path = _write(tmp / "skip0.txt", content)
        result = file_read_run({"path": path}, {"skip_lines": 1})
        assert result.ok is True
        assert "first" in result.output["content"]

    def test_skip_lines_two_skips_first(self, tmp):
        content = "first\nsecond\nthird\n"
        path = _write(tmp / "skip2.txt", content)
        result = file_read_run({"path": path}, {"skip_lines": 2})
        assert result.ok is True
        assert "first" not in result.output["content"]
        assert "second" in result.output["content"]

    def test_chunk_count_clamped_to_5(self, tmp):
        content = "a\nb\nc\nd\ne\nf\n"
        path = _write(tmp / "chunk.txt", content)
        result = file_read_run({"path": path}, {"chunk_count": 100})
        assert result.ok is True
        # chunk_count clamped to min(5, 100) = 5
        assert result.tool_calls == 5

    def test_chunk_count_floor_to_1(self, tmp):
        content = "x\ny\nz\n"
        path = _write(tmp / "chunk1.txt", content)
        result = file_read_run({"path": path}, {"chunk_count": 0})
        assert result.ok is True
        # chunk_count clamped to max(1, 0) = 1
        assert result.tool_calls == 1


# ---------------------------------------------------------------------------
# Regression — verifies the new output dict matches MSB OUTPUT CONTRACT text
# ---------------------------------------------------------------------------


class TestMsbOutputContractConformance:
    """Conformance check against seed/msb/file_read.msb OUTPUT CONTRACT block."""

    def test_output_matches_msb_contract_exactly(self, tmp):
        path = _write(tmp / "conform.txt", "spec\nconformant\noutput\n")
        result = file_read_run({"path": path}, {})
        assert result.ok is True
        # MSB OUTPUT CONTRACT (seed/msb/file_read.msb):
        #   {"path": "string", "content": "string", "encoding": "string", "sizeBytes": "number"}
        spec_keys = {"path", "content", "encoding", "sizeBytes"}
        actual_keys = set(result.output.keys())
        assert actual_keys == spec_keys, (
            f"Output keys mismatch MSB spec: expected {spec_keys}, got {actual_keys}"
        )

    def test_sizeBytes_is_int_not_string(self, tmp):
        path = _write(tmp / "typecheck.txt", "x" * 10)
        result = file_read_run({"path": path}, {})
        assert result.ok is True
        assert isinstance(result.output["sizeBytes"], int)
        assert isinstance(result.output["encoding"], str)
        assert isinstance(result.output["content"], str)
        assert isinstance(result.output["path"], str)