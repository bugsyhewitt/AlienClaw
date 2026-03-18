#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Node check ────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "Error: Node.js is not installed." >&2
  echo "Please install Node 22 or later: https://nodejs.org" >&2
  exit 1
fi

NODE_MAJOR="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Error: Node.js 22+ is required (found v$(node --version | tr -d v))." >&2
  echo "Please upgrade: https://nodejs.org" >&2
  exit 1
fi

# ── Step 1: Run OpenClaw's installer ─────────────────────────────────────────
OPENCLAW_INSTALLER="$REPO_DIR/openclaw/scripts/install.sh"
if [ ! -f "$OPENCLAW_INSTALLER" ]; then
  echo "Error: OpenClaw installer not found at $OPENCLAW_INSTALLER" >&2
  exit 1
fi

bash "$OPENCLAW_INSTALLER" || {
  echo "Error: OpenClaw installer failed." >&2
  exit 1
}

# ── Step 2: Abduction animation ───────────────────────────────────────────────
clear
node "$SCRIPT_DIR/animation/abduction.mjs"

# ── Step 3: First-run setup ───────────────────────────────────────────────────
node "$SCRIPT_DIR/setup/first-run.mjs"
