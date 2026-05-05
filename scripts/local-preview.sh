#!/usr/bin/env bash
# Serve site/ locally on http://localhost:8000 for visual review before deploy.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/../site" && pwd)"
PORT="${1:-8000}"
echo "Serving $SITE_DIR on http://localhost:$PORT"
echo "Ctrl-C to stop."
exec python3 -m http.server "$PORT" --directory "$SITE_DIR"
