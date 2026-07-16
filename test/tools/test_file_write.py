"""Unit tests for alienclaw.tools.file_write.

Packet 111: run() must reject an absent/None 'content' key (guard tests).
Packet 121: output must follow the MSB OUTPUT CONTRACT — exactly
{path, bytesWritten, encoding}, camelCase, no extras (repeat_count,
bytes_written must not leak).
"""
from alienclaw.tools.file_write import run


class TestRunMissingInputs:
    def test_missing_path(self):
        r = run({})
        assert r.ok is False
        assert "Missing 'path'" in r.error
        assert r.correctness == 0.0

    def test_absent_content_key_returns_error_after_fix(self, tmp_path):
        # This is the key regression test for the packet-111 fix.
        # Before fix: ok=True, writes "\n"
        # After fix:  ok=False, error="Missing 'content' field"
        p = tmp_path / "out.txt"
        r = run({"path": str(p)})
        assert r.ok is False
        assert "Missing 'content'" in r.error
        assert not p.exists()

    def test_explicit_none_content_returns_error(self, tmp_path):
        p = tmp_path / "out.txt"
        r = run({"path": str(p), "content": None})
        assert r.ok is False
        assert "Missing 'content'" in r.error
        assert r.correctness == 0.0


class TestRunNormalWrites:
    def test_basic_write(self, tmp_path):
        p = tmp_path / "test.txt"
        r = run({"path": str(p), "content": "hello"})
        assert r.ok is True
        assert p.read_text() == "hello\n"
        assert r.output["bytesWritten"] == 6
        assert r.tool_calls == 1
        assert r.correctness == 1.0

    def test_bytes_written_includes_appended_newline(self, tmp_path):
        # Each repeat appends a newline. bytesWritten includes the newline.
        p = tmp_path / "test.txt"
        r = run({"path": str(p), "content": "ab"})
        assert r.output["bytesWritten"] == 3  # "ab\n" = 3 bytes, not 2

    def test_creates_parent_directories(self, tmp_path):
        p = tmp_path / "a" / "b" / "out.txt"
        r = run({"path": str(p), "content": "nested"})
        assert r.ok is True
        assert p.exists()

    def test_path_in_output(self, tmp_path):
        p = tmp_path / "out.txt"
        r = run({"path": str(p), "content": "x"})
        assert r.output["path"] == str(p)


class TestRunRepeatCount:
    def test_repeat_count_3(self, tmp_path):
        p = tmp_path / "repeat.txt"
        r = run({"path": str(p), "content": "x"}, {"repeat_count": 3})
        assert r.ok is True
        assert r.tool_calls == 3
        assert p.read_text() == "x\nx\nx\n"

    def test_repeat_count_clamped_to_5(self, tmp_path):
        p = tmp_path / "clamped.txt"
        r = run({"path": str(p), "content": "a"}, {"repeat_count": 99})
        assert r.tool_calls == 5

    def test_repeat_count_clamped_to_1(self, tmp_path):
        p = tmp_path / "clamped_low.txt"
        r = run({"path": str(p), "content": "a"}, {"repeat_count": 0})
        assert r.tool_calls == 1


class TestRunOSError:
    def test_write_to_readonly_directory(self, tmp_path):
        readonly = tmp_path / "ro"
        readonly.mkdir()
        readonly.chmod(0o444)
        p = readonly / "fail.txt"
        r = run({"path": str(p), "content": "x"})
        assert r.ok is False
        assert "Write error" in r.error
        readonly.chmod(0o755)


class TestOutputContract:
    """Output keys must be exactly {path, bytesWritten, encoding} — no extras, no snake_case."""

    def test_output_keys_exact(self, tmp_path):
        r = run({"path": str(tmp_path / "a.txt"), "content": "hello"})
        assert r.ok is True
        assert set(r.output.keys()) == {"path", "bytesWritten", "encoding"}

    def test_no_snake_case_bytes_written(self, tmp_path):
        r = run({"path": str(tmp_path / "b.txt"), "content": "world"})
        assert r.ok is True
        assert "bytes_written" not in r.output, "Legacy bytes_written leaked"

    def test_no_repeat_count_in_output(self, tmp_path):
        r = run({"path": str(tmp_path / "c.txt"), "content": "x"})
        assert r.ok is True
        assert "repeat_count" not in r.output

    def test_bytes_written_equals_utf8_length(self, tmp_path):
        content = "hello"
        r = run({"path": str(tmp_path / "d.txt"), "content": content})
        assert r.ok is True
        expected = len((content + "\n").encode("utf-8"))
        assert r.output["bytesWritten"] == expected

    def test_encoding_is_utf8(self, tmp_path):
        r = run({"path": str(tmp_path / "e.txt"), "content": "data"})
        assert r.ok is True
        assert r.output["encoding"] == "utf-8"

    def test_path_round_trips(self, tmp_path):
        target = str(tmp_path / "f.txt")
        r = run({"path": target, "content": "round-trip"})
        assert r.ok is True
        assert r.output["path"] == target
