"""Pho3nix profile param-vector ↔ AlienClaw genome translation.

Gene layout — EXECUTION section (slot_index=1), Xcodes 0–3:

  Xcode 0: threads       — int [5, 50]       gobuster parallel threads
  Xcode 1: delay_ms      — int [0, 1000]     gobuster request delay (ms → "Xs" string)
  Xcode 2: timeout_sec   — int [5, 30]       gobuster/nmap timeout
  Xcode 3: timing_t      — int [2, 5]        nmap timing template (→ "-T{n}" flag)

Gene space = intersection of Pho3nix optimization_profiles ∩ rebuild_command_with_params
applicable params (command_params.py). sqlmap level/risk/threads/delay are NOT applicable
(rebuild only handles gobuster threads/delay/timeout and nmap timing), so they are excluded.

ID tag PHO00001 is the stable Martian identifier for pho3nix genomes; it is never mutated
by AlienClaw's operators.

Baseline config (matches Pho3nix's hand-authored "normal" profile defaults):
  - gobuster: threads=20, delay_ms=0, timeout_sec=10
  - nmap: timing_t=4 (-T4)
"""

from __future__ import annotations

import random
import sys
from pathlib import Path

_AC_SRC = Path(__file__).parent.parent / "src"
if str(_AC_SRC) not in sys.path:
    sys.path.insert(0, str(_AC_SRC))

from alienclaw.genome.alphabet import SECTION_LENGTH  # noqa: E402
from alienclaw.genome.checksum import compute_checksum  # noqa: E402
from alienclaw.genome.codec import (  # noqa: E402
    decode_xcode,
    encode_xcode,
    param_value_to_xcode,
    xcode_to_param_value,
)
from alienclaw.genome.operators import random_genome  # noqa: E402

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PHO_ID_TAG: str = "PHO00001"        # 8 chars — stable across all pho3nix genomes
PHO_NAMESPACE: str = "Pho3nixGA0"   # 10 chars — origin namespace

_SLOT: int = 1  # EXECUTION slot

# Xcode indices within the EXECUTION slot
_XC_THREADS: int = 0
_XC_DELAY_MS: int = 1
_XC_TIMEOUT_SEC: int = 2
_XC_TIMING_T: int = 3

# Parameter bounds (integer, stored directly in Xcode)
_THREADS_MIN, _THREADS_MAX = 5, 50
_DELAY_MS_MIN, _DELAY_MS_MAX = 0, 1000
_TIMEOUT_SEC_MIN, _TIMEOUT_SEC_MAX = 5, 30
_TIMING_T_MIN, _TIMING_T_MAX = 2, 5

# ---------------------------------------------------------------------------
# Defaults (matches Pho3nix hand-authored "normal" profile)
# ---------------------------------------------------------------------------

DEFAULT_CONFIG: dict = {
    "threads": 20,
    "delay_ms": 0,
    "timeout_sec": 10,
    "timing_t": 4,
}

# Baseline for gobuster stealth profile
STEALTH_CONFIG: dict = {
    "threads": 5,
    "delay_ms": 1000,
    "timeout_sec": 30,
    "timing_t": 2,
}

# Baseline for gobuster aggressive profile
AGGRESSIVE_CONFIG: dict = {
    "threads": 50,
    "delay_ms": 0,
    "timeout_sec": 5,
    "timing_t": 5,
}


# ---------------------------------------------------------------------------
# Genome → config
# ---------------------------------------------------------------------------

def decode_pho_config(genome: str) -> dict:
    """Decode a 256-char AlienClaw genome into a Pho3nix profile param dict.

    Reads Xcodes 0–3 from the EXECUTION slot. All other positions are ignored.

    Returns a dict with keys:
        threads (int):      gobuster parallel threads [5, 50]
        delay_ms (int):     gobuster request delay in ms [0, 1000]
        timeout_sec (int):  gobuster/nmap timeout in seconds [5, 30]
        timing_t (int):     nmap timing template T-value [2, 5]
    """
    threads_raw = decode_xcode(genome, _SLOT, _XC_THREADS)
    delay_raw = decode_xcode(genome, _SLOT, _XC_DELAY_MS)
    timeout_raw = decode_xcode(genome, _SLOT, _XC_TIMEOUT_SEC)
    timing_raw = decode_xcode(genome, _SLOT, _XC_TIMING_T)

    threads = xcode_to_param_value(threads_raw, _THREADS_MIN, _THREADS_MAX)
    delay_ms = xcode_to_param_value(delay_raw, _DELAY_MS_MIN, _DELAY_MS_MAX)
    timeout_sec = xcode_to_param_value(timeout_raw, _TIMEOUT_SEC_MIN, _TIMEOUT_SEC_MAX)
    timing_t = xcode_to_param_value(timing_raw, _TIMING_T_MIN, _TIMING_T_MAX)

    return {
        "threads": threads,
        "delay_ms": delay_ms,
        "timeout_sec": timeout_sec,
        "timing_t": timing_t,
    }


