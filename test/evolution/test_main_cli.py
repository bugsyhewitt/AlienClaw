"""Tests for --seeds CSV validation in alienclaw.evolution.__main__ (PKT-633).

Covers R-101..R-110: the _parse_seeds_csv argparse type= validator must accept
valid comma-separated integers and reject malformed entries with a clean
ArgumentTypeError (exit 2) instead of a raw ValueError traceback.
"""
from __future__ import annotations

import argparse
import io
import sys

import pytest

from alienclaw.evolution.__main__ import _parse_seeds_csv, main


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


# ---------------------------------------------------------------------------
# Unit tests: _parse_seeds_csv directly (R-101..R-110)
# ---------------------------------------------------------------------------

class TestParseSeedsCsvValid:
    """R-101: valid integer CSV inputs must parse to list[int]."""

    def test_simple_valid(self):
        # R-101a: basic three seeds
        assert _parse_seeds_csv("42,43,44") == [42, 43, 44]

    def test_single_seed(self):
        # R-101b: single seed
        assert _parse_seeds_csv("42") == [42]

    def test_seeds_with_surrounding_spaces(self):
        # R-101c: spaces around entries stripped correctly
        assert _parse_seeds_csv(" 42, 43 , 44 ") == [42, 43, 44]

    def test_negative_seed_passes(self):
        # R-101d: negative seeds are valid integers (RNG accepts -1)
        assert _parse_seeds_csv("42,-1,44") == [42, -1, 44]


class TestParseSeedsCsvInvalid:
    """R-102..R-110: malformed entries must raise ArgumentTypeError."""

    def test_non_numeric_entry(self):
        # R-102: 'abc' is not an integer
        with pytest.raises(argparse.ArgumentTypeError, match="invalid seeds entry 'abc'"):
            _parse_seeds_csv("42,abc,44")

    def test_empty_middle_entry(self):
        # R-103: consecutive commas produce an empty entry
        with pytest.raises(argparse.ArgumentTypeError, match="empty entry in --seeds CSV"):
            _parse_seeds_csv("42,,44")

    def test_whitespace_only_entry(self):
        # R-104: whitespace-only entry treated as empty after strip
        with pytest.raises(argparse.ArgumentTypeError, match="empty entry in --seeds CSV"):
            _parse_seeds_csv("42, ,44")

    def test_float_shaped_entry(self):
        # R-105: float-shaped string not accepted
        with pytest.raises(argparse.ArgumentTypeError, match="invalid seeds entry '3.14'"):
            _parse_seeds_csv("42,3.14,44")

    def test_hex_shaped_entry(self):
        # R-106: hex literal not accepted by int()
        with pytest.raises(argparse.ArgumentTypeError, match="invalid seeds entry '0x10'"):
            _parse_seeds_csv("42,0x10,44")

    def test_scientific_shaped_entry(self):
        # R-107: scientific notation not accepted by int()
        with pytest.raises(argparse.ArgumentTypeError, match="invalid seeds entry '1e5'"):
            _parse_seeds_csv("42,1e5,44")

    def test_multiple_trailing_empty_entries(self):
        # R-108: four trailing commas → first empty entry raises
        with pytest.raises(argparse.ArgumentTypeError, match="empty entry in --seeds CSV"):
            _parse_seeds_csv("42,,,,")

    def test_single_non_numeric(self):
        # R-109: single non-numeric value
        with pytest.raises(argparse.ArgumentTypeError, match="invalid seeds entry 'abc'"):
            _parse_seeds_csv("abc")

    def test_empty_csv(self):
        # R-110: empty string must report 'must contain at least one integer'
        with pytest.raises(argparse.ArgumentTypeError, match="must contain at least one integer"):
            _parse_seeds_csv("")


# ---------------------------------------------------------------------------
# Integration tests: main() rejects malformed --seeds with SystemExit(2)
# ---------------------------------------------------------------------------

class TestMainCliSeedsIntegration:
    """Verify the full main() path raises SystemExit(2) for malformed --seeds."""

    def _call_main_expect_exit(self, monkeypatch, seeds_value, tmp_path):
        """Patch sys.argv, call main(), assert SystemExit and return its code."""
        monkeypatch.setattr(sys, "argv", [
            "python3 -m alienclaw.evolution",
            "run-scale-experiment",
            "--martian-type", "compute",
            "--output-dir", str(tmp_path),
            "--seeds", seeds_value,
        ])
        stderr_capture = io.StringIO()
        monkeypatch.setattr(sys, "stderr", stderr_capture)
        with pytest.raises(SystemExit) as exc_info:
            main()
        return exc_info.value.code, stderr_capture.getvalue()

    def test_non_numeric_seeds_exits_2(self, monkeypatch, tmp_path):
        code, _ = self._call_main_expect_exit(monkeypatch, "42,abc,44", tmp_path)
        assert code == 2

    def test_empty_entry_seeds_exits_2(self, monkeypatch, tmp_path):
        code, _ = self._call_main_expect_exit(monkeypatch, "42,,44", tmp_path)
        assert code == 2

    def test_float_seeds_exits_2(self, monkeypatch, tmp_path):
        code, _ = self._call_main_expect_exit(monkeypatch, "42,3.14,44", tmp_path)
        assert code == 2

    def test_hex_seeds_exits_2(self, monkeypatch, tmp_path):
        code, _ = self._call_main_expect_exit(monkeypatch, "42,0x10,44", tmp_path)
        assert code == 2

    def test_scientific_seeds_exits_2(self, monkeypatch, tmp_path):
        code, _ = self._call_main_expect_exit(monkeypatch, "42,1e5,44", tmp_path)
        assert code == 2


