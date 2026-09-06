"""Tests for alienclaw.evolution.diagnostics.plateau_detector (R-101..R-105).

RED signal (origin/main 86dee6e2):
  ModuleNotFoundError: No module named 'alienclaw.evolution.diagnostics'
GREEN after: src/alienclaw/evolution/diagnostics/__init__.py +
             src/alienclaw/evolution/diagnostics/plateau_detector.py created.
"""
from __future__ import annotations

from alienclaw.evolution.diagnostics.plateau_detector import PlateauInfo, detect_plateaus


class TestDetectPlateaus:
    """R-101..R-105: core plateau detection contract."""

    def test_flat_final_five_of_ten(self):
        """A-101: 10-gen run, gens 6-10 flat → PlateauInfo(start_generation=6, length=5)."""
        curve = [0.1, 0.2, 0.3, 0.4, 0.5, 0.505, 0.505, 0.505, 0.505, 0.505]
        result = detect_plateaus(curve)
        assert result == [PlateauInfo(start_generation=6, length=5)]

    def test_always_improving_no_plateau(self):
        """A-105: curve improving by 0.1/gen → no plateau."""
        curve = [i * 0.1 for i in range(1, 11)]
        assert detect_plateaus(curve) == []

    def test_plateau_too_short_not_reported(self):
        """A-103: 4 flat steps (< min_len=5) → not reported."""
        curve = [0.1, 0.2, 0.3, 0.4, 0.405, 0.405, 0.405, 0.405, 0.5, 0.6]
        assert detect_plateaus(curve) == []

    def test_plateau_exactly_min_len_reported(self):
        """A-104: exactly 5 consecutive flat steps → reported."""
        # gens 1-4 improve; gens 5-9 flat (steps at idx 4..8 → start_gen=5, len=5)
        curve = [0.1, 0.2, 0.3, 0.4, 0.405, 0.405, 0.405, 0.405, 0.405]
        result = detect_plateaus(curve)
        assert result == [PlateauInfo(start_generation=5, length=5)]

    def test_short_curve_no_plateaus(self):
        """A-102: curves with < 2 elements → []."""
        assert detect_plateaus([]) == []
        assert detect_plateaus([0.5]) == []
