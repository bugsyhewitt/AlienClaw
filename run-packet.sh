#!/usr/bin/env bash
# run-packet.sh — standard launcher for autonomous packet execution
# Usage: ./run-packet.sh packets/packet-NN-short-name.md

set -euo pipefail

PACKET_FILE="${1:-}"

if [[ -z "$PACKET_FILE" ]]; then
  echo "Usage: $0 <packet-file>"
  echo "Example: $0 packets/packet-34-mysql-storage.md"
  exit 1
fi

if [[ ! -f "$PACKET_FILE" ]]; then
  echo "ERROR: packet file not found: $PACKET_FILE"
  exit 1
fi

# Extract packet number and short-name from filename
# packets/packet-34-mysql-storage.md → 34, mysql-storage
PACKET_BASENAME="$(basename "$PACKET_FILE" .md)"
PACKET_NUMBER="$(echo "$PACKET_BASENAME" | sed -E 's/^packet-([0-9.]+)-.*/\1/')"
PACKET_SHORT="$(echo "$PACKET_BASENAME" | sed -E 's/^packet-[0-9.]+-(.*)/\1/')"
BRANCH="packet-${PACKET_NUMBER}-${PACKET_SHORT}"

echo "════════════════════════════════════════════"
echo "  Packet:   $PACKET_NUMBER ($PACKET_SHORT)"
echo "  Branch:   $BRANCH"
echo "  File:     $PACKET_FILE"
echo "════════════════════════════════════════════"

# Pre-flight: working tree must be clean
cd "$(git rev-parse --show-toplevel)"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: working tree dirty. Clean it before running a packet."
  git status --short
  exit 1
fi

# Pre-flight: sync with origin
echo "→ Syncing with origin..."
git fetch origin
git checkout main
git pull --ff-only origin main

# Cut the packet branch
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "ERROR: branch $BRANCH already exists. Delete it or rename the packet."
  exit 1
fi

git checkout -b "$BRANCH"
echo "→ On branch $BRANCH"

# Hand off to Claude Code
echo "→ Launching Claude Code with packet contract..."
echo ""
echo "Claude Code will now execute the packet. When complete it will:"
echo "  1. Have written .packet-reports/packet-${PACKET_NUMBER}-verdict.md"
echo "  2. Have committed work on this branch"
echo "  3. Have pushed and opened a PR via gh"
echo ""
echo "Read the packet contract: .claude-code/packet-contract.md"
echo "Then execute the packet: $PACKET_FILE"
echo ""

# Note: the actual Claude Code invocation is whatever Bugsy normally uses.
# This script preps the branch and surfaces the packet file path.
# The user pastes the packet file content into Claude Code as the prompt.
echo "Packet file path (paste into Claude Code):"
echo "  $(realpath "$PACKET_FILE")"
