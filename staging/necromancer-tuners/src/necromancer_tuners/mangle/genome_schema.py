"""Mangle campaign config ↔ AlienClaw genome translation.

Gene layout — EXECUTION section (slot_index=1), Xcodes 0–5:

  Xcode 0: strategy      — int [0,1]      (0=uniform, 1=adaptive)
  Xcode 1: alpha_x10     — int [1,50]     → alpha  = val / 10.0   (0.1–5.0)
  Xcode 2: beta_x10      — int [1,50]     → beta   = val / 10.0   (0.1–5.0)
  Xcode 3: ef_x1000      — int [0,45]     → floor  = val / 1000.0 (0.0–0.045; ≤ 1/22)
  Xcode 4: concurrency   — int [1,16]
  Xcode 5: timeout_x10   — int [10,300]   → timeout = val / 10.0  (1.0s–30.0s)

All other Xcode positions are free (randomised on genome creation, mutated by
the GA operators, ignored by the decoder). This is intentional: the unused
positions give the crossover operator room to mix without always touching the
active params — analogous to neutral mutations in biological evolution.

The ID tag MGL00001 is the stable Martian identifier for mangle genomes; it is
never mutated by AlienClaw's operators.
"""

from __future__ import annotations

import random

from alienclaw_ga.genome.alphabet import SECTION_LENGTH
from alienclaw_ga.genome.checksum import compute_checksum
from alienclaw_ga.genome.codec import (
    decode_xcode,
    encode_xcode,
    param_value_to_xcode,
    xcode_to_param_value,
)
from alienclaw_ga.genome.operators import random_genome

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MANGLE_ID_TAG: str = "MGL00001"   # 8 chars — stable across all mangle genomes
MANGLE_NAMESPACE: str = "MangleGA01"  # 10 chars — origin namespace

# Xcode slot index for all mangle params (EXECUTION = slot 1)
_SLOT: int = 1

# Xcode indices within the EXECUTION slot
_XC_STRATEGY: int = 0
_XC_ALPHA_X10: int = 1
_XC_BETA_X10: int = 2
_XC_EF_X1000: int = 3
_XC_CONCURRENCY: int = 4
_XC_TIMEOUT_X10: int = 5

# Parameter bounds (integer after scaling)
_STRATEGY_MIN, _STRATEGY_MAX = 0, 1          # 0=uniform, 1=adaptive
_ALPHA_MIN, _ALPHA_MAX = 1, 50               # alpha = val/10.0 → [0.1, 5.0]
_BETA_MIN, _BETA_MAX = 1, 50                 # beta  = val/10.0 → [0.1, 5.0]
_EF_MIN, _EF_MAX = 0, 45                     # floor = val/1000.0 → [0.0, 0.045]
_CONC_MIN, _CONC_MAX = 1, 16                 # concurrency
_TIMEOUT_MIN, _TIMEOUT_MAX = 10, 300         # timeout = val/10.0 → [1.0s, 30.0s]

# ---------------------------------------------------------------------------
# Defaults (matches mangle's out-of-the-box settings)
# ---------------------------------------------------------------------------

DEFAULT_CONFIG: dict = {
    "strategy": "uniform",
    "alpha": 1.0,
    "beta": 1.0,
    "exploration_floor": 0.02,
    "concurrency": 4,
    "timeout": 5.0,
}

ADAPTIVE_DEFAULT_CONFIG: dict = {
    "strategy": "adaptive",
    "alpha": 1.0,
    "beta": 1.0,
    "exploration_floor": 0.02,
    "concurrency": 4,
    "timeout": 5.0,
}


# ---------------------------------------------------------------------------
# Genome → config
# ---------------------------------------------------------------------------

