#!/usr/bin/env bash
# Build the Hostinger deploy artifact for api.alienclaw.net.
# Pre-compiles TypeScript with esbuild (no runtime tsx/esbuild — bug #15 fix).
# Uses corrected server.js with no top-level await (bug #16 fix).
# Output: /tmp/alienclaw-deploy.zip (~8KB, no node_modules)
#
# Usage: bash scripts/build-deploy.sh
# Then upload /tmp/alienclaw-deploy.zip via Hostinger hPanel Node.js Apps.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT=/tmp/alienclaw-deploy-build
ZIP=/tmp/alienclaw-deploy.zip

echo "Building deploy artifact from $REPO_ROOT..."

rm -rf "$OUT"
mkdir -p "$OUT/dist"

# Bundle the TypeScript API entry point.
# mysql2 and fsevents are excluded — Hostinger installs them from package.json.
npx esbuild "$REPO_ROOT/src/alienclaw/api/main.ts" \
  --bundle \
  --platform=node \
  --format=esm \
  --target=node22 \
  --outfile="$OUT/dist/main.js" \
  --external:mysql2 \
  --external:fsevents

# Copy entry file and minimal package.json.
cp "$REPO_ROOT/server.js" "$OUT/server.js"
cat > "$OUT/package.json" <<'JSON'
{
  "name": "alienclaw",
  "version": "2026.4.10",
  "private": true,
  "type": "module",
  "scripts": { "start": "node server.js" },
  "dependencies": { "mysql2": "^3.22.3" }
}
JSON

# Guard: fail loudly if server.js has top-level await (bug #16 prevention).
# An `await` at column 0 or after only whitespace at the start of a line is top-level.
if grep -qE '^\s*await ' "$OUT/server.js"; then
  echo "ERROR: top-level await detected in server.js — would crash LiteSpeed (bug #16)." >&2
  echo "       Fix: wrap startup in an async function or use import().catch()." >&2
  exit 1
fi

# Build zip with python3 (portable, no zip binary required).
python3 - "$OUT" "$ZIP" <<'PYEOF'
import sys, zipfile, os
out, zippath = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(zippath, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(out):
        dirs[:] = [d for d in dirs if d not in ('node_modules', '.git')]
        for f in files:
            fullpath = os.path.join(root, f)
            arcname = os.path.relpath(fullpath, out)
            if not arcname.startswith('.env'):
                z.write(fullpath, arcname)
PYEOF

SIZE=$(python3 -c "import os; print(os.path.getsize('$ZIP'))")
echo "Built $ZIP ($SIZE bytes)"
echo "Files in zip:"
python3 -c "import zipfile; [print('  ', i.filename, i.file_size) for i in zipfile.ZipFile('$ZIP').infolist()]"
echo ""
echo "Next step: upload $ZIP via Hostinger hPanel → Node.js Apps → Deploy → Upload zip"
