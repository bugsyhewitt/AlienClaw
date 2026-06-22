import pytest
from pathlib import Path
from alienclaw.tools.file_write import run


class TestRunMissingInputs:
    def test_missing_path(self):
        r = run({})
        assert r.ok is False
        assert "Missing 'path'" in r.error

    def test_absent_content_key_returns_error_after_fix(self, tmp_path):
        # This is the key regression test for the fix.
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


class TestRunNormalWrites:
    def test_basic_write(self, tmp_path):
        p = tmp_path / "test.txt"
        r = run({"path": str(p), "content": "hello"})
        assert r.ok is True
        assert p.read_text() == "hello\n"
        assert r.output["bytes_written"] == 6
        assert r.tool_calls == 1
        assert r.correctness == 1.0

    def test_bytes_written_includes_appended_newline(self, tmp_path):
        # Each repeat appends a newline. bytes_written includes the newline.
        p = tmp_path / "test.txt"
        r = run({"path": str(p), "content": "ab"})
        assert r.output["bytes_written"] == 3  # "ab\n" = 3 bytes, not 2

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
        assert r.output["repeat_count"] == 3

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
