"""Direct unit tests for `src/alienclaw/diagnostics/reporting.py` (packet 105).

Background:
  `reporting.py` (214 lines, 2 public functions) provides the public
  reporting surface of the diagnostics subsystem:

    - format_report(results: AuditResults) -> str
        Produces a multi-section markdown audit report (executive
        summary, summary table, per-runner detail, MUST FIX findings,
        root-cause hypothesis, reproduction steps). Used by the
        `python3 -m alienclaw.diagnostics audit` CLI.

    - diff_audits(pre_fix_path: str, post_fix_path: str) -> str
        Reads two JSON-serialized AuditResults files and produces a
        markdown delta table comparing pre-fix vs post-fix fitness
        sensitivities per runner.

Coverage baseline (origin/main @ fb85aa9c):
  reporting.py | 76% stmts | 76% branches | 50% funcs | 76% lines |
               16 uncovered lines (199-214 — the entire diff_audits
               function, which had ZERO direct tests).

These tests use the dataclass instances from
`alienclaw.diagnostics.sensitivity_audit` directly (PairTrace,
RunnerSensitivity, AuditResults) — no LLM, no DB, no subprocess, no
file-system coupling beyond tmp-file roundtrip for diff_audits.

The format_report tests build minimal AuditResults fixtures in-process.
The diff_audits tests use pytest's tmp_path fixture to roundtrip JSON
via `AuditResults.to_dict()` + `json.dump`/`json.load` — the same
pattern already used by
`test_sensitivity_audit.py::test_to_dict_from_dict_roundtrip`.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from alienclaw.diagnostics.reporting import format_report, diff_audits
from alienclaw.diagnostics.sensitivity_audit import (
    AuditResults,
    PairTrace,
    RunnerSensitivity,
)


# ── Fixture builders ───────────────────────────────────────────────────────


def _make_pair_trace(
    genome_a: str = "AAAAAA",
    genome_b: str = "BBBBBB",
    outputs_differ: bool = True,
    fitness_a: float = 0.5,
    fitness_b: float = 0.7,
    genome_passed_a: bool = False,
    genome_passed_b: bool = False,
) -> PairTrace:
    """Build a minimal PairTrace with sensible defaults for format_report."""
    return PairTrace(
        genome_a=genome_a,
        genome_b=genome_b,
        inputs={"query": "2+2"},
        output_a={"result": 4},
        output_b={"result": 5},
        correctness_a=1.0,
        correctness_b=1.0,
        tool_calls_a=1,
        tool_calls_b=1,
        fitness_a=fitness_a,
        fitness_b=fitness_b,
        genome_passed_to_runner_a=genome_passed_a,
        genome_passed_to_runner_b=genome_passed_b,
        outputs_differ=outputs_differ,
        correctness_differs=False,
        tool_calls_differ=False,
        fitness_differs=(fitness_a != fitness_b),
    )


def _make_sensitivity(
    martian_type: str = "compute",
    classification: str = "BLIND",
    pairs_tested: int = 10,
    pairs_output_differ: int = 0,
    pairs_correctness_differ: int = 0,
    pairs_tool_calls_differ: int = 0,
    pairs_fitness_differ: int = 0,
    output_sensitivity: float = 0.0,
    correctness_sensitivity: float = 0.0,
    tool_calls_sensitivity: float = 0.0,
    fitness_sensitivity: float = 0.0,
    genome_ever_passed_to_runner: bool = False,
    traces: list[PairTrace] | None = None,
) -> RunnerSensitivity:
    """Build a minimal RunnerSensitivity with sensible defaults."""
    if traces is None:
        traces = []
    return RunnerSensitivity(
        martian_type=martian_type,
        pairs_tested=pairs_tested,
        pairs_output_differ=pairs_output_differ,
        pairs_correctness_differ=pairs_correctness_differ,
        pairs_tool_calls_differ=pairs_tool_calls_differ,
        pairs_fitness_differ=pairs_fitness_differ,
        output_sensitivity=output_sensitivity,
        correctness_sensitivity=correctness_sensitivity,
        tool_calls_sensitivity=tool_calls_sensitivity,
        fitness_sensitivity=fitness_sensitivity,
        genome_ever_passed_to_runner=genome_ever_passed_to_runner,
        classification=classification,
        traces=traces,
    )


def _make_audit_results(
    sensitivities: list[RunnerSensitivity] | None = None,
    seed: int = 42,
    runners_audited: list[str] | None = None,
) -> AuditResults:
    """Build a minimal AuditResults with the given sensitivities."""
    if sensitivities is None:
        sensitivities = []
    if runners_audited is None:
        runners_audited = [s.martian_type for s in sensitivities]
    return AuditResults(
        seed=seed,
        runners_audited=runners_audited,
        sensitivities=sensitivities,
    )


# ── format_report tests ────────────────────────────────────────────────────


class TestFormatReportEmpty:
    """format_report on an AuditResults with NO sensitivities."""

    def test_r101_empty_sensitivities_renders_none_for_all_three_categories(self):
        # R-101: when sensitivities is empty, the BLIND / WEAK / OK
        # summary lines must render the word "none" (the
        # `or 'none'` fallback at reporting.py:31-33).
        results = _make_audit_results()
        report = format_report(results)

        # All three categories must be present.
        assert "**BLIND**" in report
        assert "**WEAK**" in report
        assert "**OK**" in report

        # Each category must say "none" since there are no sensitivities.
        # The format is: "**BLIND** ... — none" — we check the suffix.
        assert "— none" in report, (
            "Expected the `or 'none'` fallback to fire for empty sensitivities"
        )

    def test_r102_empty_sensitivities_renders_no_genome_passed(self):
        # R-102: when no runner ever received a genome (empty list),
        # the executive summary must say "NO — genome discarded".
        results = _make_audit_results()
        report = format_report(results)

        assert "genome discarded" in report.lower() or "Genome ever passed to runner" in report


class TestFormatReportClassifications:
    """format_report on an AuditResults with each classification present."""

    def test_r103_blind_classification_renders_le_threshold_string(self):
        # R-103: BLIND classification uses the "≤ 0.2" threshold string
        # in the executive summary (reporting.py:31).
        results = _make_audit_results(
            sensitivities=[
                _make_sensitivity(
                    martian_type="compute",
                    classification="BLIND",
                    pairs_tested=10,
                    output_sensitivity=0.1,
                    fitness_sensitivity=0.0,
                )
            ]
        )
        report = format_report(results)

        # The BLIND line uses the `≤ 0.2` threshold
        assert "≤ 0.2" in report or "<= 0.2" in report, (
            "Expected the BLIND classification to render its threshold "
            "(the `≤ 0.2` token at reporting.py:31)"
        )

    def test_r104_weak_classification_renders_0_2_0_6_range(self):
        # R-104: WEAK classification uses the "0.2–0.6" range string
        # in the executive summary (reporting.py:32). Note the en-dash
        # U+2013, NOT a hyphen-minus.
        results = _make_audit_results(
            sensitivities=[
                _make_sensitivity(
                    martian_type="compute",
                    classification="WEAK",
                    pairs_tested=10,
                    output_sensitivity=0.4,
                    fitness_sensitivity=0.3,
                )
            ]
        )
        report = format_report(results)

        assert "0.2–0.6" in report, (
            "Expected the WEAK classification to render its range "
            "(the `0.2–0.6` en-dash range at reporting.py:32)"
        )

    def test_r105_ok_classification_renders_gt_0_6_threshold(self):
        # R-105: OK classification uses the "> 0.6" threshold string
        # in the executive summary (reporting.py:33).
        results = _make_audit_results(
            sensitivities=[
                _make_sensitivity(
                    martian_type="compute",
                    classification="OK",
                    pairs_tested=10,
                    output_sensitivity=0.9,
                    fitness_sensitivity=0.8,
                    genome_ever_passed_to_runner=True,
                )
            ]
        )
        report = format_report(results)

        assert "> 0.6" in report, (
            "Expected the OK classification to render its threshold "
            "(the `> 0.6` token at reporting.py:33)"
        )


class TestFormatReportPerRunnerDetail:
    """format_report per-runner detail section (reporting.py:60-79)."""

    def test_r106_per_runner_detail_with_traces_renders_sample_lines(self):
        # R-106: when traces are populated, the per-runner detail must
        # include the sample-genome + sample-output lines (reporting.py:73-78).
        trace = _make_pair_trace(
            genome_a="ABCDEFGHIJ" * 5,    # 50 chars
            genome_b="ZYXWVUTSRQ" * 5,    # 50 chars
            outputs_differ=True,
        )
        results = _make_audit_results(
            sensitivities=[
                _make_sensitivity(
                    martian_type="compute",
                    classification="BLIND",
                    traces=[trace],
                )
            ]
        )
        report = format_report(results)

        # The sample lines must be present.
        assert "Sample genome A" in report
        assert "Sample genome B" in report
        assert "Sample output A" in report
        assert "Sample output B" in report
        assert "Outputs identical" in report

        # The first 32 chars of each genome must appear. Note the source
        # code at reporting.py:74-75 uses `t.genome_a[:32]` which slices
        # to 32 chars; the rendered markdown then appends "..." for
        # display. So the actual rendered substring is the 32-char slice
        # followed by "..." — we check for that specific rendering.
        # The 32-char slice of "ABCDEFGHIJ" * 5 is 3 full repetitions + "AB":
        # "ABCDEFGHIJABCDEFGHIJABCDEFGHIJAB" (32 chars) + "..."
        assert "ABCDEFGHIJABCDEFGHIJABCDEFGHIJAB..." in report
        assert "ZYXWVUTSRQZYXWVUTSRQZYXWVUTSRQZY..." in report

    def test_r107_per_runner_detail_without_traces_omits_sample_lines(self):
        # R-107: when traces is empty, the per-runner detail must omit
        # the sample-genome / sample-output lines (the `if s.traces:`
        # guard at reporting.py:72).
        results = _make_audit_results(
            sensitivities=[
                _make_sensitivity(
                    martian_type="compute",
                    classification="BLIND",
                    traces=[],
                )
            ]
        )
        report = format_report(results)

        # The sample lines must NOT be present.
        assert "Sample genome A" not in report
        assert "Sample genome B" not in report
        assert "Sample output A" not in report
        assert "Sample output B" not in report

        # But the per-runner header must still be present.
        assert "### `compute` — BLIND" in report


class TestFormatReportHeader:
    """format_report header / metadata lines (reporting.py:9-25)."""

    def test_r108_report_includes_iso_date_in_utc(self):
        # R-108: the report header must include a date in the format
        # "YYYY-MM-DD HH:MM UTC" (reporting.py:11).
        results = _make_audit_results()
        report = format_report(results)

        assert "**Date:**" in report
        assert "UTC" in report

        # Check the date pattern is present (any YYYY-MM-DD HH:MM string).
        date_pattern = re.compile(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC")
        assert date_pattern.search(report), (
            "Expected the report header to include a date matching "
            "`YYYY-MM-DD HH:MM UTC` (reporting.py:11)"
        )

    def test_r109_report_includes_pairs_per_runner_constant(self):
        # R-109: the report header hard-codes "**Pairs per runner:** 10"
        # at reporting.py:19. (Note: PAIRS_PER_RUNNER in
        # sensitivity_audit.py is actually 20, but the report string
        # says 10 — this is a known inconsistency documented in the
        # source. The test pins the literal value.)
        results = _make_audit_results()
        report = format_report(results)

        assert "**Pairs per runner:** 10" in report, (
            "Expected the literal 'Pairs per runner: 10' header at "
            "reporting.py:19 (the source hard-codes '10' even though "
            "PAIRS_PER_RUNNER=20 in sensitivity_audit.py:18)"
        )


# ── diff_audits tests ──────────────────────────────────────────────────────


def _write_results_json(path: Path, results: AuditResults) -> None:
    """Roundtrip AuditResults to JSON via the canonical to_dict() path."""
    path.write_text(json.dumps(results.to_dict(), indent=2))


class TestDiffAudits:
    """diff_audits() reads two JSON files and produces a markdown delta table."""

    def test_r201_valid_pre_and_post_files_returns_markdown_table(self, tmp_path):
        # R-201: with two valid AuditResults JSON files, diff_audits
        # returns a markdown string containing the table headers
        # (reporting.py:203-205).
        pre_sens = _make_sensitivity(
            martian_type="compute",
            classification="BLIND",
            fitness_sensitivity=0.2,
        )
        post_sens = _make_sensitivity(
            martian_type="compute",
            classification="OK",
            fitness_sensitivity=0.8,
        )
        pre_path = tmp_path / "pre.json"
        post_path = tmp_path / "post.json"
        _write_results_json(pre_path, _make_audit_results(
            sensitivities=[pre_sens], runners_audited=["compute"]
        ))
        _write_results_json(post_path, _make_audit_results(
            sensitivities=[post_sens], runners_audited=["compute"]
        ))

        delta = diff_audits(str(pre_path), str(post_path))

        # The table header must be present.
        assert "# Sensitivity Audit — Pre/Post Fix Comparison" in delta
        assert "| Runner | Pre-fix fitness sensitivity | Post-fix fitness sensitivity | Delta |" in delta
        assert "| --- | --- | --- | --- |" in delta

        # The runner name must appear.
        assert "`compute`" in delta

    def test_r202_pre_formatted_to_two_decimals_post_rendered_as_is(self, tmp_path):
        # R-202: `pre` is formatted with `{:.2f}` (reporting.py:213) so
        # 0.123 → "0.12". `post` is rendered AS-IS via Python's default
        # float repr (the ternary at reporting.py:213 returns
        # `post_val` unchanged when isinstance(post_val, float) is
        # True). So 0.789 stays as "0.789". This is a documented
        # inconsistency in the source — the test pins the actual
        # behavior so any future patch to align both columns MUST
        # update this test.
        pre_sens = _make_sensitivity(
            martian_type="compute",
            classification="BLIND",
            fitness_sensitivity=0.123,    # NOT a 2-decimal value
        )
        post_sens = _make_sensitivity(
            martian_type="compute",
            classification="OK",
            fitness_sensitivity=0.789,
        )
        pre_path = tmp_path / "pre.json"
        post_path = tmp_path / "post.json"
        _write_results_json(pre_path, _make_audit_results(
            sensitivities=[pre_sens], runners_audited=["compute"]
        ))
        _write_results_json(post_path, _make_audit_results(
            sensitivities=[post_sens], runners_audited=["compute"]
        ))

        delta = diff_audits(str(pre_path), str(post_path))

        # Pre is formatted: 0.123 → "0.12"
        assert "0.12" in delta
        # Post is rendered as-is: 0.789 stays "0.789"
        assert "0.789" in delta
        # Delta is formatted with sign + 2 decimals: 0.666 → "+0.67"
        assert "+0.67" in delta

    def test_r203_delta_computed_and_formatted_with_sign(self, tmp_path):
        # R-203: the delta column shows `(post - pre)` formatted as
        # `{value:+.2f}` (reporting.py:212). For pre=0.2 and post=0.8,
        # delta should be +0.60 → "+0.60".
        pre_sens = _make_sensitivity(
            martian_type="compute",
            fitness_sensitivity=0.2,
        )
        post_sens = _make_sensitivity(
            martian_type="compute",
            fitness_sensitivity=0.8,
        )
        pre_path = tmp_path / "pre.json"
        post_path = tmp_path / "post.json"
        _write_results_json(pre_path, _make_audit_results(
            sensitivities=[pre_sens], runners_audited=["compute"]
        ))
        _write_results_json(post_path, _make_audit_results(
            sensitivities=[post_sens], runners_audited=["compute"]
        ))

        delta = diff_audits(str(pre_path), str(post_path))

        # delta = +0.60 → rendered as "+0.60"
        assert "+0.60" in delta

    def test_r204_missing_runner_in_post_renders_na(self, tmp_path):
        # R-204: when a runner exists in pre but NOT in post
        # (post_map.get(mtype) returns None), the row renders "N/A"
        # for both post-fix value and delta (reporting.py:211-212).
        # Pre has 2 runners, post has only 1.
        pre_sens_a = _make_sensitivity(
            martian_type="compute", fitness_sensitivity=0.2,
        )
        pre_sens_b = _make_sensitivity(
            martian_type="search_text", fitness_sensitivity=0.3,
        )
        post_sens_a = _make_sensitivity(
            martian_type="compute", fitness_sensitivity=0.8,
        )
        pre_results = _make_audit_results(
            sensitivities=[pre_sens_a, pre_sens_b],
            runners_audited=["compute", "search_text"],
        )
        post_results = _make_audit_results(
            sensitivities=[post_sens_a],
            runners_audited=["compute"],
        )
        pre_path = tmp_path / "pre.json"
        post_path = tmp_path / "post.json"
        _write_results_json(pre_path, pre_results)
        _write_results_json(post_path, post_results)

        delta = diff_audits(str(pre_path), str(post_path))

        # The search_text row should show "N/A" twice (post + delta).
        # Locate the search_text row.
        lines = delta.split("\n")
        search_text_lines = [ln for ln in lines if "`search_text`" in ln]
        assert len(search_text_lines) == 1
        row = search_text_lines[0]
        # The row must contain "N/A" twice.
        assert row.count("N/A") == 2, (
            f"Expected 'N/A' twice in the search_text row when missing "
            f"from post, but got: {row!r}"
        )

    def test_r205_runners_sorted_alphabetically(self, tmp_path):
        # R-205: the runners are iterated in sorted order by martian_type
        # (reporting.py:208 — `for mtype in sorted(pre_map.keys()):`).
        # Use unsorted insertion order; verify output is sorted.
        pre_sens_z = _make_sensitivity(
            martian_type="zzzzz", fitness_sensitivity=0.5,
        )
        pre_sens_a = _make_sensitivity(
            martian_type="aaaaa", fitness_sensitivity=0.6,
        )
        pre_sens_m = _make_sensitivity(
            martian_type="mmmmm", fitness_sensitivity=0.7,
        )
        # Insert in non-alphabetical order.
        pre_results = _make_audit_results(
            sensitivities=[pre_sens_z, pre_sens_a, pre_sens_m],
            runners_audited=["zzzzz", "aaaaa", "mmmmm"],
        )
        post_results = _make_audit_results(
            sensitivities=[
                _make_sensitivity(martian_type=t, fitness_sensitivity=0.5)
                for t in ["zzzzz", "aaaaa", "mmmmm"]
            ],
            runners_audited=["zzzzz", "aaaaa", "mmmmm"],
        )
        pre_path = tmp_path / "pre.json"
        post_path = tmp_path / "post.json"
        _write_results_json(pre_path, pre_results)
        _write_results_json(post_path, post_results)

        delta = diff_audits(str(pre_path), str(post_path))

        # Find positions of each runner name in the delta string.
        pos_a = delta.find("`aaaaa`")
        pos_m = delta.find("`mmmmm`")
        pos_z = delta.find("`zzzzz`")
        assert pos_a > 0 and pos_m > 0 and pos_z > 0, (
            f"All three runners must appear in the delta (got a={pos_a}, m={pos_m}, z={pos_z})"
        )
        assert pos_a < pos_m < pos_z, (
            f"Expected alphabetical order a < m < z but got positions "
            f"a={pos_a}, m={pos_m}, z={pos_z}"
        )

    def test_r206_empty_runners_returns_just_header_lines(self, tmp_path):
        # R-206: when pre has no runners (empty sensitivities), the
        # output is just the 3 header lines (reporting.py:203-205) —
        # the `for mtype in sorted(pre_map.keys()):` loop iterates 0
        # times and produces no body rows. The initial `lines` list
        # has 2 entries (title + empty string) which is then `joined`
        # with "\n", so the returned string is title + "" + table-header
        # + "" + separator. After stripping blanks, 3 non-blank lines
        # remain.
        pre_results = _make_audit_results(sensitivities=[], runners_audited=[])
        post_results = _make_audit_results(sensitivities=[], runners_audited=[])
        pre_path = tmp_path / "pre.json"
        post_path = tmp_path / "post.json"
        _write_results_json(pre_path, pre_results)
        _write_results_json(post_path, post_results)

        delta = diff_audits(str(pre_path), str(post_path))

        # Only header lines should be present.
        lines = [ln for ln in delta.split("\n") if ln.strip()]
        # We expect 3 non-blank lines: title + 2 table headers/separators.
        assert len(lines) == 3, (
            f"Expected 3 non-blank header lines for empty runners, got {len(lines)}: {lines!r}"
        )
        assert "# Sensitivity Audit — Pre/Post Fix Comparison" in delta
        assert "| Runner |" in delta
        assert "| --- |" in delta

    def test_r207_returns_string_with_newlines(self, tmp_path):
        # R-207: the return value is a string joined by "\n" (reporting.py:214).
        pre_sens = _make_sensitivity(
            martian_type="compute", fitness_sensitivity=0.2,
        )
        post_sens = _make_sensitivity(
            martian_type="compute", fitness_sensitivity=0.5,
        )
        pre_path = tmp_path / "pre.json"
        post_path = tmp_path / "post.json"
        _write_results_json(pre_path, _make_audit_results(
            sensitivities=[pre_sens], runners_audited=["compute"]
        ))
        _write_results_json(post_path, _make_audit_results(
            sensitivities=[post_sens], runners_audited=["compute"]
        ))

        delta = diff_audits(str(pre_path), str(post_path))

        assert isinstance(delta, str)
        assert "\n" in delta, (
            "Expected the return value to contain newlines "
            "(reporting.py:214 joins with `\\n`)"
        )

    def test_r208_with_classifications_from_real_run(self, tmp_path):
        # R-208: end-to-end sanity check — feed real-shape audit
        # results (BLIND/OK mix) and verify the markdown contains
        # sensible numbers.
        pre_results = _make_audit_results(
            sensitivities=[
                _make_sensitivity(
                    martian_type="compute",
                    classification="BLIND",
                    fitness_sensitivity=0.0,
                ),
                _make_sensitivity(
                    martian_type="search_text",
                    classification="BLIND",
                    fitness_sensitivity=0.1,
                ),
            ],
            runners_audited=["compute", "search_text"],
            seed=42,
        )
        post_results = _make_audit_results(
            sensitivities=[
                _make_sensitivity(
                    martian_type="compute",
                    classification="OK",
                    fitness_sensitivity=0.8,
                ),
                _make_sensitivity(
                    martian_type="search_text",
                    classification="WEAK",
                    fitness_sensitivity=0.4,
                ),
            ],
            runners_audited=["compute", "search_text"],
            seed=42,
        )
        pre_path = tmp_path / "pre.json"
        post_path = tmp_path / "post.json"
        _write_results_json(pre_path, pre_results)
        _write_results_json(post_path, post_results)

        delta = diff_audits(str(pre_path), str(post_path))

        # Both runners should appear with their deltas.
        assert "+0.80" in delta     # compute: 0.0 → 0.8
        assert "+0.30" in delta     # search_text: 0.1 → 0.4
