#!/usr/bin/env bash
set -euo pipefail

cd /repo

export ALIENCLAW_STATE_DIR="/tmp/alienclaw-test"
export ALIENCLAW_CONFIG_PATH="${ALIENCLAW_STATE_DIR}/alienclaw.json"

echo "==> Build"
pnpm build

echo "==> Seed state"
mkdir -p "${ALIENCLAW_STATE_DIR}/credentials"
mkdir -p "${ALIENCLAW_STATE_DIR}/agents/main/sessions"
echo '{}' >"${ALIENCLAW_CONFIG_PATH}"
echo 'creds' >"${ALIENCLAW_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${ALIENCLAW_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
pnpm alienclaw reset --scope config+creds+sessions --yes --non-interactive

test ! -f "${ALIENCLAW_CONFIG_PATH}"
test ! -d "${ALIENCLAW_STATE_DIR}/credentials"
test ! -d "${ALIENCLAW_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${ALIENCLAW_STATE_DIR}/credentials"
echo '{}' >"${ALIENCLAW_CONFIG_PATH}"

echo "==> Uninstall (state only)"
pnpm alienclaw uninstall --state --yes --non-interactive

test ! -d "${ALIENCLAW_STATE_DIR}"

echo "OK"