# ---------------------------------------------------------------------------
# Config → genome
# ---------------------------------------------------------------------------

def _patch_xcode(chars: list[str], slot_index: int, xcode_index: int, value: int) -> None:
    """Write an Xcode into a chars list (mutable genome body, 192 chars)."""
    base = slot_index * SECTION_LENGTH + 1 + xcode_index * 2
    enc = encode_xcode(value)
    chars[base] = enc[0]
    chars[base + 1] = enc[1]


def encode_pho_config(config: dict, rng: random.Random) -> str:
    """Encode a Pho3nix param config dict into a valid 256-char AlienClaw genome.

    Generates a random base genome with PHO_ID_TAG fixed, then patches
    Xcodes 0–3 of the EXECUTION slot with the config values.

    Args:
        config: dict as returned by decode_pho_config() (or DEFAULT_CONFIG).
        rng:    Seeded random.Random for the random parts of the genome.

    Returns:
        A valid 256-char Base62 genome string.
    """
    base = random_genome(rng, PHO_ID_TAG, PHO_NAMESPACE)
    chars = list(base[:192])

    threads = max(_THREADS_MIN, min(_THREADS_MAX, int(config["threads"])))
    delay_ms = max(_DELAY_MS_MIN, min(_DELAY_MS_MAX, int(config["delay_ms"])))
    timeout_sec = max(_TIMEOUT_SEC_MIN, min(_TIMEOUT_SEC_MAX, int(config["timeout_sec"])))
    timing_t = max(_TIMING_T_MIN, min(_TIMING_T_MAX, int(config["timing_t"])))

    _patch_xcode(
        chars, _SLOT, _XC_THREADS,
        param_value_to_xcode(threads, _THREADS_MIN, _THREADS_MAX),
    )
    _patch_xcode(
        chars, _SLOT, _XC_DELAY_MS,
        param_value_to_xcode(delay_ms, _DELAY_MS_MIN, _DELAY_MS_MAX),
    )
    _patch_xcode(
        chars, _SLOT, _XC_TIMEOUT_SEC,
        param_value_to_xcode(timeout_sec, _TIMEOUT_SEC_MIN, _TIMEOUT_SEC_MAX),
    )
    _patch_xcode(
        chars, _SLOT, _XC_TIMING_T,
        param_value_to_xcode(timing_t, _TIMING_T_MIN, _TIMING_T_MAX),
    )

    body = "".join(chars)
    return body + compute_checksum(body)


def random_pho_genome(rng: random.Random) -> str:
    """Generate a random pho3nix genome with PHO_ID_TAG fixed.

    All Xcode positions are randomised; checksum is computed fresh.
    Returns a valid 256-char Base62 genome string.
    """
    return random_genome(rng, PHO_ID_TAG, PHO_NAMESPACE)


# ---------------------------------------------------------------------------
# Config → Pho3nix params (for use with rebuild_command_with_params)
# ---------------------------------------------------------------------------

def config_to_gobuster_params(config: dict) -> dict:
    """Convert a decoded pho config to gobuster params dict.

    Returns a dict suitable for passing to rebuild_command_with_params
    (command_params.py). delay is formatted as a string ("0s", "1s", etc.)
    matching gobuster's --delay flag format.
    """
    delay_sec = config["delay_ms"] / 1000.0
    return {
        "threads": config["threads"],
        "delay": f"{delay_sec:.1f}s",
        "timeout": f"{config['timeout_sec']}s",
    }


def config_to_nmap_params(config: dict) -> dict:
    """Convert a decoded pho config to nmap params dict.

    Returns a dict suitable for rebuild_command_with_params (nmap timing).
    """
    return {
        "timing": f"-T{config['timing_t']}",
    }
