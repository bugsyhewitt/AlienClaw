"""AlienClaw genome module.

Implements the 256-char Base62 genome per GENOME_SPEC.md v1.0.

Public API:
    from alienclaw.genome.codec import assemble, parse, round_trip_check
    from alienclaw.genome.operators import mutate, crossover
    from alienclaw.genome.validation import validate, ValidationResult
    from alienclaw.genome.checksum import compute_checksum, verify_checksum
    from alienclaw.genome.types import ParsedGenome
    from alienclaw.genome.alphabet import ALPHABET, GENOME_LENGTH, SECTION_LENGTH

Cross-language compliance:
    This module and the TypeScript canonical codec at
    src/alienclaw/registry/genome-codec.ts must produce identical outputs
    for all shared fixture cases in test/fixtures/genome-spec-fixtures.json.
"""
