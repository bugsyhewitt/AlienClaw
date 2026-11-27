#!/usr/bin/env bash
# Run every staged package's test suite plus the drift check.
# On Alfred each suite runs under /tmp/alfred-heavy.lock and only with MemAvailable > 4 GB.
# Usage: bash staging/run-all-tests.sh [package-dir ...]   (default: all)
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
S="$ROOT/staging"
BIN="$ROOT/node_modules/.bin"
LOCK=${ALFRED_HEAVY_LOCK:-/tmp/alfred-heavy.lock}
NEED_KB=$((4 * 1024 * 1024))

heavy() {
  if ! command -v flock >/dev/null 2>&1; then "$@"; return; fi
  local tries=0
  while :; do
    flock -w 3600 "$LOCK" bash -c '
      avail=$(awk "/MemAvailable/{print \$2}" /proc/meminfo 2>/dev/null || echo 99999999)
      [ "$avail" -gt "$0" ] || exit 199
      shift; "$@"' "$NEED_KB" _ "$@"
    local rc=$?
    [ "$rc" -ne 199 ] && return "$rc"
    tries=$((tries + 1))
    [ "$tries" -ge 40 ] && { echo "low memory: gave up" >&2; return 199; }
    echo "MemAvailable <= 4 GB; retrying in 30s" >&2
    sleep 30
  done
}

py() {  # py <pkg-dir> <extra PYTHONPATH entries...>
  local dir="$1"; shift
  local path="$S/$dir/src"
  for extra in "$@"; do path="$path:$S/$extra"; done
  (cd "$S/$dir" && heavy env PYTHONPATH="$path" PYTHONDONTWRITEBYTECODE=1 \
    python3 -m pytest tests -q -p no:cacheprovider)
}

ts() {  # ts <pkg-dir>
  local dir="$1"
  (cd "$ROOT" && heavy "$BIN/tsc" -p "staging/$dir/tsconfig.json" &&
    heavy "$BIN/vitest" run "staging/$dir")
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
    tooltime-bounds)           (cd "$S/tooltime-bounds" && heavy env PYTHONDONTWRITEBYTECODE=1 \
                                 python3 -m pytest tests -q -p no:cacheprovider) ;;
    tools)                     (cd "$ROOT" && heavy env PYTHONDONTWRITEBYTECODE=1 \
                                 python3 -m pytest staging/tools/tests -q -p no:cacheprovider) ;;
    *) echo "unknown package: $1" >&2; return 2 ;;
  esac
}

ALL="agent-tool-sandbox/python agent-tool-sandbox/ts genome-ts ga-engine necromancer-tuners
pho3nix-tuner pho3nix-recon-http tooltime-bounds tools"
[ "$#" -gt 0 ] && ALL="$*"

failed=""
for pkg in $ALL; do
  [ -d "$S/$pkg" ] || [ "$pkg" = tools ] || { echo "skip $pkg (not staged)"; continue; }
  echo "=== $pkg"
  if run_suite "$pkg"; then echo "--- $pkg: PASS"; else echo "--- $pkg: FAIL"; failed="$failed $pkg"; fi
done

echo "=== drift"
if python3 "$S/tools/check_drift.py" --repo "$ROOT"; then echo "--- drift: PASS"
else echo "--- drift: FAIL"; failed="$failed drift"; fi

if [ -n "$failed" ]; then echo "FAILED:$failed"; exit 1; fi
echo "ALL PASS"
