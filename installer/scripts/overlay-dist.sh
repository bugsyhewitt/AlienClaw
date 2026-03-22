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
    echo "error: build/src/ not found — run dist:copy first" >&2
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

# ── 3. AlienClaw installer (wizard, animation, setup) ────────────────────────
INSTALLER_DST="$REPO_ROOT/build/installer"
echo "Copying installer → $INSTALLER_DST ..."
rm -rf "$INSTALLER_DST"
cp -r "$REPO_ROOT/installer" "$INSTALLER_DST"
echo "  installer: $(find "$INSTALLER_DST" -type f | wc -l) files"

# ── 4. Custom entry point (first-run gate + correct branding) ─────────────────
# Overwrites OpenClaw's openclaw.mjs with our wrapper that checks setup first.
# We keep the original filename (openclaw.mjs) — no reskin needed.
ENTRY_SRC="$REPO_ROOT/installer/alienclaw-entry.mjs"
ENTRY_DST="$REPO_ROOT/build/openclaw.mjs"
echo "Installing custom entry point → openclaw.mjs ..."
cp "$ENTRY_SRC" "$ENTRY_DST"

echo "Done."
