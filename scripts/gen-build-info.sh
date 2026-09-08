#!/usr/bin/env bash
# gen-build-info.sh — write build-info.json at the repo root.
#
# Writes:  { "sha": "<git-sha>", "builtAt": "<UTC ISO-8601>" }
# Called by:  pnpm build-info   (on-demand)
#             pnpm prestart     (automatically before pnpm start)
#
# Compatible with bash 3.2+ (macOS default), Linux, and WSL2.
# Falls back sha to "unknown" when run outside a git checkout.

set -euo pipefail

# Resolve the repo root (the directory that contains this script's parent).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Capture the current HEAD sha, gracefully handling non-git environments.
if sha=$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null); then
  : # sha is set
else
  sha="unknown"
fi

# UTC ISO-8601 timestamp — date(1) on both GNU and BSD (macOS) supports -u.
built_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

out="${REPO_ROOT}/build-info.json"
printf '{"sha":"%s","builtAt":"%s"}\n' "${sha}" "${built_at}" > "${out}"

echo "[gen-build-info] wrote ${out}  sha=${sha}  builtAt=${built_at}" >&2
