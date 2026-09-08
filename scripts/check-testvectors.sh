#!/usr/bin/env bash
# check-testvectors.sh — Drift gate for genome conformance vectors (T2, PKT-P1).
#
# Usage: bash scripts/check-testvectors.sh
#
# Regenerates the vector file into a temp directory and diffs against the
# committed file. Exits non-zero if there is any drift.
#
# Wired into the pnpm test script so CI catches any uncommitted drift.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURES="$REPO_ROOT/test/fixtures/genome-spec-fixtures.json"
TMP_DIR="$(mktemp -d)"
TMP_FILE="$TMP_DIR/genome-spec-fixtures.json"

cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# Regenerate into temp file
PYTHONPATH="$REPO_ROOT/src" python3 "$REPO_ROOT/scripts/gen-testvectors.py" \
    --output "$TMP_FILE" >/dev/null 2>&1

# Diff
if diff -u "$FIXTURES" "$TMP_FILE" >/dev/null 2>&1; then
    echo "check-testvectors: OK — no drift detected"
    exit 0
else
    echo "check-testvectors: DRIFT DETECTED — committed vectors differ from generated output" >&2
    echo "Run: PYTHONPATH=src python3 scripts/gen-testvectors.py" >&2
    diff "$FIXTURES" "$TMP_FILE" >&2 || true
    exit 1
fi
