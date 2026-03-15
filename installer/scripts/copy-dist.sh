#!/usr/bin/env bash
# installer/scripts/copy-dist.sh
#
# Wipes build/ and replaces it with a fresh copy of openclaw/ (the vendor).
# Called by pnpm dist:copy. Uses absolute paths to avoid Windows shell ambiguity.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SRC="$REPO_ROOT/openclaw"
DST="$REPO_ROOT/build"

if [[ ! -d "$SRC" ]]; then
    echo "error: vendor source not found: $SRC" >&2
    exit 1
fi

# Remove existing build/ — try multiple methods for Windows compatibility
if [[ -e "$DST" ]]; then
    echo "Removing existing $DST ..."
    rm -rf "$DST" 2>/dev/null \
        || (cmd //c "rmdir /s /q \"$(cygpath -w "$DST")\"" 2>/dev/null) \
        || { echo "error: could not remove $DST" >&2; exit 1; }
fi

echo "Copying $SRC → $DST ..."
cp -r "$SRC" "$DST"

echo "Done — $(find "$DST" -type f | wc -l) files copied."
