"""Parse a .msb brain file into a BrainSpec.

Mirrors the TypeScript parseMsbContent() function in
src/alienclaw/msb/msb-loader.ts. Produces identical field values for
the same input — cross-language compliance enforced by
test/fixtures/brain-registry-fixtures.json.

Format: plain-text sections per canonical seed/msb/ files.
No YAML. No JSON frontmatter.

Required sections (REQUIRED_SECTIONS — mirrors the TS constant):
    TOOL, VERSION, CAPABILITIES, LIMITATIONS, FAILURE MODES,
    BEST PRACTICES, EXECUTION ORDER, OUTPUT CONTRACT,
    GENOME SECTIONS, VARIABLES
"""

from __future__ import annotations

import re

from .types import BrainSpec, GenomeSectionDocs, ParameterSchemaField, ValidationResult


class BrainParseError(ValueError):
    """Raised when an .msb file contains invalid PARAMETER_SCHEMA entries."""

# ---------------------------------------------------------------------------
# Required sections — must match TypeScript REQUIRED_SECTIONS array exactly
# ---------------------------------------------------------------------------

REQUIRED_SECTIONS: tuple[str, ...] = (
    "TOOL",
    "VERSION",
    "CAPABILITIES",
    "LIMITATIONS",
    "FAILURE MODES",
    "BEST PRACTICES",
    "EXECUTION ORDER",
    "OUTPUT CONTRACT",
    "GENOME SECTIONS",
    "VARIABLES",
)


# ---------------------------------------------------------------------------
# Low-level extractors (mirror TS extractField / extractSection helpers)
# ---------------------------------------------------------------------------

def _extract_field(raw: str, field_name: str) -> str:
    """Extract a single-line field value (e.g., 'TOOL: web_search' → 'web_search').

    Mirrors TS extractField(). Returns empty string if not found.
    """
    pattern = re.compile(rf"^{re.escape(field_name)}:\s*(.+)$", re.MULTILINE)
    m = pattern.search(raw)
    return m.group(1).strip() if m else ""


def _extract_section(raw: str, section_name: str) -> str:
    """Extract a multi-line section's content.

    Matches 'SECTION NAME:\\n<content until next ALL-CAPS heading or end-of-string>'.
    Mirrors the corrected TS extractSection() (bug fixed: use \\Z not $ to prevent
    the multiline flag from stopping at every line end).
    """
    pattern = re.compile(
        rf"^{re.escape(section_name)}:\s*\n([\s\S]*?)(?=\n[A-Z ]+:|\Z)",
        re.MULTILINE,
    )
    m = pattern.search(raw)
    return m.group(1).strip() if m else ""


def _extract_execution_order(raw: str) -> tuple[str, ...]:
    """Extract the numbered execution-order steps as a tuple.

    Mirrors TS extractExecutionOrder() — strips the 'N. ' prefix.
    """
    section = _extract_section(raw, "EXECUTION ORDER")
    if not section:
        return ()
    steps = []
    for line in section.split("\n"):
        cleaned = re.sub(r"^\d+\.\s*", "", line).strip()
        if cleaned:
            steps.append(cleaned)
    return tuple(steps)


def _extract_genome_sections(raw: str) -> GenomeSectionDocs:
    """Extract per-section genome documentation.

    Mirrors TS extractGenomeSections() with a bug-fix applied to both:
    the sub-keys (IDENTITY, EXECUTION, BEHAVIOR, CHECKSUM) are themselves
    ALL-CAPS patterns, so _extract_section("GENOME SECTIONS") stops at the
    IDENTITY line. We instead search the raw text from the GENOME SECTIONS
    header position forward, which correctly finds all four sub-keys.
    """
    # Find the GENOME SECTIONS header
    gs_match = re.search(r"^GENOME SECTIONS:\s*\n", raw, re.MULTILINE)
    if not gs_match:
        return GenomeSectionDocs(identity="", execution="", behavior="", checksum="")

    # Work only within the slice from GENOME SECTIONS onward
    tail = raw[gs_match.end():]

    def _get(key: str) -> str:
        m = re.search(rf"^{re.escape(key)}:\s*(.+)$", tail, re.MULTILINE)
        return m.group(1).strip() if m else ""

    return GenomeSectionDocs(
        identity=_get("IDENTITY"),
        execution=_get("EXECUTION"),
        behavior=_get("BEHAVIOR"),
        checksum=_get("CHECKSUM"),
    )


def _parse_default(value: str, type_: str) -> object:
    """Convert a string default to the appropriate Python type."""
    v = value.strip().lower()
    if type_ == "bool":
        return v in ("true", "yes", "1")
    if type_ == "float":
        try:
            return float(value)
        except ValueError:
            return 0.0
    # int
    try:
        return int(value)
    except ValueError:
        return 0


