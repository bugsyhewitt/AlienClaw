#!/usr/bin/env bash
# =============================================================================
# AlienClaw Installer — Hermes host (SCAFFOLD, v0.1)
# Parallel of install.sh for the NousResearch Hermes Agent host.
# Provisions the 3 agent workspaces (BossBot, AdvisorBot, CreatorBot) into
# ~/.hermes/agents/ from seed/agents-hermes/.
#
# SCAFFOLD SCOPE: workspace provisioning + config backup are live; the Hermes
# `delegation`/model wiring (hermes config set ...) is printed as TODO, pending
# the live Hermes integration phase. Never writes `agentId`. Backs up config
# before any write. bash 3.2 compatible.
#
# Usage:
#   bash install-hermes.sh                 # provision workspaces (config wiring = TODO)
#   bash install-hermes.sh --dry-run       # print actions, make no changes
#   bash install-hermes.sh --uninstall     # archive AlienClaw agents (leave Hermes)
#   bash install-hermes.sh --from-openclaw # (TODO) import via `hermes claw migrate`
# =============================================================================
set -uo pipefail

ALIENCLAW_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEED_DIR="$ALIENCLAW_REPO_ROOT/seed/agents-hermes"

if [ ! -d "$SEED_DIR" ]; then
  echo "  ERROR: Hermes seed files not found at $SEED_DIR"
  echo "  Run from a full AlienClaw checkout, not a standalone download."
  exit 1
fi

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
AGENTS_ROOT="$HERMES_HOME/agents"
CONFIG_FILE="$HERMES_HOME/config.yaml"
AGENT_IDS="bossbot advisorbot creatorbot"
TIMESTAMP="$(date +%s)"
DRY_RUN=false
UNINSTALL=false
FROM_OPENCLAW=false

for arg in "$@"; do
  case "$arg" in
    --dry-run|-n)    DRY_RUN=true ;;
    --uninstall)     UNINSTALL=true ;;
    --from-openclaw) FROM_OPENCLAW=true ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "  Unknown argument: $arg (try --help)"; exit 2 ;;
  esac
done

# run CMD...  — execute unless --dry-run (no eval; args passed through)
run() {
  if $DRY_RUN; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}

info() { echo "  $*"; }

# --- Uninstall ---------------------------------------------------------------
if $UNINSTALL; then
  info "Uninstalling AlienClaw agents from $AGENTS_ROOT (leaving Hermes intact)"
  for id in $AGENT_IDS; do
    target="$AGENTS_ROOT/$id"
    if [ -d "$target" ]; then
      run mv "$target" "$target.removed-$TIMESTAMP"
      info "Archived: $target -> $target.removed-$TIMESTAMP"
    fi
  done
  info "Done. Hermes config untouched."
  exit 0
fi

# --- Preflight: Python + uv + hermes -----------------------------------------
info "Preflight: checking Python, uv, and hermes ..."
if ! command -v python3 >/dev/null 2>&1; then
  info "ERROR: python3 not found. Hermes is Python-native; install Python 3.12+ first."
  exit 1
fi
if ! command -v uv >/dev/null 2>&1; then
  info "NOTE: 'uv' not found. Hermes installs via 'uv pip install -e'."
  info "      TODO(hermes): install uv, then pin a known-good hermes-agent version."
fi
if ! command -v hermes >/dev/null 2>&1; then
  info "NOTE: 'hermes' CLI not found."
  info "      TODO(hermes): install Hermes Agent (github.com/NousResearch/hermes-agent),"
  info "      pin a version, and gate on 'hermes --version' here."
fi

# --- Provision agent workspaces (host-agnostic file copy — safe now) ---------
info "Provisioning agent workspaces into $AGENTS_ROOT ..."
run mkdir -p "$AGENTS_ROOT"
for id in $AGENT_IDS; do
  src="$SEED_DIR/$id"
  target="$AGENTS_ROOT/$id"
  run mkdir -p "$target"
  for f in SOUL.md AGENTS.md TOOLS.md HEARTBEAT.md MEMORY.md; do
    if [ -f "$src/$f" ]; then
      run cp "$src/$f" "$target/$f"
    fi
  done
  info "Provisioned: $id -> $target"
done

# --- Config: back up before any write, then wire delegation (TODO) -----------
if [ -f "$CONFIG_FILE" ]; then
  run cp "$CONFIG_FILE" "$CONFIG_FILE.backup-$TIMESTAMP"
  info "Backed up: $CONFIG_FILE -> $CONFIG_FILE.backup-$TIMESTAMP"
else
  info "No existing $CONFIG_FILE (fresh Hermes); nothing to back up."
fi

info "TODO(hermes): wire routing via 'hermes config set' (never write agentId):"
info "    hermes config set agent.default bossbot"
info "    hermes config set delegation.peers.advisorbot.frequency high   # BossBot consults AdvisorBot often"
info "    hermes config set delegation.peers.creatorbot.frequency medium"
info "    hermes config set model.default <model>   # or defer to 'hermes setup'"

if $FROM_OPENCLAW; then
  info "TODO(hermes): --from-openclaw import path:"
  info "    hermes claw migrate --preset full        # then re-apply the Hermes routing/tool variant"
fi

info "Scaffold provisioning complete. Live Hermes config wiring is deferred (see TODOs above)."
