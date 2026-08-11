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
        # PKT-576: inverted — paths OUTSIDE the workspace boundary are rejected even
        # when they have nested parent dirs.  The mkdir primitive must not escape the
        # workspace.  Positive case (inside workspace) is covered by
        # TestWorkspaceBoundary.test_allows_nested_paths_inside_workspace below.
        import shutil
        outside_root = tmp_path.parent / "pkt576-outside"
        p = outside_root / "nested" / "out.txt"
        try:
            r = run({"path": str(p), "content": "should-be-rejected"})
            assert r.ok is False
            assert r.error is not None
            assert "traversal" in r.error.lower()
            assert not p.parent.exists(), "mkdir must not create dirs outside workspace"
        finally:
            shutil.rmtree(outside_root, ignore_errors=True)

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


# ---------------------------------------------------------------------------
# PKT-576 — workspace-boundary enforcement (file_write)
# ALIENCLAW_FILE_WORKSPACE_ROOT is set to tmp_path via conftest autouse fixture.
# ---------------------------------------------------------------------------


class TestWorkspaceBoundary:
    """file_write must reject paths outside ALIENCLAW_FILE_WORKSPACE_ROOT.
    The mkdir primitive (path.parent.mkdir) must not create directories outside
    the workspace boundary.
    """

    def test_rejects_absolute_path_outside_workspace(self, tmp_path):
        # /nonexistent/attack.txt is never under tmp_path
        r = run({"path": "/nonexistent/pkt576-attack.txt", "content": "evil"})
        assert r.ok is False
        assert r.error is not None
        assert "traversal" in r.error.lower()

    def test_rejects_traversal_with_dotdot(self, tmp_path):
        # tmp_path/../escape.txt resolves to tmp_path.parent/escape.txt — outside
        r = run({"path": str(tmp_path / ".." / "pkt576-escape.txt"), "content": "evil"})
        assert r.ok is False
        assert r.error is not None
        assert "traversal" in r.error.lower()

    def test_allows_path_inside_workspace(self, tmp_path):
        p = tmp_path / "safe.txt"
        r = run({"path": str(p), "content": "safe content"})
        assert r.ok is True
        assert p.exists()

    def test_allows_nested_paths_inside_workspace(self, tmp_path):
        # Nested parent dirs inside the workspace are allowed (and created)
        p = tmp_path / "a" / "b" / "out.txt"
        r = run({"path": str(p), "content": "nested"})
        assert r.ok is True
        assert p.exists()

    def test_mkdir_does_not_create_arbitrary_directories(self, tmp_path):
        # The mkdir primitive must NOT create dirs outside the workspace boundary
        import shutil
        outside_dir = tmp_path.parent / "pkt576-attacker-dir"
        try:
            r = run({"path": str(outside_dir / "file.txt"), "content": "evil"})
            assert r.ok is False
            assert not outside_dir.exists(), "attacker directory was created outside workspace"
        finally:
            shutil.rmtree(outside_dir, ignore_errors=True)

    def test_rejection_has_zero_correctness(self, tmp_path):
        r = run({"path": "/etc/pkt576-crontab-test", "content": "evil"})
        assert r.ok is False
        assert r.correctness == 0.0


class TestAtomicWrite:
    """MSB LIMITATIONS: file_write is atomic — no partial writes on interruption."""

    def test_target_intact_on_simulated_crash(self, tmp_path, monkeypatch):
        """A mid-write failure must leave the target file absent or unchanged."""
        from pathlib import Path
        target = tmp_path / "atomic.txt"

        def crashy_write(self, content, **kwargs):
            with open(self, "w") as f:
                f.write("partial - ")
                f.flush()
            raise OSError("Simulated crash mid-write")

        monkeypatch.setattr(Path, "write_text", crashy_write)
        r = run({"path": str(target), "content": "full content"})
        assert r.ok is False
        # Target was absent before write; must remain absent after failure.
        assert not target.exists(), f"target corrupted: {target.read_text()!r}"

    def test_no_tmp_sibling_left_behind(self, tmp_path):
        """After a successful write, no .tmp-* sibling files should remain."""
        target = tmp_path / "no_tmp.txt"
        r = run({"path": str(target), "content": "hello"})
        assert r.ok is True
        siblings = list(tmp_path.iterdir())
        assert siblings == [target]

    def test_overwrite_atomic(self, tmp_path):
        """An overwrite must succeed and replace the old content."""
        target = tmp_path / "overwrite.txt"
        target.write_text("OLD CONTENT - " * 1000, encoding="utf-8")
        r = run({"path": str(target), "content": "NEW"})
        assert r.ok is True
        assert target.read_text() == "NEW\n"
