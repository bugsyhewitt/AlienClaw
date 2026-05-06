"""Brain module types.

Mirrors src/alienclaw/msb/msb-types.ts exactly. Field names are
snake_case in Python (camelCase in TypeScript).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ParameterSchemaField:
    """One machine-readable parameter declaration from a brain's PARAMETER_SCHEMA.

    Mirrors TypeScript ParameterSchemaField in msb-types.ts.

    Attributes:
        name:         Parameter name (e.g. 'max_attempts').
        section:      Which genome section: 'EXECUTION' or 'BEHAVIOR'.
        byte_offset:  Byte within that section (0..63).
        encoding:     How to decode the raw character into a typed value.
                      Canonical names: mod5_plus1, mod10_plus1, mod10_times500,
                      char_eq_F, char_code_even.
        type:         Return type: 'int', 'float', 'bool'.
        default:      Value used when decoding fails or section is absent.
    """
    name: str
    section: str       # 'EXECUTION' | 'BEHAVIOR'
    byte_offset: int   # 0..63
    encoding: str
    type: str          # 'int' | 'float' | 'bool'
    default: Any


@dataclass(frozen=True)
class GenomeSectionDocs:
    """Prose documentation of what each genome section encodes for a specific tool.

    Mirrors TypeScript GenomeSectionDocs in msb-types.ts.

    Attributes:
        identity:  Description of IDENTITY section (chars 0-63) semantics.
        execution: Description of EXECUTION section (chars 64-127) semantics.
        behavior:  Description of BEHAVIOR section (chars 128-191) semantics.
        checksum:  Description of CHECKSUM section (chars 192-255) semantics.
    """

    identity: str
    execution: str
    behavior: str
    checksum: str


@dataclass(frozen=True)
class BrainSpec:
    """Parsed representation of a .msb brain file.

    Mirrors TypeScript MartianBrain in msb-types.ts. Field names are
    snake_case here; the TypeScript uses camelCase equivalents.

    Attributes:
        tool:            Canonical tool name (e.g., 'web_search').
        version:         Brain version string (e.g., '1.0').
        capabilities:    Prose describing what the tool can do.
        limitations:     Prose describing what the tool cannot do.
        failure_modes:   Prose describing failure conditions and responses.
        best_practices:  Prose guidance for effective use.
        execution_order: Ordered list of execution steps (numbered list items).
        output_contract: JSON schema string describing expected output.
        genome_sections: Per-section encoding documentation.
        variables:       Runtime variable names and their descriptions.
        source_path:     Path of the .msb file (set by the loader; '' if inline).
    """

    tool: str
    version: str
    capabilities: str
    limitations: str
    failure_modes: str
    best_practices: str
    execution_order: tuple[str, ...]
    output_contract: str
    genome_sections: GenomeSectionDocs
    variables: dict[str, str]
    parameter_schema: tuple[ParameterSchemaField, ...] = ()
    source_path: str = ""


@dataclass(frozen=True)
class ValidationResult:
    """Result of .msb validation.

    Mirrors TypeScript MsbValidationResult in msb-types.ts.

    Attributes:
        valid:  True iff all required sections are present and non-empty.
        errors: List of human-readable error descriptions.
    """

    valid: bool
    errors: tuple[str, ...] = ()

    def __bool__(self) -> bool:
        return self.valid