def decode_mangle_config(genome: str) -> dict:
    """Decode a 256-char AlienClaw genome into a mangle campaign config dict.

    Reads Xcodes 0–5 from the EXECUTION slot and maps them to the six
    tunable mangle parameters. All other Xcode positions are ignored.

    Returns a dict with keys:
        strategy (str): "uniform" or "adaptive"
        alpha (float): Beta-prior alpha for AdaptiveScheduler [0.1, 5.0]
        beta (float): Beta-prior beta for AdaptiveScheduler [0.1, 5.0]
        exploration_floor (float): Per-arm floor probability [0.0, 0.045]
        concurrency (int): Parallel decode workers [1, 16]
        timeout (float): Per-decode timeout in seconds [1.0, 30.0]
    """
    strategy_raw = decode_xcode(genome, _SLOT, _XC_STRATEGY)
    alpha_raw     = decode_xcode(genome, _SLOT, _XC_ALPHA_X10)
    beta_raw      = decode_xcode(genome, _SLOT, _XC_BETA_X10)
    ef_raw        = decode_xcode(genome, _SLOT, _XC_EF_X1000)
    conc_raw      = decode_xcode(genome, _SLOT, _XC_CONCURRENCY)
    timeout_raw   = decode_xcode(genome, _SLOT, _XC_TIMEOUT_X10)

    strategy_int = xcode_to_param_value(strategy_raw, _STRATEGY_MIN, _STRATEGY_MAX)
    alpha_int    = xcode_to_param_value(alpha_raw,    _ALPHA_MIN,    _ALPHA_MAX)
    beta_int     = xcode_to_param_value(beta_raw,     _BETA_MIN,     _BETA_MAX)
    ef_int       = xcode_to_param_value(ef_raw,       _EF_MIN,       _EF_MAX)
    conc_int     = xcode_to_param_value(conc_raw,     _CONC_MIN,     _CONC_MAX)
    timeout_int  = xcode_to_param_value(timeout_raw,  _TIMEOUT_MIN,  _TIMEOUT_MAX)

    return {
        "strategy": "adaptive" if strategy_int == 1 else "uniform",
        "alpha": alpha_int / 10.0,
        "beta": beta_int / 10.0,
        "exploration_floor": ef_int / 1000.0,
        "concurrency": conc_int,
        "timeout": timeout_int / 10.0,
    }


# ---------------------------------------------------------------------------
# Config → genome (patch Xcodes into an existing genome body)
# ---------------------------------------------------------------------------

def _patch_xcode(chars: list[str], slot_index: int, xcode_index: int, value: int) -> None:
    """Write an Xcode into a chars list (mutable genome body, 192 chars)."""
    base = slot_index * SECTION_LENGTH + 1 + xcode_index * 2
    enc = encode_xcode(value)
    chars[base] = enc[0]
    chars[base + 1] = enc[1]


def encode_mangle_config(config: dict, rng: random.Random) -> str:
    """Encode a mangle config dict into a valid 256-char AlienClaw genome.

    Generates a random base genome with the MANGLE_ID_TAG fixed, then
    patches Xcodes 0–5 of the EXECUTION slot with the config values.
    The resulting genome has a freshly-computed checksum.

    Args:
        config: dict as returned by decode_mangle_config() (or DEFAULT_CONFIG).
        rng:    Seeded random.Random for the random parts of the genome.

    Returns:
        A valid 256-char Base62 genome string.
    """
    base = random_genome(rng, MANGLE_ID_TAG, MANGLE_NAMESPACE)
    # genome body is chars 0–191; checksum is 192–255
    chars = list(base[:192])

    strategy_int = 1 if config.get("strategy") == "adaptive" else 0
    alpha_int    = max(_ALPHA_MIN,    min(_ALPHA_MAX,    round(config["alpha"] * 10)))
    beta_int     = max(_BETA_MIN,     min(_BETA_MAX,     round(config["beta"] * 10)))
    ef_int       = max(_EF_MIN,       min(_EF_MAX,
                                          round(config["exploration_floor"] * 1000)))
    conc_int     = max(_CONC_MIN,     min(_CONC_MAX,     int(config["concurrency"])))
    timeout_int  = max(_TIMEOUT_MIN,  min(_TIMEOUT_MAX,  round(config["timeout"] * 10)))

    _patch_xcode(chars, _SLOT, _XC_STRATEGY,
                 param_value_to_xcode(strategy_int, _STRATEGY_MIN, _STRATEGY_MAX))
    _patch_xcode(chars, _SLOT, _XC_ALPHA_X10,
                 param_value_to_xcode(alpha_int,    _ALPHA_MIN,    _ALPHA_MAX))
    _patch_xcode(chars, _SLOT, _XC_BETA_X10,
                 param_value_to_xcode(beta_int,     _BETA_MIN,     _BETA_MAX))
    _patch_xcode(chars, _SLOT, _XC_EF_X1000,
                 param_value_to_xcode(ef_int,       _EF_MIN,       _EF_MAX))
    _patch_xcode(chars, _SLOT, _XC_CONCURRENCY,
                 param_value_to_xcode(conc_int,     _CONC_MIN,     _CONC_MAX))
    _patch_xcode(chars, _SLOT, _XC_TIMEOUT_X10,
                 param_value_to_xcode(timeout_int,  _TIMEOUT_MIN,  _TIMEOUT_MAX))

    body = "".join(chars)
    return body + compute_checksum(body)


def random_mangle_genome(rng: random.Random) -> str:
    """Generate a random mangle genome with MANGLE_ID_TAG fixed.

    All Xcode positions (including the mangle params) are randomised, then
    the checksum is computed. This is the starting population seed — the GA
    will evolve the params from this random starting point.

    Returns a valid 256-char Base62 genome string.
    """
    return random_genome(rng, MANGLE_ID_TAG, MANGLE_NAMESPACE)
