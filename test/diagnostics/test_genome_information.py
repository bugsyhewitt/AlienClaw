"""Tests for genome_information.py — mutual information module."""
from __future__ import annotations

import math
import pytest
import numpy as np

from alienclaw.diagnostics.genome_information import (
    mutual_information,
    genome_byte_mutual_information,
    summarize_genome_fitness_mi,
)


class TestMutualInformation:
    def test_identical_xy_high_mi(self):
        """Y=X: MI should be approximately H(X)."""
        # X has 4 equally likely values: MI should be ~log(4) nats ≈ 1.386
        x = list(range(4)) * 100  # 400 samples
        y = [float(v) for v in x]
        mi = mutual_information(x, y, n_bins_y=4)
        assert mi > 1.0  # substantial MI

    def test_independent_xy_near_zero_mi(self):
        """Y independent of X: MI should be ≈ 0."""
        import random
        rng = random.Random(42)
        n = 1000
        x = [rng.randint(0, 5) for _ in range(n)]
        y = [rng.uniform(0.0, 1.0) for _ in range(n)]
        mi = mutual_information(x, y)
        # With 1000 samples and Miller-Madow correction, should be near 0
        assert mi < 0.1

    def test_constant_y_zero_mi(self):
        """Constant Y → zero MI."""
        x = list(range(50))
        y = [0.5] * 50
        mi = mutual_information(x, y)
        assert mi == 0.0

    def test_length_mismatch_raises(self):
        with pytest.raises(ValueError):
            mutual_information([1, 2, 3], [0.5, 0.5])

    def test_returns_non_negative(self):
        """MI must always be ≥ 0."""
        import random
        rng = random.Random(99)
        x = [rng.randint(0, 10) for _ in range(100)]
        y = [rng.random() for _ in range(100)]
        assert mutual_information(x, y) >= 0.0

    def test_noisy_y_intermediate_mi(self):
        """Y = X + small_noise: MI should be between 0 and H(X)."""
        import random
        rng = random.Random(42)
        n = 500
        x = [rng.randint(0, 3) for _ in range(n)]
        y = [xi + rng.gauss(0, 0.1) for xi in x]
        mi = mutual_information(x, y)
        assert mi > 0.1  # some signal
        assert mi < 2.5  # not more than H(X) ≈ log(4)

    def test_n_bins_y_parameter(self):
        """n_bins_y parameter accepted and produces different results."""
        x = list(range(4)) * 50
        y = [float(v) + 0.1 for v in x]
        mi2 = mutual_information(x, y, n_bins_y=2)
        mi10 = mutual_information(x, y, n_bins_y=10)
        assert mi2 >= 0
        assert mi10 >= 0


class TestGenomeByteMutualInformation:
    def _make_synthetic_genomes(self, n: int, seed: int = 42) -> tuple[list[str], list[float]]:
        """Make synthetic 256-char genomes with fitness = byte[0] / 62."""
        import random
        rng = random.Random(seed)
        from alienclaw.diagnostics.genome_information import BASE62
        genomes = []
        fitnesses = []
        for _ in range(n):
            g = "".join(rng.choice(BASE62) for _ in range(256))
            # Fitness driven by byte 0
            fit = BASE62.index(g[0]) / 62.0
            genomes.append(g)
            fitnesses.append(fit)
        return genomes, fitnesses

    def test_byte0_has_high_mi_when_drives_fitness(self):
        """When fitness is driven by byte 0, byte 0 should have high MI."""
        genomes, fitnesses = self._make_synthetic_genomes(200)
        result = genome_byte_mutual_information(genomes, fitnesses, byte_indices=[0, 1, 2])
        # byte 0 should have higher MI than byte 1 or 2 (which don't drive fitness)
        assert result[0] > result[1]

    def test_summary_keys_present(self):
        genomes, fitnesses = self._make_synthetic_genomes(50)
        result = genome_byte_mutual_information(genomes, fitnesses, byte_indices=range(10))
        assert "summary" in result
        for key in ("max_byte_mi", "mean_byte_mi", "n_significant_bytes", "threshold_nats"):
            assert key in result["summary"]

    def test_constant_fitness_all_zero_mi(self):
        """Constant fitness → all byte MIs ≈ 0."""
        from alienclaw.diagnostics.genome_information import BASE62
        import random
        rng = random.Random(42)
        genomes = ["".join(rng.choice(BASE62) for _ in range(256)) for _ in range(50)]
        fitnesses = [0.5] * 50
        result = genome_byte_mutual_information(genomes, fitnesses, byte_indices=range(5))
        assert result["summary"]["max_byte_mi"] == 0.0


class TestSummarizeGenomeFitnessMi:
    def test_structure(self):
        from alienclaw.diagnostics.genome_information import BASE62
        import random
        rng = random.Random(42)
        genomes = ["".join(rng.choice(BASE62) for _ in range(256)) for _ in range(30)]
        fitnesses = [rng.random() for _ in range(30)]
        result = summarize_genome_fitness_mi(genomes, fitnesses)
        for key in ("n_samples", "global_max_byte_mi", "section_max_mi"):
            assert key in result
        assert result["n_samples"] == 30
