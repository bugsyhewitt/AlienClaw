#!/usr/bin/env bash
# =============================================================================
# AlienClaw Installer
# Installs OpenClaw via npm, then layers AlienClaw agent system on top.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/AlienTool/AlienClaw/main/install.sh | bash
#   bash install.sh              # Local install
#   bash install.sh --dryrun     # Preview all steps without making changes
# =============================================================================
set -uo pipefail

ALIENCLAW_REPO="https://github.com/AlienTool/AlienClaw.git"
ALIENCLAW_HOME="${ALIENCLAW_HOME:-$HOME/.alienclaw}"
TMPDIR_AC=""

# Dry-run flag
DRYRUN=false
for arg in "$@"; do
  case "$arg" in -dryrun|--dryrun) DRYRUN=true ;; esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[38;2;0;255;136m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# Helpers
info()    { echo -e "  ${GREEN}▸${NC} $*"; }
success() { echo -e "  ${GREEN}✔${NC} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $*"; }
fail()    { echo -e "  ${RED}✘${NC} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}${BLUE}==>${NC}${BOLD} $*${NC}"; }

cleanup() {
  if [[ -n "${TMPDIR_AC:-}" && -d "${TMPDIR_AC:-}" ]]; then
    rm -rf "$TMPDIR_AC" &>/dev/null &
    TMPDIR_AC=""
  fi
  printf '%b' '\033[?25h\033[0m'
}
trap cleanup EXIT
trap 'echo ""; echo -e "\n  ${RED}Aborted.${NC}"; exit 1' INT TERM

# =============================================================================
# Platform detection
# =============================================================================
OS=""
PKG_MANAGER=""

detect_os() {
  case "$(uname -s)" in
    Linux)
      OS="linux"
      if   command -v apt-get &>/dev/null; then PKG_MANAGER="apt"
      elif command -v dnf     &>/dev/null; then PKG_MANAGER="dnf"
      elif command -v yum     &>/dev/null; then PKG_MANAGER="yum"
      elif command -v pacman  &>/dev/null; then PKG_MANAGER="pacman"
      elif command -v zypper  &>/dev/null; then PKG_MANAGER="zypper"
      else fail "No supported package manager found."; fi
      ;;
    Darwin)
      OS="macos"
      PKG_MANAGER="brew"
      ;;
    *)
      fail "Unsupported OS: $(uname -s). AlienClaw supports macOS, Linux, and WSL2."
      ;;
  esac
  info "Platform: ${OS} (${PKG_MANAGER})"
}

# =============================================================================
# Package install
# =============================================================================
pkg_install() {
  local pkg="$1"
  case "$PKG_MANAGER" in
    apt)    sudo apt-get install -y "$pkg" </dev/null ;;
    dnf)    sudo dnf install -y "$pkg"     </dev/null ;;
    yum)    sudo yum install -y "$pkg"     </dev/null ;;
    pacman) sudo pacman -S --noconfirm "$pkg" </dev/null ;;
    zypper) sudo zypper install -y "$pkg"  </dev/null ;;
    brew)   brew install "$pkg" </dev/null ;;
  esac
}

apt_update_once() {
  if [[ "$PKG_MANAGER" == "apt" && "${APT_UPDATED:-0}" != "1" ]]; then
    info "Updating package lists..."
    sudo apt-get update -qq </dev/null || warn "apt-get update had warnings (continuing)."
    APT_UPDATED=1
  fi
}

require_cmd() {
  local cmd="$1" pkg="${2:-$1}"
  if command -v "$cmd" &>/dev/null; then
    success "$cmd found"
    return 0
  fi
  info "Installing $cmd..."
  if $DRYRUN; then info "[DRYRUN] Would install $pkg"; return 0; fi
  apt_update_once
  if pkg_install "$pkg"; then
    hash -r 2>/dev/null || true
    if command -v "$cmd" &>/dev/null; then
      success "$cmd installed"
      return 0
    fi
  fi
  fail "$cmd could not be installed."
}

