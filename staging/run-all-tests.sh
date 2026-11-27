#!/usr/bin/env bash
# Run every staged package's test suite plus the drift check.
# Each suite runs through staging/tools/heavy.sh (Alfred's shared lock + RAM floor) and
# staging/tools/offline.sh (loopback-only network namespace where available).
# Usage: bash staging/run-all-tests.sh [package-dir ...]   (default: all)
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
S="$ROOT/staging"
BIN="$ROOT/node_modules/.bin"
HEAVY="$S/tools/heavy.sh"
OFFLINE="$S/tools/offline.sh"

py() {  # py <pkg-dir> [extra PYTHONPATH dirs under staging/ ...]
  local dir="$1"; shift
  local path="$S/$dir/src"
  for extra in "$@"; do path="$path:$S/$extra"; done
  (cd "$S/$dir" && bash "$HEAVY" bash "$OFFLINE" env PYTHONPATH="$path" \
    PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests -q -p no:cacheprovider)
}

ts() {  # ts <pkg-dir>: typecheck + tests under one lock hold
  (cd "$ROOT" && bash "$HEAVY" bash "$OFFLINE" bash -c '"$0/tsc" -p "staging/$1/tsconfig.json" &&
    "$0/vitest" run "staging/$1"' "$BIN" "$1")
}

run_suite() {
  case "$1" in
    agent-tool-sandbox/python) py agent-tool-sandbox/python ;;
    agent-tool-sandbox/ts)     ts agent-tool-sandbox/ts ;;
    genome-ts)                 ts genome-ts ;;
    ga-engine)                 py ga-engine ;;
    necromancer-tuners)        py necromancer-tuners ga-engine/src ;;
    pho3nix-tuner)             py pho3nix-tuner ga-engine/src ;;
    pho3nix-recon-http)        py pho3nix-recon-http agent-tool-sandbox/python/src ;;
    tooltime-bounds)           py tooltime-bounds ;;
    tools)                     py tools ;;
    *) echo "unknown package: $1" >&2; return 2 ;;
  esac
}

ALL="agent-tool-sandbox/python agent-tool-sandbox/ts genome-ts ga-engine necromancer-tuners
pho3nix-tuner pho3nix-recon-http tooltime-bounds tools"
[ "$#" -gt 0 ] && ALL="$*"

failed=""
for pkg in $ALL; do
  [ -d "$S/$pkg" ] || { echo "skip $pkg (not staged)"; continue; }
  echo "=== $pkg"
  if run_suite "$pkg"; then echo "--- $pkg: PASS"; else echo "--- $pkg: FAIL"; failed="$failed $pkg"; fi
done

echo "=== drift"
if python3 "$S/tools/check_drift.py" --repo "$ROOT"; then echo "--- drift: PASS"
else echo "--- drift: FAIL"; failed="$failed drift"; fi

if [ -n "$failed" ]; then echo "FAILED:$failed"; exit 1; fi
echo "ALL PASS"
