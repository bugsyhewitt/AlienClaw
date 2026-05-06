"""API key generation and verification.

Per LEADERBOARD_API_SPEC.md §authentication:
- API key = base62_encode(32 random bytes) = 43-char Base62 string
- Server stores SHA-256 hash of the key, never plaintext
- Client stores plaintext at ~/.alienclaw/api-key.txt (mode 0600)
"""
from __future__ import annotations

import hashlib
import os
import secrets
import stat
from pathlib import Path

from alienclaw.genome.alphabet import ALPHABET, ALPHABET_SET

_API_KEY_LENGTH = 43  # ceil(256 / log2(62)) ≈ 43 chars for 32 bytes
_KEY_FILE_MODE = 0o600


def generate_api_key() -> str:
    """Generate a new 43-char Base62 API key from 32 bytes of randomness."""
    raw = secrets.token_bytes(32)
    # Encode 32 bytes to Base62: convert int → base62 string
    n = int.from_bytes(raw, "big")
    chars: list[str] = []
    while n > 0:
        chars.append(ALPHABET[n % 62])
        n //= 62
    # Pad to 43 chars
    result = "".join(reversed(chars)).zfill(_API_KEY_LENGTH).replace(" ", "0")
    # Ensure exactly 43 chars using our alphabet
    while len(result) < _API_KEY_LENGTH:
        result = "0" + result
    return result[:_API_KEY_LENGTH]


def hash_api_key(api_key: str) -> str:
    """SHA-256 hash of the api_key. Returned as hex. Stored on server."""
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def is_valid_api_key_format(key: str) -> bool:
    """Check key is exactly 43 Base62 chars."""
    return len(key) == _API_KEY_LENGTH and all(c in ALPHABET_SET for c in key)


def is_valid_machine_hash(h: str) -> bool:
    """Check machine_hash is exactly 64 lowercase hex chars."""
    if len(h) != 64:
        return False
    return all(c in "0123456789abcdef" for c in h.lower()) and h == h.lower()


def load_or_create_key(key_path: Path | None = None) -> str:
    """Load existing key from file, or generate and save a new one."""
    path = key_path or Path.home() / ".alienclaw" / "api-key.txt"
    if path.exists():
        key = path.read_text(encoding="utf-8").strip()
        if is_valid_api_key_format(key):
            return key
    # Generate new key
    key = generate_api_key()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(key + "\n", encoding="utf-8")
    os.chmod(path, _KEY_FILE_MODE)
    return key
