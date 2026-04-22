#!/usr/bin/env bash
# Thin wrapper: run a pnpm-managed tool with the given arguments.
# Usage: run-node-tool.sh <tool> [args...]
set -euo pipefail
TOOL="$1"; shift
exec pnpm exec "$TOOL" "$@"