# =============================================================================
# Node.js 22+
# =============================================================================
ensure_node() {
  if command -v node &>/dev/null; then
    local major
    major=$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null || echo "0")
    if [[ "$major" -ge 22 ]]; then
      success "Node.js $(node --version)"
      return 0
    fi
    info "Node.js $(node --version) found but v22+ required. Upgrading..."
  else
    info "Node.js not found. Installing..."
  fi

  if $DRYRUN; then info "[DRYRUN] Would install Node.js 22"; return 0; fi

  if [[ "$PKG_MANAGER" == "apt" ]]; then
    local ns_tmp="$(mktemp)"
    curl -fsSL https://deb.nodesource.com/setup_22.x -o "$ns_tmp" || fail "Could not download NodeSource setup."
    sudo -E bash "$ns_tmp" </dev/null || fail "NodeSource setup failed."
    rm -f "$ns_tmp"
    sudo apt-get install -y nodejs </dev/null || fail "Could not install Node.js via apt."
  elif [[ "$PKG_MANAGER" == "brew" ]]; then
    brew install node@22 </dev/null || fail "Could not install Node.js via Homebrew."
    brew link --overwrite node@22 2>/dev/null || true
  elif [[ "$PKG_MANAGER" == "dnf" || "$PKG_MANAGER" == "yum" ]]; then
    local ns_tmp="$(mktemp)"
    curl -fsSL https://rpm.nodesource.com/setup_22.x -o "$ns_tmp" || fail "Could not download NodeSource setup."
    sudo bash "$ns_tmp" </dev/null || fail "NodeSource setup failed."
    rm -f "$ns_tmp"
    sudo "${PKG_MANAGER}" install -y nodejs </dev/null || fail "Could not install Node.js."
  else
    fail "Could not install Node.js automatically. Install Node.js 22+ manually and re-run."
  fi

  hash -r 2>/dev/null || true
  if ! command -v node &>/dev/null; then
    fail "Node.js installation completed but 'node' is not on PATH."
  fi
  local installed_major
  installed_major=$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null || echo "0")
  if [[ "$installed_major" -lt 22 ]]; then
    fail "Node.js installed but version is $(node --version) — need v22+."
  fi
  success "Node.js $(node --version)"
}

# =============================================================================
# pnpm
# =============================================================================
ensure_pnpm() {
  if command -v pnpm &>/dev/null; then success "pnpm found"; return 0; fi
  info "Installing pnpm..."
  if $DRYRUN; then info "[DRYRUN] Would install pnpm"; return 0; fi
  npm install -g pnpm </dev/null || corepack enable pnpm </dev/null || true
  hash -r 2>/dev/null || true
  if command -v pnpm &>/dev/null; then
    success "pnpm installed"
  else
    fail "Could not install pnpm."
  fi
}

