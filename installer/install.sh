#!/usr/bin/env bash
# Canonical installer lives at repo root: install.sh
# This is a convenience copy. Keep in sync.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/../install.sh" "$@"
