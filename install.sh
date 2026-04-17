#!/usr/bin/env bash
# =============================================================================
# AlienClaw Installer — v0.1
# Installs OpenClaw if missing, then provisions 3 agent workspaces
# (BossBot, AdvisorBot, CreatorBot) with routing pre-wired.
#
# Usage:
#   bash install.sh                      # normal install
#   bash install.sh --dry-run            # print actions, make no changes
#   bash install.sh --uninstall          # remove AlienClaw agents (leave OpenClaw)
# =============================================================================
set -uo pipefail

ALIENCLAW_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEED_DIR="$ALIENCLAW_REPO_ROOT/seed/agents"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
AGENTS_ROOT="$OPENCLAW_HOME/agents"
AGENT_IDS=(bossbot advisorbot creatorbot)
TIMESTAMP="$(date +%s)"

DRY_RUN=false
UNINSTALL=false
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=true ;;
    --uninstall)  UNINSTALL=true ;;
    -h|--help)
      sed -n '3,14p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
  esac
done

# Colors
GREEN='\033[38;2;0;255;136m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
info()    { echo -e "  ${GREEN}▸${NC} $*"; }
success() { echo -e "  ${GREEN}✔${NC} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $*"; }
fail()    { echo -e "  ${RED}✘${NC} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}${GREEN}==>${NC}${BOLD} $*${NC}"; }
run() {
  if $DRY_RUN; then echo "  [dry-run] $*"; else eval "$@"; fi
}

# ── Uninstall path ───────────────────────────────────────────────────────────
if $UNINSTALL; then
  step "Uninstalling AlienClaw agents (OpenClaw itself is left alone)"
  for id in "${AGENT_IDS[@]}"; do
    if [ -d "$AGENTS_ROOT/$id" ]; then
      archive="$AGENTS_ROOT/_uninstalled_${id}_${TIMESTAMP}"
      run "mv '$AGENTS_ROOT/$id' '$archive'"
      success "Archived $id → $archive"
    fi
  done
  info "Review $AGENTS_ROOT/_uninstalled_*_${TIMESTAMP} to remove permanently."
  info "You may also want to edit $OPENCLAW_HOME/openclaw.json to clear agents.defaults.agentId."
  exit 0
fi

# ── 1. Check OpenClaw is installed ───────────────────────────────────────────
step "Checking for OpenClaw"
if ! command -v openclaw &>/dev/null; then
  echo ""
  echo -e "  ${RED}✘ OpenClaw is not installed.${NC}"
  echo ""
  echo "  ┌─────────────────────────────────────────────────────────────┐"
  echo "  │  SETUP INSTRUCTIONS                                         │"
  echo "  └─────────────────────────────────────────────────────────────┘"
  echo ""
  echo "  1. Install OpenClaw:"
  echo "     npm install -g openclaw"
  echo ""
  echo "  2. Run the OpenClaw setup wizard:"
  echo "     openclaw configure"
  echo "     (follow the prompts to configure your API keys and preferences)"
  echo ""
  echo "  3. Once OpenClaw is configured, run this installer again:"
  echo "     bash install.sh"
  echo ""
  exit 1
fi
success "OpenClaw found: $(openclaw --version 2>/dev/null || echo 'unknown version')"

# ── 2. Probe OpenClaw's exact workspace layout ───────────────────────────────
step "Probing OpenClaw's agent workspace layout"
PROBE_DIR="$AGENTS_ROOT/_probe_${TIMESTAMP}"
if ! $DRY_RUN; then
  # Use `openclaw setup --workspace` to create a reference workspace.
  # If that subcommand doesn't exist on this OpenClaw version, fall back to
  # creating files at the agent root directly (the documented default layout).
  mkdir -p "$PROBE_DIR"
  if openclaw setup --workspace "$PROBE_DIR" >/dev/null 2>&1; then
    info "Using 'openclaw setup' layout."
  else
    warn "This OpenClaw version lacks 'openclaw setup --workspace'."
    info "Falling back to documented default layout (files at agent root)."
    touch "$PROBE_DIR/.layout-fallback"
  fi
fi

# Determine whether files go at the agent root or under workspace/
LAYOUT_SUBDIR=""
if $DRY_RUN; then
  LAYOUT_SUBDIR=""  # assume root for dry run
elif [ -f "$PROBE_DIR/workspace/SOUL.md" ] || [ -f "$PROBE_DIR/workspace/README.md" ]; then
  LAYOUT_SUBDIR="workspace"
  info "Detected layout: files under <agent>/workspace/"
else
  LAYOUT_SUBDIR=""
  info "Detected layout: files at <agent> root"
fi

run "rm -rf '$PROBE_DIR'"

# ── 3. Archive any pre-existing default workspace ────────────────────────────
step "Archiving any pre-existing default OpenClaw agent"
for candidate in "$OPENCLAW_HOME/workspace" "$AGENTS_ROOT/main"; do
  if [ -d "$candidate" ]; then
    archive="$AGENTS_ROOT/_archived_$(basename "$candidate")_${TIMESTAMP}"
    run "mkdir -p '$AGENTS_ROOT'"
    run "mv '$candidate' '$archive'"
    success "Archived $candidate → $archive (not deleted)"
  fi
done

