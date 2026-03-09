#!/usr/bin/env bash
# installer/scripts/overlay-dist.sh
#
# 1. Copies src/alienclaw/ (our agent system) into build/src/alienclaw/.
# 2. Applies src/openclaw-patches/ on top of build/src/ — patch individual
#    OpenClaw core files without touching vendor/openclaw directly.
# Runs after dist:reskin so the overlay lands on top of the reskinned base.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SRC="$REPO_ROOT/src/alienclaw"
DST="$REPO_ROOT/build/src/alienclaw"
PATCHES_SRC="$REPO_ROOT/src/openclaw-patches"
PATCHES_DST="$REPO_ROOT/build/src"

if [[ ! -d "$SRC" ]]; then
    echo "error: overlay source not found: $SRC" >&2
    exit 1
fi

if [[ ! -d "$REPO_ROOT/build/src" ]]; then
    echo "error: build/src/ not found — run dist:copy and dist:reskin first" >&2
    exit 1
fi

# ── 1. AlienClaw agent overlay ───────────────────────────────────────────────
echo "Overlaying $SRC → $DST ..."
cp -r "$SRC" "$DST"
echo "  alienclaw overlay: $(find "$DST" -type f | wc -l) files"

# ── 2. OpenClaw core patches ─────────────────────────────────────────────────
if [[ -d "$PATCHES_SRC" ]]; then
    echo "Applying core patches $PATCHES_SRC → $PATCHES_DST ..."
    cp -r "$PATCHES_SRC"/. "$PATCHES_DST/"
    echo "  patches applied: $(find "$PATCHES_SRC" -type f | wc -l) files"
else
    echo "  (no core patches directory found — skipping)"
fi

echo "Done."
