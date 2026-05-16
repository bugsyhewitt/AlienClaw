"""Tests for diversity_tracker.py."""
from __future__ import annotations

import pytest

from alienclaw.diagnostics.diversity_tracker import hamming_distance, population_diversity


class TestHammingDistance:
    def test_identical_strings(self):
        assert hamming_distance("AAAA", "AAAA") == 0

    def test_all_different(self):
        assert hamming_distance("AAAA", "BBBB") == 4

    def test_one_char_different(self):
        assert hamming_distance("AAAB", "AAAC") == 1

    def test_symmetry(self):
        a = "ABCD"
        b = "ACCE"
        assert hamming_distance(a, b) == hamming_distance(b, a)

    def test_length_mismatch_raises(self):
        with pytest.raises(ValueError, match="length mismatch"):
            hamming_distance("ABC", "AB")

    def test_empty_strings(self):
        assert hamming_distance("", "") == 0


class TestPopulationDiversity:
    def test_empty_population(self):
        result = population_diversity([])
        assert result["n"] == 0
        assert result["monoculture"] is True
        assert result["unique_genomes"] == 0

    def test_single_genome(self):
        result = population_diversity(["ABCD"])
        assert result["n"] == 1
        assert result["unique_genomes"] == 1
        assert result["mean_pairwise_hamming"] == 0.0

    def test_identical_genomes_monoculture(self):
        genomes = ["AAAA"] * 5
        result = population_diversity(genomes)
        assert result["monoculture"] is True
        assert result["mean_pairwise_hamming"] == 0.0
        assert result["min_pairwise_hamming"] == 0
        assert result["max_pairwise_hamming"] == 0

    def test_two_different_genomes(self):
        result = population_diversity(["AAAA", "BBBB"])
        assert result["monoculture"] is False
        assert result["mean_pairwise_hamming"] == 4.0
        assert result["unique_genomes"] == 2

    def test_diverse_population(self):
        # genomes with varying similarity
        genomes = ["AAAA", "BBBB", "CCCC", "ABCD"]
        result = population_diversity(genomes)
        assert result["n"] == 4
        assert result["monoculture"] is False
        assert result["mean_pairwise_hamming"] > 0.0
        assert result["max_pairwise_hamming"] >= result["min_pairwise_hamming"]

    def test_unique_count(self):
        genomes = ["AAAA", "AAAA", "BBBB"]
        result = population_diversity(genomes)
        assert result["unique_genomes"] == 2

    def test_required_keys_present(self):
        result = population_diversity(["ABCD", "EFGH"])
        for key in ("n", "unique_genomes", "mean_pairwise_hamming",
                    "min_pairwise_hamming", "max_pairwise_hamming", "monoculture"):
            assert key in result, f"missing key: {key}"

    def test_large_population_sampling(self):
        # pop > 50 → sampling path; should still produce valid results
        genomes = [f"{'A' * (256 - i % 10)}{'B' * (i % 10)}" for i in range(60)]
        result = population_diversity(genomes)
        assert result["n"] == 60
        assert result["mean_pairwise_hamming"] >= 0.0

    def test_min_leq_mean_leq_max(self):
        genomes = ["AAAA", "AABB", "BBBB", "CCCC"]
        result = population_diversity(genomes)
        assert result["min_pairwise_hamming"] <= result["mean_pairwise_hamming"]
        assert result["mean_pairwise_hamming"] <= result["max_pairwise_hamming"]

    def test_two_identical_one_different(self):
        genomes = ["AAAA", "AAAA", "BBBB"]
        result = population_diversity(genomes)
        # pairs: (0,0)=0, (0,1)=4, (0,1-repeat)=4 → mean=(0+4+4)/3=2.67
        assert result["monoculture"] is False
        assert result["min_pairwise_hamming"] == 0
        assert result["max_pairwise_hamming"] == 4
