"""Track genome diversity within a population.

Pure functions: given a sequence of genome strings, compute Hamming-distance
based diversity metrics. Called once per generation by the scale experiment
runner to capture how population diversity evolves over time.
"""
from __future__ import annotations

from typing import Sequence


def hamming_distance(a: str, b: str) -> int:
    """Symbol-level Hamming distance between two equal-length strings."""
    if len(a) != len(b):
        raise ValueError(f"genome length mismatch: {len(a)} vs {len(b)}")
    return sum(c1 != c2 for c1, c2 in zip(a, b))


def population_diversity(genomes: Sequence[str]) -> dict:
    """Compute diversity metrics for a population of genomes.

    For efficiency, pairwise distances are sampled (all pairs) when
    population size ≤ 50; above 50, a random sample of 1000 pairs is used.

    Returns:
        {
            "n": int,                         population size
            "unique_genomes": int,            distinct genomes
            "mean_pairwise_hamming": float,   avg Hamming across pairs
            "min_pairwise_hamming": int,      minimum pairwise distance
            "max_pairwise_hamming": int,      maximum pairwise distance
            "monoculture": bool,              True when all genomes identical
        }
    """
    n = len(genomes)
    if n == 0:
        return {
            "n": 0,
            "unique_genomes": 0,
            "mean_pairwise_hamming": 0.0,
            "min_pairwise_hamming": 0,
            "max_pairwise_hamming": 0,
            "monoculture": True,
        }

    unique = len(set(genomes))
    monoculture = unique == 1

    if n == 1:
        return {
            "n": 1,
            "unique_genomes": unique,
            "mean_pairwise_hamming": 0.0,
            "min_pairwise_hamming": 0,
            "max_pairwise_hamming": 0,
            "monoculture": monoculture,
        }

    genome_list = list(genomes)

    if n <= 50:
        pairs = [
            hamming_distance(genome_list[i], genome_list[j])
            for i in range(n)
            for j in range(i + 1, n)
        ]
    else:
        import random as _random
        rng = _random.Random(0)  # deterministic sample
        pairs = []
        for _ in range(min(1000, n * (n - 1) // 2)):
            i, j = rng.sample(range(n), 2)
            pairs.append(hamming_distance(genome_list[i], genome_list[j]))

    return {
        "n": n,
        "unique_genomes": unique,
        "mean_pairwise_hamming": sum(pairs) / len(pairs) if pairs else 0.0,
        "min_pairwise_hamming": min(pairs) if pairs else 0,
        "max_pairwise_hamming": max(pairs) if pairs else 0,
        "monoculture": monoculture,
    }
