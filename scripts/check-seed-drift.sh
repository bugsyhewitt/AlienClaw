#!/usr/bin/env bash
# check-seed-drift.sh — Drift gate for seed Martian .martian files (T3, PKT-P1).
#
# Usage: bash scripts/check-seed-drift.sh
#
# Regenerates .martian files from seed/martians.spec.yaml into a temp directory
# and diffs against the committed seed/martians/*.martian files.
# Exits non-zero on any drift.
#
# Wired into the pnpm test script so CI catches uncommitted spec drift.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMITTED_DIR="$REPO_ROOT/seed/martians"
TMP_DIR="$(mktemp -d)"

cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# Regenerate into temp dir
PYTHONPATH="$REPO_ROOT/src" python3 "$REPO_ROOT/scripts/gen-seed-genomes.py" \
    --output-dir "$TMP_DIR" >/dev/null 2>&1

# Compare committed .martian files against generated ones
DRIFT=0
for committed_file in "$COMMITTED_DIR"/*.martian; do
    name="$(basename "$committed_file")"
    generated_file="$TMP_DIR/$name"
    if [ ! -f "$generated_file" ]; then
        echo "check-seed-drift: MISSING in generated output: $name" >&2
        DRIFT=1
        continue
    fi
    if ! diff -u "$committed_file" "$generated_file" >/dev/null 2>&1; then
        echo "check-seed-drift: DRIFT in $name:" >&2
        diff "$committed_file" "$generated_file" >&2 || true
        DRIFT=1
    fi
done

# Check for extra files in generated output (not in committed)
for generated_file in "$TMP_DIR"/*.martian; do
    name="$(basename "$generated_file")"
    committed_file="$COMMITTED_DIR/$name"
    if [ ! -f "$committed_file" ]; then
        echo "check-seed-drift: EXTRA in generated output (not committed): $name" >&2
        DRIFT=1
    fi
done

if [ "$DRIFT" -eq 0 ]; then
    echo "check-seed-drift: OK — 16/16 seeds reproduce byte-for-byte"
    exit 0
else
    echo "check-seed-drift: DRIFT DETECTED — update seed/martians.spec.yaml to fix" >&2
    exit 1
fi
