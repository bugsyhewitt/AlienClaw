#!/usr/bin/env python3
"""gen-testvectors.py — Regenerate genome conformance test vectors (T2, PKT-P1).

Usage:
    python3 scripts/gen-testvectors.py [--output PATH]

Reads the current committed fixtures file, regenerates the adversarial and
seeded-random cases deterministically, and writes the result to PATH
(default: test/fixtures/genome-spec-fixtures.json).

The committed file is the normative vector set. check-testvectors.sh diffs
this script's output against the committed file to detect drift.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).parent.parent
FIXTURES_PATH = REPO_ROOT / "test" / "fixtures" / "genome-spec-fixtures.json"

# Add src to sys.path so we can import the codec
sys.path.insert(0, str(REPO_ROOT / "src"))

from alienclaw.genome.codec import assemble, parse
from alienclaw.genome.checksum import compute_checksum
from alienclaw.genome.alphabet import ALPHABET

ALPHABET_STR = ALPHABET

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def pad64(s: str) -> str:
    if len(s) > 64:
        raise ValueError(f"Section too long: {len(s)} > 64")
    return s + "0" * (64 - len(s))


def make_genome(identity: str, execution: str, behavior: str) -> str:
    return assemble(pad64(identity), pad64(execution), pad64(behavior))


def flip_char(genome: str, position: int) -> str:
    """Flip one character in the genome (cycle to next Base62 char)."""
    chars = list(genome)
    idx = ALPHABET_STR.index(chars[position])
    chars[position] = ALPHABET_STR[(idx + 1) % len(ALPHABET_STR)]
    return "".join(chars)


# ---------------------------------------------------------------------------
# Adversarial case generators
# ---------------------------------------------------------------------------

def adversarial_cases() -> list[dict]:
    """Generate adversarial test vector cases (deterministic)."""
    cases = []

    # --- invalid_length ---
    cases.append({
        "name": "adversarial-invalid-length-255",
        "kind": "validate",
        "input": "A" * 255,
        "expected_pass": False,
        "expected_error": "INVALID_LENGTH",
    })
    cases.append({
        "name": "adversarial-invalid-length-257",
        "kind": "validate",
        "input": "A" * 257,
        "expected_pass": False,
        "expected_error": "INVALID_LENGTH",
    })
    cases.append({
        "name": "adversarial-invalid-length-0",
        "kind": "validate",
        "input": "",
        "expected_pass": False,
        "expected_error": "INVALID_LENGTH",
    })

    # --- invalid_character ---
    body = "A" * 192
    checksum = compute_checksum(body)
    valid_genome = body + checksum

    # Replace one char with an invalid character
    for bad_char, label in [("!", "exclamation"), ("@", "at"), (" ", "space")]:
        mutated = bad_char + valid_genome[1:]
        cases.append({
            "name": f"adversarial-invalid-char-{label}",
            "kind": "validate",
            "input": mutated,
            "expected_pass": False,
            "expected_error": "INVALID_CHARACTER",
        })

    # --- confusable_fail_checksum ---
    # Valid genome with confusable character substitutions (0→O, 1→l, I→1)
    seed_genome = make_genome(
        "WEB00001G1AlienClaw1WebSearchFamily",
        "3RSequentialPerfBalanced",
        "EscalateStdOutputJSONArray",
    )
    confusables = [("0", "O"), ("1", "l")]
    for orig, repl in confusables:
        if orig in seed_genome[:192]:
            idx = seed_genome.index(orig)
            confusable_genome = seed_genome[:idx] + repl + seed_genome[idx + 1:]
            if len(confusable_genome) == 256:
                cases.append({
                    "name": f"adversarial-confusable-{orig}-to-{repl}",
                    "kind": "validate",
                    "input": confusable_genome,
                    "expected_pass": False,
                    "expected_error": "CHECKSUM_MISMATCH",
                })

    # --- bad_checksum ---
    # Valid genome with last char of checksum flipped
    bad_checksum_genome = flip_char(seed_genome, 255)
    cases.append({
        "name": "adversarial-bad-checksum-last-char",
        "kind": "validate",
        "input": bad_checksum_genome,
        "expected_pass": False,
        "expected_error": "CHECKSUM_MISMATCH",
    })

    # Bad checksum at position 192 (first checksum char)
    bad_checksum_genome2 = flip_char(seed_genome, 192)
    cases.append({
        "name": "adversarial-bad-checksum-first-char",
        "kind": "validate",
        "input": bad_checksum_genome2,
        "expected_pass": False,
        "expected_error": "CHECKSUM_MISMATCH",
    })

    # --- all_minimum ---
    all_min_body = "0" * 192
    all_min_checksum = compute_checksum(all_min_body)
    cases.append({
        "name": "adversarial-all-minimum",
        "kind": "validate",
        "input": all_min_body + all_min_checksum,
        "expected_pass": True,
    })

    # --- all_maximum ---
    all_max_body = "z" * 192
    all_max_checksum = compute_checksum(all_max_body)
    cases.append({
        "name": "adversarial-all-maximum",
        "kind": "validate",
        "input": all_max_body + all_max_checksum,
        "expected_pass": True,
    })

    return cases


def seeded_random_cases(n: int = 20, seed: int = 42) -> list[dict]:
    """Generate N valid random genomes using a fixed RNG seed."""
    rng = random.Random(seed)
    cases = []
    for i in range(n):
        body = "".join(rng.choice(ALPHABET_STR) for _ in range(192))
        checksum = compute_checksum(body)
        genome = body + checksum
        # Verify it's actually valid
        try:
            parse(genome)
            valid = True
        except ValueError:
            valid = False
        cases.append({
            "name": f"seeded-random-{i:02d}",
            "kind": "validate",
            "input": genome,
            "expected_pass": valid,
        })
    return cases


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Regenerate genome test vectors.")
    parser.add_argument(
        "--output",
        default=str(FIXTURES_PATH),
        help="Output path (default: test/fixtures/genome-spec-fixtures.json)",
    )
    args = parser.parse_args()

    # Load existing fixtures
    with open(FIXTURES_PATH, encoding="utf-8") as f:
        data = json.load(f)

    existing_cases = data["cases"]

    # Remove any previously generated adversarial/seeded-random cases
    # (they start with "adversarial-" or "seeded-random-")
    base_cases = [
        c for c in existing_cases
        if not c["name"].startswith("adversarial-") and not c["name"].startswith("seeded-random-")
    ]

    # Regenerate adversarial + random cases
    new_cases = base_cases + adversarial_cases() + seeded_random_cases(20, seed=42)

    # Update metadata
    data["cases"] = new_cases
    data["$generated"] = (
        "2026-09-07 by scripts/gen-testvectors.py (PKT-P1 T2)"
    )
    data["$adversarial_count"] = len(adversarial_cases())
    data["$seeded_random_count"] = 20

    output_path = args.output
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(
        f"Wrote {len(new_cases)} cases "
        f"({len(base_cases)} base + {len(new_cases) - len(base_cases)} new) "
        f"to {output_path}"
    )


if __name__ == "__main__":
    main()
