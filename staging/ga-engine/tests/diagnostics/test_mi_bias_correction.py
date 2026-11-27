"""PKT-1477: the Miller-Madow bias correction may only REDUCE the MI estimate.

The correction term ``(n_x * n_y - n_joint - 1) / (2n)`` is negative whenever
the joint table is saturated (``n_x * n_y <= n_joint``). Subtracting a negative
correction used to INFLATE the plug-in estimate, so an input carrying provably
zero information reported strictly positive mutual information: a constant X
gave ``1/(2n)`` (0.125 at n=4, 0.0125 at n=40), enough to flag a constant genome
byte as "significant" (> 0.01 nats).
"""
from __future__ import annotations

import math
import random
from collections import Counter

import pytest

from alienclaw_ga.diagnostics.genome_information import (
    genome_byte_mutual_information,
    mutual_information,
)


def _entropy(xs: list[int]) -> float:
    n = len(xs)
    return sum(-(c / n) * math.log(c / n) for c in Counter(xs).values())


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
        """X and Y independent and perfectly balanced: plug-in MI is exactly 0."""
        x = [0, 1, 0, 1]
        y = [0.0, 0.0, 1.0, 1.0]
        assert mutual_information(x, y, n_bins_y=2) == pytest.approx(0.0, abs=1e-12)

    def test_mi_never_exceeds_entropy_of_x(self) -> None:
        """I(X;Y) <= H(X) for every input, including small saturated samples."""
        rng = random.Random(1477)
        for _ in range(300):
            n = rng.randint(2, 12)
            k = rng.randint(1, 4)
            x = [rng.randrange(k) for _ in range(n)]
            y = [rng.random() for _ in range(n)]
            bins = rng.choice([None, 2, 3, n])
            mi = mutual_information(x, y, n_bins_y=bins)
            assert 0.0 <= mi <= _entropy(x) + 1e-12, (x, y, bins, mi)

    def test_real_signal_is_still_detected(self) -> None:
        """The clamp leaves a positive correction alone: Y = X still carries ~log 4."""
        x = list(range(4)) * 100
        y = [float(v) for v in x]
        mi = mutual_information(x, y, n_bins_y=4)
        assert 1.0 < mi <= math.log(4) + 1e-12


class TestConstantGenomeByte:
    def test_constant_byte_is_not_significant(self) -> None:
        genomes = ["A" + "0" * 255, "A" + "1" * 255, "A" + "2" * 255, "A" + "3" * 255]
        fitnesses = [0.1, 0.2, 0.3, 0.4]
        result = genome_byte_mutual_information(genomes, fitnesses, byte_indices=[0])
        assert result[0] == pytest.approx(0.0, abs=1e-12)
        assert result["summary"]["n_significant_bytes"] == 0