# ── 4. Provision the three AlienClaw agents ──────────────────────────────────
step "Provisioning AlienClaw agents"
run "mkdir -p '$AGENTS_ROOT'"

for id in "${AGENT_IDS[@]}"; do
  src="$SEED_DIR/$id"
  if [ ! -d "$src" ]; then
    fail "Seed folder not found: $src"
  fi

  target="$AGENTS_ROOT/$id"
  if [ -n "$LAYOUT_SUBDIR" ]; then
    target="$target/$LAYOUT_SUBDIR"
  fi

  if [ -d "$target" ]; then
    warn "Target $target already exists — archiving before overwrite."
    archive="${target%/}_replaced_${TIMESTAMP}"
    run "mv '$target' '$archive'"
  fi

  run "mkdir -p '$target'"
  run "cp -r '$src/'* '$target/'"
  success "Installed agent: $id → $target"
done

# ── 5. Patch openclaw.json to make BossBot the default ───────────────────────
step "Setting BossBot as the default agent"
CFG="$OPENCLAW_HOME/openclaw.json"

if $DRY_RUN; then
  info "[dry-run] Would backup $CFG and set agents.defaults.agentId=bossbot"
else
  if [ -f "$CFG" ]; then
    cp "$CFG" "$CFG.backup-$TIMESTAMP"
    info "Backed up: $CFG → $CFG.backup-$TIMESTAMP"
  fi

  node - <<'NODE_PATCH'
const fs = require('fs');
const os = require('os');
const path = require('path');

const cfgFile = path.join(process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw'), 'openclaw.json');
let cfg = {};
if (fs.existsSync(cfgFile)) {
  try { cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); }
  catch (e) {
    console.error('Could not parse existing openclaw.json. Aborting.');
    process.exit(1);
  }
}

cfg.agents = cfg.agents || {};
cfg.agents.defaults = cfg.agents.defaults || {};

// Set both possible keys for broadest compatibility across OpenClaw versions.
cfg.agents.defaults.agentId = 'bossbot';
cfg.agents.defaults.workspace = path.join(os.homedir(), '.openclaw', 'agents', 'bossbot');

// Remove any legacy `agents.list[]` entries for bossbot/advisorbot/creatorbot —
// in the new model those are per-folder workspaces, not flat config entries.
if (Array.isArray(cfg.agents.list)) {
  const alien = new Set(['bossbot','advisorbot','creatorbot']);
  cfg.agents.list = cfg.agents.list.filter(a => !alien.has(a && a.id));
  if (cfg.agents.list.length === 0) delete cfg.agents.list;
}

fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
console.log('  ✔ openclaw.json updated: agents.defaults.agentId = bossbot');
NODE_PATCH
fi

# ── 6. Verification ──────────────────────────────────────────────────────────
step "Verifying install"

if $DRY_RUN; then
  info "[dry-run] Skipping verification."
else
  # 6a. All three agent folders exist and have all expected files.
  EXPECTED=(SOUL.md IDENTITY.md AGENTS.md USER.md TOOLS.md HEARTBEAT.md MEMORY.md)
  all_ok=true
  for id in "${AGENT_IDS[@]}"; do
    base="$AGENTS_ROOT/$id"
    [ -n "$LAYOUT_SUBDIR" ] && base="$base/$LAYOUT_SUBDIR"
    for f in "${EXPECTED[@]}"; do
      if [ ! -f "$base/$f" ]; then
        warn "Missing: $base/$f"
        all_ok=false
      fi
    done
  done
  $all_ok && success "All 21 expected files present." || fail "File verification failed."

  # 6b. openclaw.json has BossBot as default.
  if grep -q '"agentId": *"bossbot"' "$CFG" 2>/dev/null; then
    success "openclaw.json: BossBot is default agent."
  else
    warn "openclaw.json does not show agentId=bossbot. Inspect $CFG manually."
  fi

  # 6c. `openclaw agents list` (if available) shows the three.
  if openclaw agents list >/tmp/agents-list-$$.txt 2>&1; then
    missing=""
    for id in "${AGENT_IDS[@]}"; do
      grep -q "$id" /tmp/agents-list-$$.txt || missing="$missing $id"
    done
    if [ -z "$missing" ]; then
      success "'openclaw agents list' reports all three agents."
    else
      warn "'openclaw agents list' does not show:$missing"
      warn "Review /tmp/agents-list-$$.txt for details."
    fi
  else
    info "'openclaw agents list' not available on this version — skipping."
  fi
  rm -f /tmp/agents-list-$$.txt
fi

# ── 7. Done ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}  👽  ALIENCLAW INSTALLED${NC}"
echo -e "${BOLD}${GREEN}  ═══════════════════════════════════════${NC}"
echo -e "  Default agent : ${BOLD}BossBot${NC}"
echo -e "  Peers         : AdvisorBot (🧠), CreatorBot (🔧)"
echo -e "  Agents root   : ${DIM}$AGENTS_ROOT${NC}"
echo ""
echo -e "  Start a chat   : ${BOLD}openclaw chat${NC}   (BossBot answers)"
echo -e "  List agents    : ${BOLD}openclaw agents list${NC}"
echo -e "  Uninstall      : ${BOLD}bash install.sh --uninstall${NC}"
echo ""
