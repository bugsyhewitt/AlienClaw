#!/usr/bin/env bash
# Deploy site/ to Hostinger via SSH + rsync.
#
# Required environment variables:
#   ALIENCLAW_DEPLOY_HOST     SSH hostname (Hostinger server)
#   ALIENCLAW_DEPLOY_USER     SSH username
#   ALIENCLAW_DEPLOY_PATH     Remote site root (e.g. ~/domains/alienclaw.net/public_html)
#
# Optional:
#   ALIENCLAW_DEPLOY_PORT     SSH port (default: 22)
#   ALIENCLAW_DEPLOY_SSH_KEY  Path to SSH private key (default: ssh-agent)
#
# Flags:
#   --dry-run    Show what would change without uploading
#   --staging    Upload to a _staging subdirectory (no production swap)
#   --help       Show this message

set -euo pipefail

DRY_RUN=0
STAGING=0

usage() {
  grep '^#' "$0" | sed 's/^# \?//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --staging) STAGING=1 ;;
    --help|-h) usage ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/../site" && pwd)"

# Verify required env vars
: "${ALIENCLAW_DEPLOY_HOST:?ALIENCLAW_DEPLOY_HOST not set — see scripts/README.md}"
: "${ALIENCLAW_DEPLOY_USER:?ALIENCLAW_DEPLOY_USER not set}"
: "${ALIENCLAW_DEPLOY_PATH:?ALIENCLAW_DEPLOY_PATH not set}"
ALIENCLAW_DEPLOY_PORT="${ALIENCLAW_DEPLOY_PORT:-22}"

# Verify site files exist
[ -d "$SITE_DIR" ] || { echo "ERROR: $SITE_DIR not found"; exit 1; }
for F in index.html about.html api.html leaderboard.html donate.html styles.css; do
  [ -f "$SITE_DIR/$F" ] || { echo "ERROR: $SITE_DIR/$F missing"; exit 1; }
done

# Build rsync flags
RSYNC_FLAGS=(-avz --delete-after --human-readable --checksum)
[ "$DRY_RUN" -eq 1 ] && RSYNC_FLAGS+=(--dry-run)

# Build SSH flags
SSH_FLAGS=(-p "$ALIENCLAW_DEPLOY_PORT" -o StrictHostKeyChecking=accept-new)
[ -n "${ALIENCLAW_DEPLOY_SSH_KEY:-}" ] && SSH_FLAGS+=(-i "$ALIENCLAW_DEPLOY_SSH_KEY")

# Determine remote target
if [ "$STAGING" -eq 1 ]; then
  REMOTE_PATH="${ALIENCLAW_DEPLOY_PATH%/}/_staging"
  echo "[deploy] Staging → $ALIENCLAW_DEPLOY_USER@$ALIENCLAW_DEPLOY_HOST:$REMOTE_PATH"
else
  REMOTE_PATH="$ALIENCLAW_DEPLOY_PATH"
  echo "[deploy] Production → $ALIENCLAW_DEPLOY_USER@$ALIENCLAW_DEPLOY_HOST:$REMOTE_PATH"
fi

# Pre-flight: verify SSH connection
echo "[deploy] Checking SSH connection..."
if ! ssh "${SSH_FLAGS[@]}" "$ALIENCLAW_DEPLOY_USER@$ALIENCLAW_DEPLOY_HOST" \
     "echo 'SSH OK: connected'" 2>&1; then
  echo "ERROR: SSH connection failed. Check your env vars and key." >&2
  exit 1
fi

# Pre-deploy remote state
echo "[deploy] Remote contents (pre-deploy):"
ssh "${SSH_FLAGS[@]}" "$ALIENCLAW_DEPLOY_USER@$ALIENCLAW_DEPLOY_HOST" \
  "ls -la \"$REMOTE_PATH\" 2>/dev/null | head -20 || echo '(directory does not exist yet)'"

# Upload
echo "[deploy] Uploading site/ → $REMOTE_PATH ..."
rsync "${RSYNC_FLAGS[@]}" \
  -e "ssh ${SSH_FLAGS[*]}" \
  "$SITE_DIR/" \
  "$ALIENCLAW_DEPLOY_USER@$ALIENCLAW_DEPLOY_HOST:$REMOTE_PATH/"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[deploy] DRY RUN complete — no changes made"
  exit 0
fi

echo "[deploy] Upload complete."

# Post-deploy smoke test (production only)
if [ "$STAGING" -eq 0 ]; then
  echo "[deploy] Smoke testing https://alienclaw.net/ ..."
  sleep 2
  HTTP_CODE=$(curl -sI -L -o /dev/null -w "%{http_code}" \
    --max-time 15 "https://alienclaw.net/" 2>/dev/null || echo "000")
  echo "[deploy] HTTP status: $HTTP_CODE"
  if [ "$HTTP_CODE" = "200" ]; then
    echo "[deploy] ✓ Deploy successful — alienclaw.net is live"
  else
    echo "[deploy] ⚠ Non-200 response ($HTTP_CODE) — verify manually at https://alienclaw.net/"
  fi
fi
