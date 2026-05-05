"""AlienClaw brain module.

Implements the martianbrain (.msb) registry per MARTIANBRAIN_SPEC.md v1.0.
Mirrors the canonical TypeScript loader at src/alienclaw/msb/msb-loader.ts.

Public API:
    from alienclaw.brains.parser import parse_msb
    from alienclaw.brains.linter import lint
    from alienclaw.brains.registry import BrainRegistry
    from alienclaw.brains.types import BrainSpec, GenomeSectionDocs, ValidationResult

Cross-language compliance:
    parse_msb() must produce identical field values to parseMsbContent() in
    src/alienclaw/msb/msb-loader.ts for the same input. Validated via
    test/fixtures/brain-registry-fixtures.json consumed by both runners.
"""
