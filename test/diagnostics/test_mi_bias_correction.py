"""Miller-Madow bias correction of the mutual-information estimate.

Miller-Madow corrects a plug-in entropy by adding ``(m - 1) / (2N)``, where ``m`` is
the number of non-empty bins. Applying it to each term of
``I(X;Y) = H(X) + H(Y) - H(X,Y)`` gives

    MI_MM = MI_plugin + ((m_x - 1) + (m_y - 1) - (m_xy - 1)) / (2N)
          = MI_plugin - (m_xy - m_x - m_y + 1) / (2N)

with ``m_x``, ``m_y`` and ``m_xy`` the occupied X values, Y bins and joint cells.
The result is floored at 0, the function's documented contract.

History:

* PKT-1477 found that the old term ``(n_x * n_y - n_joint - 1) / (2N)`` (not
  Miller-Madow: it used the size of the full product table, ``n_x * n_y``, where
  the formula has ``m_x + m_y``) went negative on a saturated table and INFLATED
  the estimate, so a constant X scored ``1/(2N)``. It clamped the result to the
  plug-in value.
* The 2026-11-26 review found the clamp hid the wrong term instead of fixing it:
  with every joint cell occupied the old term was ``-1/(2N)``, so the clamp
  returned the uncorrected plug-in MI, which is biased UP by about
  ``(m_x - 1)(m_y - 1) / (2N)``. The term is now Miller-Madow and the clamp is
  gone. Under the correct term a constant X gets a correction of exactly 0
  (``m_x = 1`` forces ``m_xy = m_y``), so PKT-1477's inflation cannot recur.
  Miller-Madow can legitimately RAISE the estimate when the joint table is sparse
  (a near-deterministic relation, ``m_xy < m_x + m_y - 1``): the corrections of
  the two marginal entropies then outweigh the joint entropy's.

Every expectation below is computed by hand from the count table, not from the
module.
"""
from __future__ import annotations

import math
import random
from collections import Counter

import pytest

from alienclaw.diagnostics.genome_information import (
    genome_byte_mutual_information,
    mutual_information,
)


def _entropy(xs: list[int]) -> float:
    n = len(xs)
    return sum(-(c / n) * math.log(c / n) for c in Counter(xs).values())


def _mm_entropy(xs: list[int]) -> float:
    """Miller-Madow entropy: plug-in + (m - 1) / (2N)."""
    return _entropy(xs) + (len(set(xs)) - 1) / (2 * len(xs))


def _samples(table: list[list[int]]) -> tuple[list[int], list[float]]:
    """Expand a count table (rows = X values, columns = Y bins) into paired samples.

    Y bin j is the value float(j); with n_bins_y = number of columns, the module's
    equal-width binning maps j back to bin j (every column must be used at least
    once so the Y range is 0 .. columns - 1).
    """
    x: list[int] = []
    y: list[float] = []
    for i, row in enumerate(table):
        for j, count in enumerate(row):
            x += [i] * count
            y += [float(j)] * count
    return x, y


def _plugin_mi(table: list[list[int]]) -> float:
    """Plug-in MI from counts: sum of n_ij/N * ln(n_ij N / (n_i. n_.j))."""
    n = sum(map(sum, table))
    rows = [sum(r) for r in table]
    cols = [sum(c) for c in zip(*table)]
    return sum(
        c / n * math.log(c * n / (rows[i] * cols[j]))
        for i, row in enumerate(table)
        for j, c in enumerate(row)
        if c
    )


def _mi(table: list[list[int]]) -> float:
    x, y = _samples(table)
    return mutual_information(x, y, n_bins_y=len(table[0]))