# ---------------------------------------------------------------------------
# PKT-1041: --target-fitness validation and emission (R-005, R-006)
# ---------------------------------------------------------------------------

class TestTargetFitnessValidation:
    """R-005: --target-fitness outside (0,1] must return exit 2 (before bridge import)."""

    def _call_main_with_argv(self, monkeypatch, argv):
        monkeypatch.setattr(sys, "argv", argv)
        stderr_capture = io.StringIO()
        monkeypatch.setattr(sys, "stderr", stderr_capture)
        code = main()
        return code, stderr_capture.getvalue()

    def test_target_fitness_zero_returns_exit_2(self, monkeypatch):
        code, err = self._call_main_with_argv(monkeypatch, [
            "prog", "run-experiment", "--martian-type", "compute",
            "--target-fitness", "0",
        ])
        assert code == 2
        assert "--target-fitness" in err

    def test_target_fitness_above_one_returns_exit_2(self, monkeypatch):
        code, err = self._call_main_with_argv(monkeypatch, [
            "prog", "run-experiment", "--martian-type", "compute",
            "--target-fitness", "1.5",
        ])
        assert code == 2
        assert "--target-fitness" in err

    def test_target_fitness_negative_returns_exit_2(self, monkeypatch):
        code, err = self._call_main_with_argv(monkeypatch, [
            "prog", "run-experiment", "--martian-type", "compute",
            "--target-fitness", "-0.1",
        ])
        assert code == 2


class TestTargetFitnessEmission:
    """R-006: target-halted run must emit target_reached JSON with unrounded fitness."""

    def test_emits_target_reached_when_halted(self, monkeypatch, tmp_path):
        import json as _json
        from unittest.mock import MagicMock
        from alienclaw.evolution.generation import FitnessReport

        def make_fixed_runner(martian_type, inputs):
            def runner(mtype, genome):
                return FitnessReport(fitness=1.0, run_metadata={"tool_calls": 1})
            return runner

        mock_module = MagicMock()
        mock_module.make_bridge_runner = make_fixed_runner
        monkeypatch.setitem(sys.modules, "alienclaw.evolution.bridge_runner", mock_module)

        monkeypatch.setattr(sys, "argv", [
            "prog", "run-experiment",
            "--martian-type", "compute",
            "--target-fitness", "0.5",
            "--generations", "10",
            "--population-size", "4",
        ])
        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()
        monkeypatch.setattr(sys, "stdout", stdout_capture)
        monkeypatch.setattr(sys, "stderr", stderr_capture)

        main()

        lines = [l for l in stdout_capture.getvalue().splitlines() if l.strip()]
        target_lines = [l for l in lines if '"target_reached"' in l]
        assert len(target_lines) == 1, f"Expected 1 target_reached line, got: {lines}"
        data = _json.loads(target_lines[0])
        assert data["type"] == "target_reached"
        assert data["fitness"] >= 0.5
        assert isinstance(data["generation"], int)

    def test_no_target_reached_when_never_halted(self, monkeypatch, tmp_path):
        import json as _json
        from unittest.mock import MagicMock
        from alienclaw.evolution.generation import FitnessReport

        def make_zero_runner(martian_type, inputs):
            def runner(mtype, genome):
                return FitnessReport(fitness=0.0, run_metadata={"tool_calls": 1})
            return runner

        mock_module = MagicMock()
        mock_module.make_bridge_runner = make_zero_runner
        monkeypatch.setitem(sys.modules, "alienclaw.evolution.bridge_runner", mock_module)

        monkeypatch.setattr(sys, "argv", [
            "prog", "run-experiment",
            "--martian-type", "compute",
            "--target-fitness", "0.5",
            "--generations", "3",
            "--population-size", "4",
        ])
        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()
        monkeypatch.setattr(sys, "stdout", stdout_capture)
        monkeypatch.setattr(sys, "stderr", stderr_capture)

        main()

        lines = stdout_capture.getvalue().splitlines()
        target_lines = [l for l in lines if '"target_reached"' in l]
        assert len(target_lines) == 0, f"Expected no target_reached line, got: {target_lines}"
