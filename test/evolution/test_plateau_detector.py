"""Tests for alienclaw.evolution.diagnostics.plateau_detector (R-101..R-105 + R-NF-1..R-NF-5).

RED signal (origin/main 86dee6e2):
  ModuleNotFoundError: No module named 'alienclaw.evolution.diagnostics'
GREEN after: src/alienclaw/evolution/diagnostics/__init__.py +
             src/alienclaw/evolution/diagnostics/plateau_detector.py created.

PKT-1037 addendum (origin/main e82ab980):
  detect_plateaus silently swallowed NaN/Infinity elements (Python's
  ``nan < delta = False`` and ``inf - x = inf`` both bypass the
  plateau branch in the wrong direction). On a curve with a stray NaN
  the function returned [] (silent data loss). On a curve ending in
  +inf it reported a PHANTOM plateau (active misreport — the CLI
  printed "Convergence: ..." for broken data). Mirrors the guard
  already in alienclaw.diagnostics.plateau_detector (PKT-516).
"""
from __future__ import annotations

import math

import pytest

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


class TestNonFiniteInputs:
    """PKT-1037: detect_plateaus must reject NaN/Inf in the curve.

    Without these guards, a stray NaN from upstream ``max(fitnesses)``
    propagation or a stray +Inf from a divide-by-zero in stats would
    cause the CLI to print ``Convergence: ...`` against garbage data
    (phantom plateau) or hide the broken generation entirely (silent
    ``[]``). Raise so the operator sees the bad generation index.
    """

    def test_nan_in_curve_raises(self):
        """R-NF-1: NaN element anywhere in the curve must raise ValueError."""
        with pytest.raises(ValueError, match="finite"):
            detect_plateaus([0.5, 0.5, 0.5, math.nan, 0.5, 0.5])

    def test_inf_in_curve_raises(self):
        """R-NF-2: +Inf element anywhere in the curve must raise ValueError.

        This is the PHANTOM-plateau case the prior bug allowed: the curve
        ``[0.5, 0.5, 0.5, 0.5, 0.5, 0.5, inf]`` used to return
        ``[PlateauInfo(start_generation=2, length=5)]`` because
        ``inf - 0.5 = inf`` is not a plateau step but the trailing
        Infinity was treated as a flat end. The CLI then printed a
        successful convergence message for broken data.
        """
        with pytest.raises(ValueError, match="finite"):
            detect_plateaus([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, math.inf])

    def test_neg_inf_in_curve_raises(self):
        """R-NF-3: -Inf element must also raise."""
        with pytest.raises(ValueError, match="finite"):
            detect_plateaus([0.5, 0.5, -math.inf, 0.5, 0.5, 0.5])

    def test_nan_first_element_raises(self):
        """R-NF-4: NaN at index 0 must raise (was silently returned [])."""
        with pytest.raises(ValueError, match="finite"):
            detect_plateaus([math.nan, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0])

    def test_all_nan_curve_raises(self):
        """R-NF-5: all-NaN curve must raise (was silently returned [])."""
        with pytest.raises(ValueError, match="finite"):
            detect_plateaus([math.nan] * 4)

    def test_error_message_names_offending_index(self):
        """R-NF-6: ValueError message should pinpoint the bad index."""
        with pytest.raises(ValueError) as excinfo:
            detect_plateaus([0.5, 0.5, 0.5, 0.5, math.nan, 0.5, 0.5])
        assert "curve[4]" in str(excinfo.value)
