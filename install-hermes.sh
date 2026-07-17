#!/usr/bin/env bash
# =============================================================================
# AlienClaw Installer — Hermes host (v0.1)
# Parallel of install.sh for the NousResearch Hermes Agent host.
# Provisions the 3 AlienClaw agents (BossBot, AdvisorBot, CreatorBot) as Hermes
# PROFILES under ~/.hermes/profiles/ from seed/agents-hermes/.
#
# Hermes' multi-agent unit is the PROFILE (each is its own ~/.hermes/profiles/<name>/
# home). Provisioning uses `hermes profile create <name> --no-alias --description
# "<role>"` (no ~/.local/bin wrapper; state stays under HERMES_HOME) + overlays
# AlienClaw's SOUL.md/AGENTS.md, then `hermes profile use bossbot`. Hermes has NO
# `delegation` config section and NO typed consult-frequency key; routing is by the
# profile description its orchestrator reads. Validated vs hermes-agent v0.15.2.
# See docs/hermes-phase2-spec.md.
#
# When `hermes` is absent, provisioning falls back to plain workspace dirs. Never
# writes `agentId`. Backs up config before any hermes write. Idempotent (skips
# existing profiles). bash 3.2 compatible.
#
# Usage:
#   bash install-hermes.sh                 # provision workspaces (config wiring = TODO)
#   bash install-hermes.sh --dry-run       # print actions, make no changes
#   bash install-hermes.sh --uninstall     # archive AlienClaw agents (leave Hermes)
#   bash install-hermes.sh --from-openclaw # import an existing ~/.openclaw via `hermes claw migrate`
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

# One- or two-sentence profile description (fed to Hermes' orchestrator routing).
agent_desc() {
  case "$1" in
    bossbot)    printf '%s' "AlienClaw executive; consults AdvisorBot before non-trivial decisions" ;;
    advisorbot) printf '%s' "AlienClaw advisory endpoint; planning, triage, completion review" ;;
    creatorbot) printf '%s' "AlienClaw builder; turns campaign schemes into Subagents" ;;
    *)          printf '%s' "AlienClaw agent" ;;
  esac
}

HAVE_HERMES=false
command -v hermes >/dev/null 2>&1 && HAVE_HERMES=true

# --- Uninstall ---------------------------------------------------------------
if $UNINSTALL; then
  info "Uninstalling AlienClaw agent profiles (leaving Hermes intact)"
  for id in $AGENT_IDS; do
    target="$PROFILES_ROOT/$id"
    [ -d "$target" ] || continue
    if $HAVE_HERMES; then
      # `delete -y` removes the profile (and its alias wrapper, if any) non-interactively.
      run hermes profile delete "$id" -y
      info "Deleted profile: $id"
    else
      run mv "$target" "$target.removed-$TIMESTAMP"
      info "Archived: $target -> $target.removed-$TIMESTAMP"
    fi
  done
  info "Done. Hermes config untouched."
  exit 0
fi

# --- Preflight: Python + hermes ----------------------------------------------
info "Preflight: checking Python and hermes ..."
if ! command -v python3 >/dev/null 2>&1; then
  info "ERROR: python3 not found. Hermes is Python-native; install Python 3.12+ first."
  exit 1
fi
if ! command -v hermes >/dev/null 2>&1; then
  info "NOTE: 'hermes' CLI not found. Install Hermes Agent first, e.g.:"
  info "      pip install hermes-agent                                   # PyPI package"
  info "      # or the official installer: curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash"
  info "      TODO(hermes): pin a known-good hermes-agent version, then gate on 'hermes --version' here."
fi

# --- Config: back up before any hermes write (profile use may touch root config) ---
if [ -f "$CONFIG_FILE" ]; then
  run cp "$CONFIG_FILE" "$CONFIG_FILE.backup-$TIMESTAMP"
  info "Backed up: $CONFIG_FILE -> $CONFIG_FILE.backup-$TIMESTAMP"
fi

# --- Optional: import an existing OpenClaw setup (before provisioning) --------
# `hermes claw migrate` flattens OpenClaw state into ONE profile; the 3-profile
# split is re-applied by provisioning below. Secrets are NOT migrated (no
# --migrate-secrets) — re-add API keys yourself. `hermes claw migrate` takes its
# own pre-migration ~/.hermes snapshot unless --no-backup.
if $FROM_OPENCLAW; then
  if $HAVE_HERMES; then
    OPENCLAW_SRC="${OPENCLAW_HOME:-$HOME/.openclaw}"
    if [ -d "$OPENCLAW_SRC" ]; then
      info "Importing OpenClaw setup from $OPENCLAW_SRC via 'hermes claw migrate' ..."
      if $DRY_RUN; then
        run hermes claw migrate --source "$OPENCLAW_SRC" --preset full --dry-run --yes
      else
        run hermes claw migrate --source "$OPENCLAW_SRC" --preset full --yes
      fi
      info "Imported (secrets excluded); the 3-profile split is re-applied below."
    else
      info "--from-openclaw: no OpenClaw dir at $OPENCLAW_SRC — skipping import."
    fi
  else
    info "--from-openclaw needs the hermes CLI; install Hermes first."
  fi
fi

# --- Provision the 3 agents as Hermes profiles -------------------------------
# Real profiles when hermes is present (`hermes profile create --no-alias` — no
# ~/.local/bin wrapper, all state under HERMES_HOME); otherwise a plain workspace
# dir. AlienClaw's persona/routing files are overlaid onto the profile either way.
info "Provisioning agent profiles under $PROFILES_ROOT ..."
run mkdir -p "$PROFILES_ROOT"
for id in $AGENT_IDS; do
  src="$SEED_DIR/$id"
  target="$PROFILES_ROOT/$id"
  if $HAVE_HERMES; then
    if [ -d "$target" ]; then
      info "Profile '$id' already exists — skipping create (idempotent)."
    else
      run hermes profile create "$id" --no-alias --description "$(agent_desc "$id")"
      info "Created Hermes profile: $id"
    fi
  else
    run mkdir -p "$target"
    info "No hermes CLI — created workspace dir only: $target"
  fi
  # Overlay AlienClaw's persona (SOUL.md) + routing/tooling docs onto the profile.
  for f in SOUL.md AGENTS.md TOOLS.md HEARTBEAT.md MEMORY.md; do
    [ -f "$src/$f" ] && run cp "$src/$f" "$target/$f"
  done
  info "Applied AlienClaw workspace files to $id"
done

# Set BossBot as the active profile (Hermes has no `agent.default`; `profile use` is the mechanism).
if $HAVE_HERMES; then
  run hermes profile use bossbot
  info "Active profile set to bossbot."
fi
info "BossBot's high-frequency AdvisorBot consult is behavioral PROSE in SOUL.md rule 2"
info "(no Hermes config key enforces consult frequency; routing is by profile description)."

info "Provisioning complete."
