#!/usr/bin/env bash
# Run a command with no network except loopback (Linux user + network namespace), so a
# test that silently needs the internet fails instead of passing. Where namespaces are
# unavailable it runs the command directly, unless OFFLINE_REQUIRED=1.
# Usage: staging/tools/offline.sh <cmd> [args...]
set -u
if unshare -rn true 2>/dev/null; then
  exec unshare -rn bash -c 'ip link set lo up 2>/dev/null || true; exec "$@"' _ "$@"
fi
if [ "${OFFLINE_REQUIRED:-0}" = 1 ]; then
  echo "offline.sh: user/network namespaces unavailable and OFFLINE_REQUIRED=1" >&2
  exit 197
fi
echo "offline.sh: namespaces unavailable; running WITH network" >&2
exec "$@"
