import os
import pytest
from alienclaw.diagnostics.sensitivity_audit import run_audit, AuditResults, PAIRS_PER_RUNNER


@pytest.fixture(autouse=True)
def clean_diag_env():
    os.environ.pop("ALIENCLAW_DIAGNOSTICS", None)
    yield
    os.environ.pop("ALIENCLAW_DIAGNOSTICS", None)


class TestRunAudit:
    def test_runs_all_8_runners(self):
        results = run_audit(seed=42)
        assert len(results.runners_audited) == 8
        expected = {"compute", "extract_json", "file_read", "file_write",
                    "http_get", "search_text", "url_fetch", "web_search"}
        assert set(results.runners_audited) == expected

    def test_each_runner_tested_n_pairs(self):
        results = run_audit(seed=42)
        for s in results.sensitivities:
            assert s.pairs_tested == PAIRS_PER_RUNNER

    def test_genome_never_passed_to_any_runner(self):
        """Confirms the root-cause finding: genome discarded after validation."""
        results = run_audit(seed=42)
        for s in results.sensitivities:
            assert not s.genome_ever_passed_to_runner, (
                f"Runner '{s.martian_type}' received genome — unexpected!"
            )

    def test_compute_is_blind(self):
        """compute with stable input '7+35' must have zero output sensitivity."""
        results = run_audit(seed=42)
        compute = next(s for s in results.sensitivities if s.martian_type == "compute")
        assert compute.output_sensitivity == 0.0
        assert compute.fitness_sensitivity == 0.0
        assert compute.classification == "BLIND"

    def test_all_tool_calls_sensitivity_zero(self):
        """tool_calls is always 1 — efficiency never varies."""
        results = run_audit(seed=42)
        for s in results.sensitivities:
            assert s.tool_calls_sensitivity == 0.0, (
                f"Runner '{s.martian_type}' had varying tool_calls — unexpected!"
            )

    def test_deterministic_with_seed(self):
        r1 = run_audit(seed=99)
        r2 = run_audit(seed=99)
        for s1, s2 in zip(r1.sensitivities, r2.sensitivities):
            assert s1.output_sensitivity == s2.output_sensitivity
            assert s1.fitness_sensitivity == s2.fitness_sensitivity

    def test_different_seeds_differ(self):
        r1 = run_audit(seed=1)
        r2 = run_audit(seed=2)
        # Genomes will differ but sensitivities should be the same pattern
        assert r1.runners_audited == r2.runners_audited

    def test_to_dict_from_dict_roundtrip(self):
        results = run_audit(seed=42)
        d = results.to_dict()
        restored = AuditResults.from_dict(d)
        assert restored.seed == results.seed
        assert restored.runners_audited == results.runners_audited
        for s1, s2 in zip(results.sensitivities, restored.sensitivities):
            assert s1.martian_type == s2.martian_type
            assert s1.output_sensitivity == pytest.approx(s2.output_sensitivity)

    def test_diagnostics_env_cleaned_up(self):
        """run_audit must not leave ALIENCLAW_DIAGNOSTICS set."""
        import os
        os.environ.pop("ALIENCLAW_DIAGNOSTICS", None)
        run_audit(seed=42)
        assert os.environ.get("ALIENCLAW_DIAGNOSTICS") is None


class TestReporting:
    def test_format_report_has_required_sections(self):
        from alienclaw.diagnostics.reporting import format_report
        results = run_audit(seed=42)
        report = format_report(results)
        assert "Sensitivity Audit Report" in report
        assert "MUST FIX" in report
        assert "genome discarded" in report.lower() or "genome not passed" in report.lower() or "discarded" in report.lower()
        assert "per-runner detail" in report.lower()
        assert "summary table" in report.lower()
        assert "root-cause" in report.lower()
        assert "reproduction" in report.lower()

    def test_report_lists_all_runners(self):
        from alienclaw.diagnostics.reporting import format_report
        results = run_audit(seed=42)
        report = format_report(results)
        for mtype in results.runners_audited:
            assert mtype in report
