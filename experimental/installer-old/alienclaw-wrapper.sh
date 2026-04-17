#!/usr/bin/env bash
# ~/.alienclaw/bin/alienclaw — AlienClaw wrapper
# "alienclaw run <goal>" → BossBot governance loop
# Everything else → OpenClaw

ALIENCLAW_HOME="${ALIENCLAW_HOME:-$HOME/.alienclaw}"
ALIENCLAW_CLI="$ALIENCLAW_HOME/src-alienclaw/cli/alienclaw.mjs"
TSX_BIN="$ALIENCLAW_HOME/node_modules/.bin/tsx"

case "${1:-}" in
  run)
    shift
    if [[ -f "$TSX_BIN" ]]; then
      exec node "$TSX_BIN" "$ALIENCLAW_CLI" "$@"
    else
      exec node "$ALIENCLAW_CLI" "$@"
    fi
    ;;
  *)
    exec openclaw "$@"
    ;;
esac
