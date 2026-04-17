#!/usr/bin/env bash
# installer/scripts/overlay-dist.sh
#
# Copies AlienClaw agent system + installer into the build directory.
# No OpenClaw source is patched — OpenClaw installs normally.
#
# 1. Copies src/alienclaw/ (agent system) into build/src/alienclaw/
# 2. Copies installer/ into build/installer/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SRC="$REPO_ROOT/src/alienclaw"
DST="$REPO_ROOT/build/src/alienclaw"

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

# ── 3. AlienClaw node_modules (for tsx + TypeScript runtime) ──────────────
# Copy node_modules from the build so the alienclaw CLI can run without
# needing its own separate npm install.
NODE_MODULES_SRC="$REPO_ROOT/build/node_modules"
NODE_MODULES_DST="$REPO_ROOT/build/src-alienclaw-node_modules"
if [[ -d "$NODE_MODULES_SRC" ]]; then
    echo "Copying node_modules for AlienClaw runtime..."
    cp -r "$NODE_MODULES_SRC" "$NODE_MODULES_DST"
    echo "  node_modules: $(find "$NODE_MODULES_DST" -type f | wc -l) files"
fi

# ── 4. AlienClaw installer (wizard, animation, setup) ─────────────────────
INSTALLER_DST="$REPO_ROOT/build/installer"
echo "Copying installer → $INSTALLER_DST ..."
rm -rf "$INSTALLER_DST"
cp -r "$REPO_ROOT/installer" "$INSTALLER_DST"
echo "  installer: $(find "$INSTALLER_DST" -type f | wc -l) files"

echo "Done."
