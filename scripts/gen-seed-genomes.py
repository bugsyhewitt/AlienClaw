#!/usr/bin/env python3
"""gen-seed-genomes.py — Regenerate seed Martian .martian files from the spec (T3, PKT-P1).

Usage:
    python3 scripts/gen-seed-genomes.py [--output-dir DIR]

Reads seed/martians.spec.yaml and renders each Martian type as a .martian YAML file
into --output-dir (default: a tmp directory printed to stdout).

NEVER overwrites the committed seed/martians/ directory.

The check-seed-drift.sh script calls this with --output-dir set to a temp directory
and diffs the output against the committed files.
"""

from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
SPEC_PATH = REPO_ROOT / "seed" / "martians.spec.yaml"
COMMITTED_DIR = REPO_ROOT / "seed" / "martians"

# Try to import PyYAML (available in dev dependencies)
try:
    import yaml
except ImportError:
    print("ERROR: PyYAML not available. Install with: pip install PyYAML", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Martian file renderer
# ---------------------------------------------------------------------------

def _quote(s: str) -> str:
    """Wrap a string in double quotes, matching the committed .martian file style."""
    return f'"{s}"'


def render_martian(martian: dict) -> str:
    """Render a martian spec dict to the YAML format used by .martian files.

    Produces output byte-for-byte identical to the committed .martian files:
    - description and use_cases strings are double-quoted
    - no trailing '...' line (PyYAML adds this; we avoid yaml.dump for scalars)
    """
    lines = []
    lines.append(f'martian_type: {martian["name"]}')
    lines.append(f'description: {_quote(martian["description"])}')
    lines.append('use_cases:')
    for uc in martian.get("use_cases", []):
        lines.append(f'  - {_quote(uc)}')
    lines.append('slots:')
    for slot in martian.get("slots", []):
        lines.append(f'  - slot_index: {slot["slot_index"]}')
        lines.append(f'    tool_name: {slot["tool_name"]}')
        inputs_from = slot.get("inputs_from")
        if inputs_from is None:
            lines.append('    inputs_from: null')
        else:
            lines.append('    inputs_from:')
            if "fields" in inputs_from:
                lines.append('      fields:')
                for field_name, template in inputs_from["fields"].items():
                    lines.append(f'        {field_name}: "{template}"')
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Regenerate seed Martian .martian files from seed/martians.spec.yaml."
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Directory to write .martian files (default: print to stdout and return temp dir path)",
    )
    args = parser.parse_args()

    # Load the spec
    spec_text = SPEC_PATH.read_text(encoding="utf-8")
    spec = yaml.safe_load(spec_text)

    martians = spec.get("martians", [])
    if len(martians) != 16:
        print(
            f"WARNING: spec declares {len(martians)} martians, expected 16",
            file=sys.stderr,
        )

    # Determine output directory
    if args.output_dir:
        output_dir = Path(args.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        owns_tmpdir = False
    else:
        tmpdir = tempfile.mkdtemp(prefix="gen-seed-genomes-")
        output_dir = Path(tmpdir)
        owns_tmpdir = True
        print(f"Output directory: {output_dir}", file=sys.stderr)

    # Render each martian
    for martian in martians:
        name = martian["name"]
        content = render_martian(martian)
        output_file = output_dir / f"{name}.martian"
        output_file.write_text(content, encoding="utf-8")

    if owns_tmpdir:
        print(str(output_dir))
    else:
        print(f"Generated {len(martians)} .martian files in {output_dir}")


if __name__ == "__main__":
    main()
