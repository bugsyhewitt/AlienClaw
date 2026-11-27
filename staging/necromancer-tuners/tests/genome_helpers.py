"""Shared helpers for the genome-schema tests."""

from __future__ import annotations

import json
from pathlib import Path

from alienclaw_ga.genome.alphabet import SECTION_LENGTH
from alienclaw_ga.genome.checksum import compute_checksum
from alienclaw_ga.genome.codec import XCODE_MAX, encode_xcode

FIXTURES = Path(__file__).parent / "fixtures"
EXECUTION_SLOT = 1

__all__ = ["FIXTURES", "XCODE_MAX", "load_winner", "with_xcodes"]


def with_xcodes(genome: str, values: dict[int, int], slot: int = EXECUTION_SLOT) -> str:
    """Return ``genome`` with the given Xcodes overwritten and a fresh checksum."""
    chars = list(genome[:192])
    for xcode_index, value in values.items():
        pos = slot * SECTION_LENGTH + 1 + xcode_index * 2
        enc = encode_xcode(value)
        chars[pos], chars[pos + 1] = enc[0], enc[1]
    body = "".join(chars)
    return body + compute_checksum(body)


def load_winner(tuner: str) -> dict:
    """Load the committed winner artifacts copied from <tuner>_tuner/results/."""
    d = FIXTURES / tuner
    return {
        "genome_txt": (d / "winner.genome.txt").read_text(),
        "config": json.loads((d / "winner.genome.config.json").read_text()),
        "results": json.loads((d / "winner.genome.results.json").read_text()),
    }
