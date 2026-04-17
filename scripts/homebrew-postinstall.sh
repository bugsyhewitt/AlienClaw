#!/usr/bin/env bash
# =============================================================================
# AlienClaw Homebrew Install Script
# Run after: brew install alienclaw
# =============================================================================
set -uo pipefail

OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
ALIENCLAW_HOME="${ALIENCLAW_HOME:-$HOME/.alienclaw}"

echo "==> Running AlienClaw post-brew setup..."

# Check for openclaw
if ! command -v openclaw &>/dev/null; then
  echo "  ✘ openclaw not found. Install it with: npm install -g openclaw"
  exit 1
fi

# Run the install
if command -v install.sh &>/dev/null; then
  bash "$(brew --prefix)/Library/Taps/alientool/homebrew-alienclaw/install.sh"
else
  # Fallback: run the install from the Cellar
  CELLAR="$(brew --prefix)"
  if [ -f "$CELLAR/alienclaw/install.sh" ]; then
    bash "$CELLAR/alienclaw/install.sh"
  else
    echo "  ✘ Could not find install.sh. Please file an issue at https://github.com/AlienTool/AlienClaw"
    exit 1
  fi
fi

echo "==> AlienClaw ready!"
echo ""
echo "  Start chatting: openclaw chat"
echo "  List agents: openclaw agents list"