def _extract_parameter_schema(raw: str, source_path: str = "<string>") -> tuple[ParameterSchemaField, ...]:
    """Parse the PARAMETER_SCHEMA section — new 7-field pipe-delimited format.

    Format per line: name|xcode_index|range_min|range_max|default|direction|description
    Lines starting with '#' or blank are ignored.
    Raises BrainParseError if any entry is malformed or missing direction.
    """
    block = _extract_section(raw, "PARAMETER_SCHEMA")
    if not block:
        return ()
    fields: list[ParameterSchemaField] = []
    for line in block.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 7:
            raise BrainParseError(
                f"PARAMETER_SCHEMA entry in {source_path} has {len(parts)} fields "
                f"(expected 7: name|xcode_index|range_min|range_max|default|direction|description): {line!r}"
            )
        name, xcode_s, rmin_s, rmax_s, default_s, direction, description = parts[:7]
        try:
            xcode_index = int(xcode_s)
            range_min = int(rmin_s)
            range_max = int(rmax_s)
            default = int(default_s)
        except ValueError as exc:
            raise BrainParseError(
                f"PARAMETER_SCHEMA entry '{name}' in {source_path}: numeric field error: {exc}"
            )
        if direction not in ("lower", "higher", "none"):
            raise BrainParseError(
                f"PARAMETER_SCHEMA entry '{name}' in {source_path} has invalid "
                f"direction '{direction}'. Must be: lower | higher | none."
            )
        fields.append(ParameterSchemaField(
            name=name,
            description=description,
            xcode_index=xcode_index,
            range_min=range_min,
            range_max=range_max,
            default=default,
            direction=direction,
        ))
    return tuple(fields)


def _extract_variables(raw: str) -> dict[str, str]:
    """Extract the VARIABLES block as a name→description dict.

    Mirrors TS extractVariables().
    """
    block = _extract_section(raw, "VARIABLES")
    result: dict[str, str] = {}
    for line in block.split("\n"):
        m = re.match(r"^(\S+):\s+(.+)$", line)
        if m:
            result[m.group(1)] = m.group(2).strip()
    return result


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def validate(raw: str) -> ValidationResult:
    """Check that a .msb string has all required sections.

    Mirrors TS validateMsb(). Returns ValidationResult with list of missing
    sections. Does not parse the content — use parse_msb() for that.

    Args:
        raw: Full content of a .msb file.

    Returns:
        ValidationResult(valid=True, errors=()) if all required sections present.
    """
    errors: list[str] = []
    for section in REQUIRED_SECTIONS:
        if f"{section}:" not in raw:
            errors.append(f"Missing required section: {section}")

    if not _extract_field(raw, "TOOL"):
        errors.append("TOOL field is empty")
    if not _extract_field(raw, "VERSION"):
        errors.append("VERSION field is empty")

    return ValidationResult(valid=len(errors) == 0, errors=tuple(errors))


def parse_msb(content: str, source_path: str = "<string>") -> BrainSpec:
    """Parse a .msb file's full content into a BrainSpec.

    Mirrors TS parseMsbContent(). Raises ValueError on validation failure
    (instead of throwing Error, to match Python conventions).

    Args:
        content:     Full content of a .msb file.
        source_path: File path, used in error messages (default: '<string>').

    Returns:
        BrainSpec with all fields populated.

    Raises:
        ValueError: if any required section is missing or if TOOL/VERSION are empty.

    Example:
        spec = parse_msb(open('seed/msb/web_search.msb').read(), 'seed/msb/web_search.msb')
        print(spec.tool)  # 'web_search'
    """
    result = validate(content)
    if not result.valid:
        loc = f" ({source_path})" if source_path != "<string>" else ""
        raise ValueError(
            f"MSB validation failed{loc}:\n  " + "\n  ".join(result.errors)
        )

    return BrainSpec(
        tool=_extract_field(content, "TOOL"),
        version=_extract_field(content, "VERSION"),
        capabilities=_extract_section(content, "CAPABILITIES"),
        limitations=_extract_section(content, "LIMITATIONS"),
        failure_modes=_extract_section(content, "FAILURE MODES"),
        best_practices=_extract_section(content, "BEST PRACTICES"),
        execution_order=_extract_execution_order(content),
        output_contract=_extract_section(content, "OUTPUT CONTRACT"),
        genome_sections=_extract_genome_sections(content),
        variables=_extract_variables(content),
        parameter_schema=_extract_parameter_schema(content, source_path),
        source_path=source_path,
    )
