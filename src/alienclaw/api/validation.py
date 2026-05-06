"""Server-side validation for genome submissions.

Per LEADERBOARD_API_SPEC.md §validation-rules. More strict than client-side:
validates checksum and run_metadata size in addition to basic format checks.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from alienclaw.genome.alphabet import ALPHABET_SET, GENOME_LENGTH
from alienclaw.genome.validation import validate as validate_genome_format
from .types import APIError, SubmissionRequest


@dataclass
class ValidationResult:
    valid: bool
    error: APIError | None = None


def ok() -> ValidationResult:
    return ValidationResult(valid=True)


def fail(code: str, message: str, details: dict[str, Any] | None = None) -> ValidationResult:
    return ValidationResult(valid=False, error=APIError(code=code, message=message, details=details or {}))


def validate_submission(req: SubmissionRequest, registered_types: set[str]) -> ValidationResult:
    """Full server-side validation of a genome submission per the spec."""
    # 1. Genome length
    if len(req.genome) != GENOME_LENGTH:
        return fail("INVALID_GENOME_LENGTH",
            f"Genome must be exactly {GENOME_LENGTH} characters; got {len(req.genome)}.",
            {"received_length": len(req.genome), "required_length": GENOME_LENGTH})

    # 2. Genome alphabet
    bad = [c for c in req.genome if c not in ALPHABET_SET]
    if bad:
        return fail("INVALID_GENOME_ALPHABET",
            f"Genome contains {len(bad)} non-Base62 character(s).",
            {"invalid_chars": bad[:5]})

    # 3. Genome checksum
    genome_check = validate_genome_format(req.genome)
    if not genome_check.valid:
        return fail("INVALID_GENOME_CHECKSUM",
            f"Genome checksum invalid: {genome_check.errors[0]}",
            {"errors": list(genome_check.errors)})

    # 4. Fitness range
    if not isinstance(req.fitness, (int, float)) or not (0.0 <= req.fitness <= 1.0):
        return fail("INVALID_FITNESS_RANGE",
            f"fitness must be in [0.0, 1.0]; got {req.fitness}.",
            {"received": req.fitness})

    # 5. Martian type registered
    if req.martian_type not in registered_types:
        return fail("UNKNOWN_MARTIAN_TYPE",
            f"martian_type '{req.martian_type}' is not registered.",
            {"available": sorted(registered_types)})

    # 6. run_metadata size
    meta_bytes = len(json.dumps(req.run_metadata))
    if meta_bytes > 4096:
        return fail("METADATA_TOO_LARGE",
            f"run_metadata exceeds 4096 bytes ({meta_bytes} bytes serialized).",
            {"received_bytes": meta_bytes, "limit_bytes": 4096})

    return ok()


def validate_install_request(api_key: str, machine_hash: str) -> ValidationResult:
    """Validate POST /v1/install request fields."""
    from .auth import is_valid_api_key_format, is_valid_machine_hash
    if not is_valid_api_key_format(api_key):
        return fail("INVALID_API_KEY_FORMAT",
            "api_key must be exactly 43 Base62 characters.",
            {"received_length": len(api_key)})
    if not is_valid_machine_hash(machine_hash):
        return fail("INVALID_MACHINE_HASH",
            "machine_hash must be exactly 64 lowercase hex characters.",
            {"received_length": len(machine_hash)})
    return ok()
