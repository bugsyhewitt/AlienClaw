"""inspect_history: the Step-1 data gate on synthetic histories."""
from __future__ import annotations

import json
import subprocess
import sys

import pytest

from _synth import EXPECTED_FAILS, HISTORIES, row, sufficient, write
from conftest import SRC
from pho3nix_tuner import inspect_history as ih


def _fail_prefixes(report: dict) -> list[str]:
    return [c.split(":", 1)[0] for c in report["fail_conditions"]]


@pytest.mark.parametrize("name", sorted(HISTORIES))
def test_verdicts(tmp_path, name: str) -> None:
    report = ih.inspect(write(tmp_path / f"{name}.json", HISTORIES[name]()))
    assert _fail_prefixes(report) == EXPECTED_FAILS[name]
    assert report["stop_gate"] is bool(EXPECTED_FAILS[name])
    if report["stop_gate"]:
        assert report["stop_reason"] == "; ".join(report["fail_conditions"])
    else:
        assert report["stop_reason"] is None
        assert len(report["pass_conditions"]) == 3


def test_sufficient_report_details(tmp_path) -> None:
    report = ih.inspect(write(tmp_path / "h.json", sufficient(48)))
    assert report["total_rows"] == 48
    assert report["tools"] == {"gobuster": 48}
    assert report["target_tool_rows"] == 48
    assert report["timestamps_present"] is True
    assert report["timestamp_span_days"] == pytest.approx(47 / 24, abs=0.01)
    ctx = report["per_context"]["gobuster|https"]
    assert ctx == {
        "count": 48, "success_rate": 0.25, "timeout_rate": 0.5,
        "partial_rate": 0.25, "param_signatures": 4,
    }


def test_empty_report_shape(tmp_path) -> None:
    report = ih.inspect(write(tmp_path / "h.json", []))
    assert report["total_rows"] == 0
    assert report["per_context"] == {}
    assert report["timestamp_span_days"] is None


@pytest.mark.parametrize(("n", "stop"), [(19, True), (20, False)])
def test_target_row_threshold_is_twenty(tmp_path, n: int, stop: bool) -> None:
    report = ih.inspect(write(tmp_path / "h.json", sufficient(n)))
    assert ("no-target-data" in _fail_prefixes(report)) is stop
    assert report["stop_gate"] is stop


def test_unparseable_timestamp_counts_as_absent(tmp_path) -> None:
    rows = sufficient(24)
    rows[3]["timestamp"] = "yesterday-ish"
    report = ih.inspect(write(tmp_path / "h.json", rows))
    assert report["timestamps_present"] is False
    assert _fail_prefixes(report) == ["no-timestamps"]


def test_mixed_naive_and_aware_timestamps_count_as_absent(tmp_path) -> None:
    rows = sufficient(24)
    rows[0]["timestamp"] = "2026-01-01T00:00:00"  # naive; the rest are UTC-aware
    report = ih.inspect(write(tmp_path / "h.json", rows))
    assert report["timestamps_present"] is False


def test_z_suffix_timestamps_parse(tmp_path) -> None:
    rows = [
        row(i, params={"threads": i % 3}, timestamp=f"2026-11-{1 + i % 20:02d}T00:00:00Z")
        for i in range(24)
    ]
    report = ih.inspect(write(tmp_path / "h.json", rows))
    assert report["timestamps_present"] is True
    assert report["timestamp_span_days"] == 19.0


def test_contexts_bucket_by_scheme(tmp_path) -> None:
    endpoints = ["https://a.test", "http://a.test", "ftp://a.test", "10.0.0.1", "", None]
    rows = [row(i, endpoint=e) for i, e in enumerate(endpoints)]
    report = ih.inspect(write(tmp_path / "h.json", rows))
    assert set(report["per_context"]) == {
        "gobuster|https", "gobuster|http", "gobuster|ftp", "gobuster|raw", "gobuster|unknown",
    }
    assert report["per_context"]["gobuster|unknown"]["count"] == 2


def test_variation_gate_is_global_not_per_context(tmp_path) -> None:
    """Documented fragility: ONE varied context opens the gate for every context."""
    rows = [row(i, params=dict(i=0)) for i in range(20)]  # gobuster|https: 1 signature
    rows += [row(100 + i, tool="nmap", endpoint="10.0.0.1", params={"t": i % 2})
             for i in range(2)]  # nmap|raw: 2 signatures
    report = ih.inspect(write(tmp_path / "h.json", rows))
    assert report["per_context"]["gobuster|https"]["param_signatures"] == 1
    assert report["stop_gate"] is False


@pytest.mark.parametrize("key", ["entries", "runs", "history"])
def test_envelopes(tmp_path, key: str) -> None:
    report = ih.inspect(write(tmp_path / "h.json", {key: sufficient(24)}))
    assert report["total_rows"] == 24
    assert report["stop_gate"] is False


def test_unknown_envelope_reads_as_empty(tmp_path) -> None:
    report = ih.inspect(write(tmp_path / "h.json", {"rows": sufficient(24)}))
    assert report["total_rows"] == 0
    assert report["stop_gate"] is True


def _cli(*args: str, env: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SRC / "pho3nix_tuner" / "inspect_history.py"), *args],
        capture_output=True, text=True, env=env, timeout=60,
    )


@pytest.mark.parametrize("name", sorted(HISTORIES))
def test_cli_exit_codes(tmp_path, sub_env, name: str) -> None:
    path = write(tmp_path / f"{name}.json", HISTORIES[name]())
    expect = 1 if EXPECTED_FAILS[name] else 0
    human = _cli(str(path), env=sub_env)
    assert human.returncode == expect, human.stdout + human.stderr
    assert ("STOP ✗" in human.stdout) is bool(expect)
    assert ("GO ✓" in human.stdout) is not bool(expect)
    as_json = _cli("--json", "--history-path", str(path), env=sub_env)
    assert as_json.returncode == expect
    assert json.loads(as_json.stdout)["stop_gate"] is bool(expect)


def test_cli_missing_file_exits_1(tmp_path, sub_env) -> None:
    out = _cli("--json", str(tmp_path / "nope.json"), env=sub_env)
    assert out.returncode == 1
    assert json.loads(out.stdout)["stop_gate"] is True


def test_cli_default_path_is_under_home(sub_env) -> None:
    """No path given: reads ~/.pho3nix_data/... under the (tmp) HOME, which is absent."""
    out = _cli(env=sub_env)
    assert out.returncode == 1
    assert sub_env["HOME"] in out.stderr