# =============================================================================
# Banner
# =============================================================================
print_banner() {
  echo ""
  echo -e "${GREEN}${BOLD}"
  cat <<'BANNER'
     _    _ _            ____ _
    / \  | (_) ___ _ __ / ___| | __ ___
   / _ \ | | |/ _ \ '_ \ |   | |/ _` \ \ /\ / /
  / ___ \| | |  __/ | | | |___| | (_| |\ V  V /
 /_/   \_\_|_|\___|_| |_|\____|_|\__,_| \_/\_/
                                    Installer
BANNER
  echo -e "${NC}"
  if $DRYRUN; then
    echo -e "  ${YELLOW}${BOLD}DRY-RUN MODE — no changes will be made${NC}"
    echo ""
  fi
}

# =============================================================================
# Main
# =============================================================================
main() {
  if [[ ! -t 0 ]] && [[ -r /dev/tty ]]; then
    exec </dev/tty
  fi

  print_banner

  # ── 1. Prerequisites ────────────────────────────────────────────────────────
  step "Detecting platform"
  detect_os

  step "Installing prerequisites"
  require_cmd git
  require_cmd curl
  ensure_node
  ensure_pnpm

  # ── 2. Install OpenClaw ────────────────────────────────────────────────────
  step "Installing OpenClaw"
  if command -v openclaw &>/dev/null; then
    info "OpenClaw already installed: $(openclaw --version 2>/dev/null)"
    success "Skipping npm install."
  elif $DRYRUN; then
    info "[DRYRUN] Would run: npm install -g openclaw"
  else
    info "OpenClaw not found on PATH."
    info "Install it with: npm install -g openclaw"
    info "Then re-run: bash install.sh"
    fail "OpenClaw is required but not installed."
  fi

  # ── 3. Download AlienClaw source ───────────────────────────────────────────
  step "Downloading AlienClaw"
  TMPDIR_AC="$(mktemp -d)"
  if $DRYRUN; then
    info "[DRYRUN] Would clone $ALIENCLAW_REPO"
  else
    info "Cloning AlienClaw repository..."
    if git clone --depth 1 "$ALIENCLAW_REPO" "$TMPDIR_AC/alienclaw"; then
      success "AlienClaw downloaded."
    else
      fail "Could not clone AlienClaw repo."
    fi
  fi

  # ── 4. Install AlienClaw agent system + write agents into OpenClaw config ─
  step "Installing AlienClaw agent system"

  if ! $DRYRUN; then
    mkdir -p "$ALIENCLAW_HOME"
    mkdir -p "$ALIENCLAW_HOME/registry/ms"
    mkdir -p "$ALIENCLAW_HOME/registry/msb"
    mkdir -p "$ALIENCLAW_HOME/registry/lineage"
    mkdir -p "$ALIENCLAW_HOME/registry/telemetry"
    mkdir -p "$ALIENCLAW_HOME/workspace/output"
    mkdir -p "$ALIENCLAW_HOME/bin"

    # Copy AlienClaw source (agent system + Meeseeks + installer)
    cp -r "$TMPDIR_AC/alienclaw/src/alienclaw" "$ALIENCLAW_HOME/src-alienclaw"
    cp -r "$TMPDIR_AC/alienclaw/installer" "$ALIENCLAW_HOME/installer"

    # Copy node_modules so alienclaw can run via tsx without separate install
    if [[ -d "$TMPDIR_AC/alienclaw/build/src-alienclaw-node_modules" ]]; then
      cp -r "$TMPDIR_AC/alienclaw/build/src-alienclaw-node_modules" \
        "$ALIENCLAW_HOME/node_modules"
    fi

    success "AlienClaw agent system installed to $ALIENCLAW_HOME"
  fi

  # ── 4b. Write BossBot / AdvisorBot / CreatorBot into OpenClaw config ─────────
  step "Registering agents in OpenClaw"

  if ! $DRYRUN; then
    node -e "
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const soulDir  = '${TMPDIR_AC}' + '/alienclaw/src/alienclaw/prompts';
const openclaw = process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');
const cfgFile  = path.join(openclaw, 'openclaw.json');

const readSoul = (name) => {
  const p = path.join(soulDir, name);
  if (!fs.existsSync(p)) throw new Error('Soul file not found: ' + p);
  return fs.readFileSync(p, 'utf8');
};

const souls = {
  bossbot:     readSoul('bossbot.soul.md'),
  advisorbot:  readSoul('advisorbot.soul.md'),
  creatorbot:  readSoul('creatorbot.soul.md'),
};
const agents = [
  { id: 'bossbot',    default: true,  name: 'BossBot',    identity: { name: 'BossBot',    emoji: '👽' }, systemPromptOverride: souls.bossbot    },
  { id: 'advisorbot', default: false, name: 'AdvisorBot', identity: { name: 'AdvisorBot', emoji: '🧠' }, systemPromptOverride: souls.advisorbot },
  { id: 'creatorbot', default: false, name: 'CreatorBot', identity: { name: 'CreatorBot', emoji: '🔧' }, systemPromptOverride: souls.creatorbot },
];
let cfg = {};
if (fs.existsSync(cfgFile)) {
  try { cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); }
  catch (e) { throw new Error('Failed to parse openclaw.json: ' + e.message); }
}
const existing = cfg.agents?.list ?? [];
const alienIds  = new Set(['bossbot', 'advisorbot', 'creatorbot']);
const others    = existing.filter(a => !alienIds.has(a.id));
cfg = {
  ...cfg,
  gateway: { ...(cfg.gateway ?? {}), mode: 'local' },
  agents: { ...(cfg.agents ?? {}), list: [...others, ...agents] },
};
try {
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
} catch (e) { throw new Error('Failed to write openclaw.json: ' + e.message); }
console.log('Gateway mode set to local in ' + cfgFile);
console.log('Agents registered in ' + cfgFile);
" || fail "Agent registration failed — check openclaw.json permissions."
    success "Agents registered in ~/.openclaw/openclaw.json"
  fi

  # ── 5. Create alienclaw wrapper ───────────────────────────────────────────
  WRAPPER="$HOME/.alienclaw/bin/alienclaw"

  if ! $DRYRUN; then
    # Write wrapper script — uses tsx to run TypeScript directly
    cat > "$WRAPPER" <<WRAPPER_SCRIPT
#!/usr/bin/env bash
# AlienClaw wrapper — routes "alienclaw run <goal>" to BossBot governance
ALIENCLAW_HOME="\${ALIENCLAW_HOME:-\$HOME/.alienclaw}"
TSX_BIN="\$ALIENCLAW_HOME/node_modules/.bin/tsx"
ALIENCLAW_CLI="\$ALIENCLAW_HOME/src-alienclaw/cli/alienclaw.mjs"

case "\${1:-}" in
  run)
    shift
    if [[ -f "\$TSX_BIN" ]]; then
      exec node "\$TSX_BIN" "\$ALIENCLAW_CLI" "\$@"
    else
      exec node "\$ALIENCLAW_CLI" "\$@"
    fi
    ;;
  *)
    # Pass through to OpenClaw binary
    exec openclaw "\$@"
    ;;
