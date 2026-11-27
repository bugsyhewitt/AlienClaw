"""Pure-noise genome bytes must not look informative.

A Miller-Madow MI correction tried on 2026-11-26 (reverted) RAISED the estimate for sparse
joint tables, the normal regime here (few genomes, up to 62 symbols per byte): 30 random
genomes went from mean_byte_mi ~0.16 to ~0.85 nats. This pins the noise level.
"""

from __future__ import annotations

import random

from alienclaw_ga.diagnostics.genome_information import genome_byte_mutual_information
from alienclaw_ga.genome.alphabet import ALPHABET


def _random_genomes(n: int, seed: int) -> tuple[list[str], list[float]]:
    rng = random.Random(seed)
    genomes = ["".join(rng.choice(ALPHABET) for _ in range(256)) for _ in range(n)]
    fitnesses = [rng.random() for _ in range(n)]
    return genomes, fitnesses


def test_noise_bytes_stay_near_zero_mutual_information() -> None:
    for seed in (1, 2, 3):
        genomes, fitnesses = _random_genomes(30, seed)
        summary = genome_byte_mutual_information(genomes, fitnesses)["summary"]
        assert summary["mean_byte_mi"] < 0.3, summary
        assert summary["max_byte_mi"] < 0.6, summary
