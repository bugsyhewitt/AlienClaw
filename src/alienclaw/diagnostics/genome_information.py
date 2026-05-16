"""Information-theoretic analysis of genome → fitness relationships.

Computes mutual information I(G; F) between genome content G and
fitness outcome F, with Miller-Madow finite-sample bias correction.

If I(G; F) ≈ 0: no signal; selection has nothing to act on.
If I(G; F) > 0: signal exists; selection can in principle detect it.
"""
from __future__ import annotations

import math
from collections import Counter
from typing import Sequence

import numpy as np

BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
BASE62_TO_INT = {c: i for i, c in enumerate(BASE62)}


def _freedman_diaconis_nbins(y: np.ndarray) -> int:
    """Compute number of histogram bins using Freedman-Diaconis rule."""
    n = len(y)
    iqr = float(np.percentile(y, 75) - np.percentile(y, 25))
    if iqr == 0:
        return max(1, int(np.sqrt(n)))
    h = 2.0 * iqr * (n ** (-1.0 / 3.0))
    span = float(y.max() - y.min())
    if h <= 0 or span <= 0:
        return max(1, int(np.sqrt(n)))
    return max(1, int(math.ceil(span / h)))


def mutual_information(
    x: Sequence[int],
    y: Sequence[float],
    n_bins_y: int | None = None,
) -> float:
    """Estimate I(X; Y) in nats with Miller-Madow bias correction.

    X is treated as discrete; Y is binned to discrete using
    Freedman-Diaconis rule (or n_bins_y if given).

    Args:
        x: discrete integer-valued samples
        y: continuous-valued samples (paired with x)
        n_bins_y: number of bins for Y; auto-determined if None

    Returns:
        MI estimate in nats (always ≥ 0)
    """
    n = len(x)
    if n < 2:
        return 0.0
    if len(y) != n:
        raise ValueError("x and y must have the same length")

    y_arr = np.array(y, dtype=float)

    if n_bins_y is None:
        n_bins_y = _freedman_diaconis_nbins(y_arr)

    # Bin Y into n_bins_y equally-spaced bins
    y_min, y_max = float(y_arr.min()), float(y_arr.max())
    if y_max == y_min:
        # All Y values identical → MI = 0
        return 0.0

    bin_edges = np.linspace(y_min, y_max, n_bins_y + 1)
    y_binned = np.digitize(y_arr, bin_edges[1:-1])  # 0..n_bins_y-1

    x_arr = np.array(x, dtype=int)

    # Joint counts
    joint: Counter = Counter(zip(x_arr.tolist(), y_binned.tolist()))
    x_counts: Counter = Counter(x_arr.tolist())
    y_counts: Counter = Counter(y_binned.tolist())

    total = float(n)

    # Entropies
    def entropy(counts: Counter) -> float:
        return sum(
            -(c / total) * math.log(c / total)
            for c in counts.values()
            if c > 0
        )

    H_x = entropy(x_counts)
    H_y = entropy(y_counts)
    H_joint = entropy(joint)

    raw_mi = H_x + H_y - H_joint

    # Miller-Madow finite-sample correction
    n_x = len(x_counts)
    n_y = len(y_counts)
    n_joint = len(joint)
    correction = (n_x * n_y - n_joint - 1) / (2.0 * total)

    return max(0.0, raw_mi - correction)


def genome_byte_mutual_information(
    genomes: Sequence[str],
    fitnesses: Sequence[float],
    byte_indices: Sequence[int] | None = None,
) -> dict:
    """Compute MI between each genome byte and fitness.

    Args:
        genomes: list of 256-char Base62 genome strings
        fitnesses: corresponding fitness values
        byte_indices: which byte positions to analyze; default=all 256

    Returns:
        {
            0: mi_for_byte_0,
            1: mi_for_byte_1,
            ...
            "summary": {
                "max_byte_mi": float,
                "mean_byte_mi": float,
                "n_significant_bytes": int,   # MI > 0.01 nats
                "threshold_nats": float,
            }
        }
    """
    if not genomes:
        return {"summary": {"max_byte_mi": 0.0, "mean_byte_mi": 0.0, "n_significant_bytes": 0, "threshold_nats": 0.01}}

    genome_len = len(genomes[0])
    if byte_indices is None:
        byte_indices = range(genome_len)

    per_byte_mi: dict[int, float] = {}
    for idx in byte_indices:
        x = [BASE62_TO_INT.get(g[idx], 0) for g in genomes]
        per_byte_mi[idx] = mutual_information(x, fitnesses)

    threshold = 0.01
    values = list(per_byte_mi.values())
    summary = {
        "max_byte_mi": max(values) if values else 0.0,
        "mean_byte_mi": sum(values) / len(values) if values else 0.0,
        "n_significant_bytes": sum(1 for v in values if v > threshold),
        "threshold_nats": threshold,
    }

    return {**per_byte_mi, "summary": summary}


def summarize_genome_fitness_mi(
    genomes: Sequence[str],
    fitnesses: Sequence[float],
) -> dict:
    """High-level MI summary for a (genomes, fitnesses) dataset.

    Returns per-genome-section summary and slot-level analysis.
    Genome sections: bytes 0-63 (IDENTITY), 64-127 (slot 0 EXECUTION),
    128-191 (slot 1 EXECUTION), 192-255 (CHECKSUM).
    """
    sections = {
        "identity_bytes_0_63": list(range(64)),
        "slot0_exec_64_127": list(range(64, 128)),
        "slot1_exec_128_191": list(range(128, 192)),
        "checksum_192_255": list(range(192, 256)),
    }

    section_results: dict[str, float] = {}
    for section_name, indices in sections.items():
        section_mi = genome_byte_mutual_information(genomes, fitnesses, indices)
        section_results[section_name] = section_mi["summary"]["max_byte_mi"]

    global_result = genome_byte_mutual_information(genomes, fitnesses)
    global_summary = global_result["summary"]

    return {
        "n_samples": len(genomes),
        "n_unique_fitnesses": len(set(fitnesses)),
        "fitness_range": [min(fitnesses), max(fitnesses)] if fitnesses else [0.0, 0.0],
        "global_max_byte_mi": global_summary["max_byte_mi"],
        "global_mean_byte_mi": global_summary["mean_byte_mi"],
        "n_significant_bytes": global_summary["n_significant_bytes"],
        "section_max_mi": section_results,
    }