esac
WRAPPER_SCRIPT
    chmod +x "$WRAPPER"
    success "Created $WRAPPER"
  fi

  # ── 6. Symlink alienclaw command ──────────────────────────────────────────
  if ! $DRYRUN; then
    mkdir -p "$HOME/.local/bin"
    ln -sf "$WRAPPER" "$HOME/.local/bin/alienclaw"
    # Persist PATH
    for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
      if [[ -f "$rc" ]] && ! grep -qF '.alienclaw/bin' "$rc"; then
        echo "" >> "$rc"
        echo '# AlienClaw' >> "$rc"
        echo 'export PATH="$HOME/.alienclaw/bin:$PATH"' >> "$rc"
      fi
    done
    hash -r 2>/dev/null || true
    success "Symlinked: alienclaw → $WRAPPER"
  fi

  # ── 7. Abduction animation ─────────────────────────────────────────────────
  if ! $DRYRUN; then
    clear
    local ANIM="$TMPDIR_AC/alienclaw/installer/animation/abduction.mjs"
    if [[ -f "$ANIM" ]]; then
      node "$ANIM" 2>/dev/null || true
    fi
  fi

  # ── 8. First-run wizard ───────────────────────────────────────────────────
  step "AlienClaw configuration"

  if ! $DRYRUN; then
    local WIZARD="$TMPDIR_AC/alienclaw/installer/setup/first-run.mjs"
    if [[ -f "$WIZARD" ]]; then
      node "$WIZARD" || warn "Wizard exited with non-zero status."
    else
      warn "Wizard not found at $WIZARD"
    fi
  fi

  # ── 9. Done ────────────────────────────────────────────────────────────────
  echo ""
  echo -e "${GREEN}${BOLD}  👽 ALIENCLAW ONLINE${NC}"
  echo -e "${GREEN}${BOLD}  ════════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}  alienclaw run \"your first goal\"${NC}"
  echo -e "${GREEN}${BOLD}  ════════════════════════════════════════${NC}"
  echo ""

  if $DRYRUN; then
    echo -e "  ${YELLOW}${BOLD}Dry-run complete — no changes were made.${NC}"
    return 0
  fi

  echo -e "  ${BOLD}What would you like to do?${NC}"
  echo ""
  echo -e "    ${GREEN}[T]${NC}UI  — open the OpenClaw terminal interface"
  echo -e "    ${GREEN}[D]${NC}ashboard — open the web dashboard"
  echo -e "    ${GREEN}[N]${NC}othing  — exit to shell"
  echo ""
  echo -e "  ${DIM}Note: if Dashboard fails, run: openclaw gateway start${NC}"
  echo ""

  if [[ -r /dev/tty && -w /dev/tty ]]; then
    local launch=""
    printf "  Choice: "
    read -r -n 1 launch </dev/tty || true
    echo ""
    case "${launch:-n}" in
      [Tt])
        info "Launching TUI..."
        openclaw tui </dev/tty
        ;;
      [Dd])
        info "Opening dashboard..."
        openclaw gateway start 2>/dev/null || true
        openclaw dashboard </dev/tty || warn "Could not open dashboard."
        ;;
      *)
        echo -e "  ${DIM}Open a new terminal, then run:${NC}"
        echo -e "  ${BOLD}alienclaw run \"<goal>\"${NC}"
        echo ""
        ;;
    esac
  fi
}

main "$@"
