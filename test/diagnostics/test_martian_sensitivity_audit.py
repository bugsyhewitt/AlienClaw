"""Tests for the Martian-composition sensitivity audit (Packet 19)."""
from __future__ import annotations

from alienclaw.diagnostics.sensitivity_audit import _classify, run_martian_audit


class TestRunMartianAudit:
    def test_returns_8_composition_results(self) -> None:
        results = run_martian_audit(seed=42, pairs_per_martian=4)
        assert len(results.sensitivities) == 8

    def test_no_alone_types(self) -> None:
        results = run_martian_audit(seed=42, pairs_per_martian=4)
        for s in results.sensitivities:
            assert not s.martian_type.endswith("_alone")

    def test_reproducible_same_seed(self) -> None:
        r1 = run_martian_audit(seed=42, pairs_per_martian=4)
        r2 = run_martian_audit(seed=42, pairs_per_martian=4)
        for s1, s2 in zip(r1.sensitivities, r2.sensitivities):
            assert s1.output_sensitivity == s2.output_sensitivity
            assert s1.tool_calls_sensitivity == s2.tool_calls_sensitivity
            assert s1.fitness_sensitivity == s2.fitness_sensitivity

    def test_classification_in_known_set(self) -> None:
        results = run_martian_audit(seed=42, pairs_per_martian=4)
        for s in results.sensitivities:
            assert s.classification in ("BLIND", "WEAK", "OK", "STRONG")

    def test_all_have_pairs_tested(self) -> None:
        results = run_martian_audit(seed=42, pairs_per_martian=4)
        for s in results.sensitivities:
            assert s.pairs_tested == 4

    def test_to_dict_round_trip(self) -> None:
        r = run_martian_audit(seed=42, pairs_per_martian=4)
        d = r.to_dict()
        assert d["seed"] == 42
        assert len(d["sensitivities"]) == 8
        assert d["martians_audited"] == sorted(d["martians_audited"])


class TestClassificationRule:
    """Packet 20: headline classification = fitness_sensitivity's classification."""

    def test_classification_is_fitness_headline(self) -> None:
        """Every Martian's classification is _classify(fitness_sensitivity)."""
        results = run_martian_audit(seed=42, pairs_per_martian=4)
        for s in results.sensitivities:
            assert s.classification == _classify(s.fitness_sensitivity), (
                f"{s.martian_type}: classification={s.classification}, "
                f"fitness={s.fitness_sensitivity}, expected={_classify(s.fitness_sensitivity)}"
            )

    def test_classify_thresholds(self) -> None:
        """_classify boundaries: BLIND <=0.2, WEAK <=0.6, OK >0.6."""
        assert _classify(0.0) == "BLIND"
        assert _classify(0.2) == "BLIND"
        assert _classify(0.21) == "WEAK"
        assert _classify(0.6) == "WEAK"
        assert _classify(0.61) == "OK"
        assert _classify(1.0) == "OK"
