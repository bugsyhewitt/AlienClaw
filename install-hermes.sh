#!/usr/bin/env bash
# =============================================================================
# AlienClaw Installer — Hermes host (SCAFFOLD, v0.1)
# Parallel of install.sh for the NousResearch Hermes Agent host.
# Provisions the 3 AlienClaw agents (BossBot, AdvisorBot, CreatorBot) as Hermes
# PROFILES under ~/.hermes/profiles/ from seed/agents-hermes/.
#
# Hermes' multi-agent unit is the PROFILE (each is its own ~/.hermes/profiles/<name>/
# home). Real provisioning uses `hermes profile create <name> --description "<role>"`
# and `hermes profile use bossbot` — Hermes has NO `delegation` config section and
# NO typed consult-frequency key; routing is by the profile description that its
# orchestrator reads. See docs/hermes-phase2-spec.md.
#
# SCAFFOLD SCOPE: file provisioning + config backup are live; real profile creation
# via the `hermes` CLI (item 6) needs a live Hermes and is printed as TODO. Never
# writes `agentId`. Backs up config before any write. bash 3.2 compatible.
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
# Hermes stores named profiles under ~/.hermes/profiles/<name>/ (confirmed via
# `hermes profile show`). This is where AlienClaw's 3 agent profiles live.
PROFILES_ROOT="$HERMES_HOME/profiles"
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
  info "Uninstalling AlienClaw agents from $PROFILES_ROOT (leaving Hermes intact)"
  for id in $AGENT_IDS; do
    target="$PROFILES_ROOT/$id"
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
info "Provisioning agent workspaces into $PROFILES_ROOT ..."
run mkdir -p "$PROFILES_ROOT"
for id in $AGENT_IDS; do
  src="$SEED_DIR/$id"
  target="$PROFILES_ROOT/$id"
  run mkdir -p "$target"
  for f in SOUL.md AGENTS.md TOOLS.md HEARTBEAT.md MEMORY.md; do
    if [ -f "$src/$f" ]; then
      run cp "$src/$f" "$target/$f"
    fi
  done
  info "Provisioned: $id -> $target"
done

# --- Config: back up before any write, then create profiles (TODO) -----------
if [ -f "$CONFIG_FILE" ]; then
  run cp "$CONFIG_FILE" "$CONFIG_FILE.backup-$TIMESTAMP"
  info "Backed up: $CONFIG_FILE -> $CONFIG_FILE.backup-$TIMESTAMP"
else
  info "No existing $CONFIG_FILE (fresh Hermes); nothing to back up."
fi

info "TODO(hermes, item 6 — needs live Hermes): create each agent as a profile and"
info "route via profile descriptions (Hermes has NO 'delegation' section / agentId):"
info "    hermes profile create bossbot    --description 'AlienClaw executive; consults AdvisorBot before non-trivial decisions'"
info "    hermes profile create advisorbot --description 'AlienClaw advisory endpoint; planning, triage, completion review'"
info "    hermes profile create creatorbot --description 'AlienClaw builder; turns campaign schemes into Subagents'"
info "    hermes profile use bossbot                              # set active profile"
info "    <profile> config set model.default <model>              # per-profile, or defer to 'hermes setup'"
info "BossBot's high-frequency AdvisorBot consult is behavioral PROSE in SOUL.md rule 2"
info "(no Hermes config key enforces consult frequency)."

if $FROM_OPENCLAW; then
  info "TODO(hermes, item 9 — needs live Hermes): --from-openclaw import path:"
  info "    hermes claw migrate --preset full   # NOTE: flattens the 3-agent topology into one"
  info "                                        # profile; re-apply the 3-profile split afterward."
fi

info "Scaffold provisioning complete. Live Hermes config wiring is deferred (see TODOs above)."
