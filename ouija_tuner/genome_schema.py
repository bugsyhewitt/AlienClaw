"""Ouija campaign config ↔ AlienClaw genome translation.

Gene layout — EXECUTION section (slot_index=1), Xcodes 0–3:

  Xcode 0: carrier      — int [0,6]    0=plain 1=b64 2=hex 3=rot13 4=homoglyph 5=zwsp 6=utag
  Xcode 1: framing      — int [0,5]    0=none 1=polite 2=urgent 3=roleplay 4=authority 5=obfuscate
  Xcode 2: repeats      — int [1,40]   ASR repeat count per probe seed
  Xcode 3: temp_x100    — int [0,100]  temperature × 100  (0 → 0.0 … 100 → 1.0)

All other Xcode positions are free (randomised on genome creation, mutated by the GA
operators, ignored by the decoder) — neutral mutations give the crossover operator room.

The ID tag OUI00001 is the stable Martian identifier for ouija genomes; never mutated.
"""

from __future__ import annotations

import random
import sys
from pathlib import Path

_AC_SRC = Path(__file__).parent.parent / "src"
if str(_AC_SRC) not in sys.path:
    sys.path.insert(0, str(_AC_SRC))

from alienclaw.genome.codec import (  # noqa: E402
    decode_xcode,
    encode_xcode,
    param_value_to_xcode,
    xcode_to_param_value,
)
from alienclaw.genome.alphabet import SECTION_LENGTH  # noqa: E402
from alienclaw.genome.checksum import compute_checksum  # noqa: E402
from alienclaw.genome.operators import random_genome  # noqa: E402

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

OUIJA_ID_TAG: str = "OUI00001"
OUIJA_NAMESPACE: str = "OuijaGA001"

_SLOT: int = 1  # EXECUTION slot

_XC_CARRIER: int = 0
_XC_FRAMING: int = 1
_XC_REPEATS: int = 2
_XC_TEMP_X100: int = 3

_CARRIER_MIN, _CARRIER_MAX = 0, 6
_FRAMING_MIN, _FRAMING_MAX = 0, 5
_REPEATS_MIN, _REPEATS_MAX = 1, 40
_TEMP_MIN, _TEMP_MAX = 0, 100

# Carrier names indexed by param value (must match ouija/encoders.py CARRIER_ORDER)
CARRIERS = ("plain", "b64", "hex", "rot13", "homoglyph", "zwsp", "utag")

# Framing names indexed by param value
FRAMINGS = ("none", "polite", "urgent", "roleplay", "authority", "obfuscate")

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_CONFIG: dict = {
    "carrier": "plain",
    "framing": "none",
    "repeats": 5,
    "temperature": 0.0,
}

# Best-known single-carrier baseline (plain + no framing, Ollama seed=0)
PLAIN_BASELINE_CONFIG: dict = {
    "carrier": "plain",
    "framing": "none",
    "repeats": 5,
    "temperature": 0.0,
}


# ---------------------------------------------------------------------------
# Genome → config
# ---------------------------------------------------------------------------

def decode_ouija_config(genome: str) -> dict:
    """Decode a 256-char AlienClaw genome into an ouija campaign config dict."""
    carrier_raw  = decode_xcode(genome, _SLOT, _XC_CARRIER)
    framing_raw  = decode_xcode(genome, _SLOT, _XC_FRAMING)
    repeats_raw  = decode_xcode(genome, _SLOT, _XC_REPEATS)
    temp_raw     = decode_xcode(genome, _SLOT, _XC_TEMP_X100)

    carrier_int  = xcode_to_param_value(carrier_raw,  _CARRIER_MIN, _CARRIER_MAX)
    framing_int  = xcode_to_param_value(framing_raw,  _FRAMING_MIN, _FRAMING_MAX)
    repeats_int  = xcode_to_param_value(repeats_raw,  _REPEATS_MIN, _REPEATS_MAX)
    temp_int     = xcode_to_param_value(temp_raw,     _TEMP_MIN,    _TEMP_MAX)

    return {
        "carrier":     CARRIERS[int(carrier_int)],
        "framing":     FRAMINGS[int(framing_int)],
        "repeats":     int(repeats_int),
        "temperature": round(int(temp_int) / 100.0, 2),
    }


# ---------------------------------------------------------------------------
# Config → genome
# ---------------------------------------------------------------------------

def _patch_xcode(chars: list[str], slot_index: int, xcode_index: int, value: int) -> None:
    base = slot_index * SECTION_LENGTH + 1 + xcode_index * 2
    enc = encode_xcode(value)
    chars[base] = enc[0]
    chars[base + 1] = enc[1]


def encode_ouija_config(config: dict, rng: random.Random) -> str:
    """Encode an ouija config dict into a valid 256-char AlienClaw genome."""
    base = random_genome(rng, OUIJA_ID_TAG, OUIJA_NAMESPACE)
    chars = list(base[:192])

    carrier_int  = CARRIERS.index(config["carrier"])
    framing_int  = FRAMINGS.index(config["framing"])
    repeats_int  = max(_REPEATS_MIN, min(_REPEATS_MAX, int(config["repeats"])))
    temp_int     = max(_TEMP_MIN, min(_TEMP_MAX, round(config["temperature"] * 100)))

    _patch_xcode(chars, _SLOT, _XC_CARRIER,   param_value_to_xcode(carrier_int,  _CARRIER_MIN, _CARRIER_MAX))
    _patch_xcode(chars, _SLOT, _XC_FRAMING,   param_value_to_xcode(framing_int,  _FRAMING_MIN, _FRAMING_MAX))
    _patch_xcode(chars, _SLOT, _XC_REPEATS,   param_value_to_xcode(repeats_int,  _REPEATS_MIN, _REPEATS_MAX))
    _patch_xcode(chars, _SLOT, _XC_TEMP_X100, param_value_to_xcode(temp_int,     _TEMP_MIN,    _TEMP_MAX))

    body = "".join(chars)
    return body + compute_checksum(body)


def random_ouija_genome(rng: random.Random) -> str:
    """Generate a random ouija genome with OUIJA_ID_TAG fixed."""
    return random_genome(rng, OUIJA_ID_TAG, OUIJA_NAMESPACE)