class TestMillerMadowFormula:
    def test_dependent_full_table_exact_value(self) -> None:
        """2x2, counts [[3, 1], [1, 3]], N = 8: m_x = m_y = 2, m_xy = 4.

        MI_plugin = 3/4 ln(3/2) - 1/4 ln 2 = 0.130812035941137
        correction = (2 + 2 - 4 - 1) / 16 = -1/16
        MI_MM      = 0.068312035941137   (old code returned the plug-in value)
        """
        expected = 0.75 * math.log(1.5) - 0.25 * math.log(2) - 1 / 16
        assert _mi([[3, 1], [1, 3]]) == pytest.approx(expected, abs=1e-9)
        assert expected == pytest.approx(0.068312035941137, abs=1e-12)

    def test_sparse_dependent_table_correction_is_positive(self) -> None:
        """3x3, cells (0,0)=4 (1,1)=3 (2,1)=1 (2,2)=2, N = 10: m_x = m_y = 3, m_xy = 4.

        p_x = (.4, .3, .3), p_y = (.4, .4, .2)
        MI_plugin = .7 ln 2.5 + .1 ln(5/6) + .2 ln(10/3) = 0.863965917497700
        correction = (3 + 3 - 4 - 1) / 20 = +1/20
        MI_MM      = 0.913965917497700   (old code: plug-in - 4/20 = 0.663965917497700)
        """
        table = [[4, 0, 0], [0, 3, 0], [0, 1, 2]]
        plugin = 0.7 * math.log(2.5) + 0.1 * math.log(5 / 6) + 0.2 * math.log(10 / 3)
        assert _plugin_mi(table) == pytest.approx(plugin, abs=1e-12)
        assert _mi(table) == pytest.approx(plugin + 1 / 20, abs=1e-9)

    def test_deterministic_y_equals_x_exact_value(self) -> None:
        """Y = X over 4 equiprobable values, N = 400: m_x = m_y = m_xy = 4.

        MI_plugin = ln 4; correction = (4 + 4 - 4 - 1) / 800 = +3/800
        MI_MM = ln 4 + 3/800 = 1.390044361119891 (old code: ln 4 - 11/800 = 1.372544...)
        It equals the Miller-Madow entropy of X, its upper bound.
        """
        x = list(range(4)) * 100
        y = [float(v) for v in x]
        expected = math.log(4) + 3 / 800
        assert mutual_information(x, y, n_bins_y=4) == pytest.approx(expected, abs=1e-9)
        assert expected == pytest.approx(_mm_entropy(x), abs=1e-12)

    # A sample of 2000 independent draws, X uniform on 3 values and Y uniform on 4
    # bins (random.Random(5) and random.Random(1), recorded here as counts). Every
    # joint cell is occupied: m_x = 3, m_y = 4, m_xy = 12, so the correction is
    # (3 + 4 - 12 - 1) / 4000 = -6/4000, the expected plug-in bias
    # (m_x - 1)(m_y - 1) / (2N) of an independent pair.
    INDEPENDENT_2000 = [
        [[153, 191, 169, 173], [169, 161, 170, 163], [176, 134, 166, 175]],
        [[166, 164, 177, 156], [167, 163, 176, 163], [164, 162, 157, 185]],
    ]

    @pytest.mark.parametrize("table", INDEPENDENT_2000, ids=["seed5", "seed1"])
    def test_independent_full_table_corrected_below_plugin(
        self, table: list[list[int]]
    ) -> None:
        """seed5: plug-in 0.002835 -> 0.001335; seed1: plug-in 0.001054 -> 0 (floor).

        The old code returned the plug-in value unchanged for both.
        """
        assert sum(map(sum, table)) == 2000
        plugin = _plugin_mi(table)
        assert plugin > 0.0
        mi = _mi(table)
        assert mi < plugin
        assert mi == pytest.approx(max(0.0, plugin - 6 / 4000), abs=1e-9)

    def test_independent_seed5_exact_value(self) -> None:
        mi = _mi(self.INDEPENDENT_2000[0])
        assert mi == pytest.approx(_plugin_mi(self.INDEPENDENT_2000[0]) - 0.0015, abs=1e-9)
        assert mi == pytest.approx(0.001335, abs=5e-7)

    def test_constant_x_correction_is_exactly_zero(self) -> None:
        """m_x = 1 forces m_xy = m_y, so (m_xy - m_x - m_y + 1) = 0 for any Y."""
        rng = random.Random(20261126)
        for _ in range(50):
            n = rng.randint(2, 60)
            y = [rng.random() for _ in range(n)]
            bins = rng.choice([None, 2, 5, n])
            assert mutual_information([3] * n, y, n_bins_y=bins) == 0.0


class TestBiasCorrectionNeverInflates:
    @pytest.mark.parametrize("n", [4, 40])
    def test_constant_x_has_zero_mi(self, n: int) -> None:
        """Constant X: every Y lands in its own bin, so the joint table is saturated."""
        x = [7] * n
        y = [float(i) for i in range(n)]
        assert mutual_information(x, y, n_bins_y=n) == pytest.approx(0.0, abs=1e-12)

    def test_constant_x_auto_bins_has_zero_mi(self) -> None:
        x = [0] * 4
        y = [0.1, 0.2, 0.3, 0.4]
        assert mutual_information(x, y) == pytest.approx(0.0, abs=1e-12)

    def test_independent_saturated_table_has_zero_mi(self) -> None:
        """X and Y independent and perfectly balanced: plug-in MI is exactly 0.

        The correction is (2 + 2 - 4 - 1) / 8 = -1/8; the floor keeps the result at 0.
        """
        x = [0, 1, 0, 1]
        y = [0.0, 0.0, 1.0, 1.0]
        assert mutual_information(x, y, n_bins_y=2) == pytest.approx(0.0, abs=1e-12)

    def test_mi_bounded_by_miller_madow_entropy_of_x(self) -> None:
        """0 <= MI_MM <= H_MM(X) for every input, including small saturated samples.

        Was ``mi <= H_plugin(X)``, which held only because the clamp capped every
        estimate at the plug-in MI. Miller-Madow MI can exceed the plug-in H(X)
        (Y = X: ln 4 + 3/800 > ln 4) but never H_MM(X): H(X,Y) >= H(Y) and
        m_xy >= m_y, so H_MM(X,Y) >= H_MM(Y).
        """
        rng = random.Random(1477)
        for _ in range(300):
            n = rng.randint(2, 12)
            k = rng.randint(1, 4)
            x = [rng.randrange(k) for _ in range(n)]
            y = [rng.random() for _ in range(n)]
            bins = rng.choice([None, 2, 3, n])
            mi = mutual_information(x, y, n_bins_y=bins)
            assert 0.0 <= mi <= _mm_entropy(x) + 1e-12, (x, y, bins, mi)

    def test_real_signal_is_still_detected(self) -> None:
        """Y = X still carries ~ln 4 (exactly ln 4 + 3/800 after the correction).

        Was ``1.0 < mi <= ln 4``; see test_deterministic_y_equals_x_exact_value.
        """
        x = list(range(4)) * 100
        y = [float(v) for v in x]
        mi = mutual_information(x, y, n_bins_y=4)
        assert 1.0 < mi <= math.log(4) + 3 / 800 + 1e-12


class TestConstantGenomeByte:
    def test_constant_byte_is_not_significant(self) -> None:
        genomes = ["A" + "0" * 255, "A" + "1" * 255, "A" + "2" * 255, "A" + "3" * 255]
        fitnesses = [0.1, 0.2, 0.3, 0.4]
        result = genome_byte_mutual_information(genomes, fitnesses, byte_indices=[0])
        assert result[0] == pytest.approx(0.0, abs=1e-12)
        assert result["summary"]["n_significant_bytes"] == 0
