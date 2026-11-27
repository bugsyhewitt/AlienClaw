#!/usr/bin/env bash
# Run a heavy command (test suite, build) under Alfred's shared lock, and only while
# MemAvailable is above a floor (default 4 GB). Without flock, it just runs the command.
# Usage: staging/tools/heavy.sh <cmd> [args...]
# Env: ALFRED_HEAVY_LOCK (default /tmp/alfred-heavy.lock), HEAVY_NEED_KB (default 4194304).
set -u
LOCK=${ALFRED_HEAVY_LOCK:-/tmp/alfred-heavy.lock}
NEED_KB=${HEAVY_NEED_KB:-$((4 * 1024 * 1024))}

command -v flock >/dev/null 2>&1 || exec "$@"

for _ in $(seq 1 40); do
  flock -w 3600 "$LOCK" bash -c '
    avail=$(awk "/MemAvailable/{print \$2}" /proc/meminfo 2>/dev/null || echo 999999999)
    if [ "$avail" -le "$0" ]; then
      echo "heavy.sh: MemAvailable ${avail}kB <= ${0}kB, backing off" >&2
      exit 199
    fi
    shift
    "$@"
  ' "$NEED_KB" _ "$@"
  rc=$?
  [ "$rc" -ne 199 ] && exit "$rc"
  sleep 30
done
echo "heavy.sh: gave up after 40 low-memory attempts" >&2
exit 199
