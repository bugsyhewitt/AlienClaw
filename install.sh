#!/usr/bin/env bash
# =============================================================================
# AlienClaw Installer
# Installs prerequisites, OpenClaw, and the AlienClaw overlay automatically.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/AlienTool/AlienClaw/main/install.sh | bash
#   bash install.sh              # Local install
#   bash install.sh --dryrun     # Preview all steps without making changes
# =============================================================================
set -euo pipefail

ALIENCLAW_REPO="https://github.com/AlienTool/AlienClaw.git"
ALIENCLAW_HOME="${ALIENCLAW_HOME:-$HOME/.alienclaw}"
OPENCLAW_INSTALL_URL="https://raw.githubusercontent.com/openclaw/openclaw/main/install.sh"
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
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# Helpers
info()    { echo -e "  ${GREEN}▸${NC} $*"; }
success() { echo -e "  ${GREEN}✔${NC} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $*"; }
fail()    { echo -e "  ${RED}✘${NC} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}${BLUE}==>${NC}${BOLD} $*${NC}"; }

run() {
  if $DRYRUN; then echo -e "  ${YELLOW}[DRYRUN]${NC} $*"; else eval "$*"; fi
}

cleanup() {
  [[ -n "${TMPDIR_AC:-}" && -d "${TMPDIR_AC:-}" ]] && rm -rf "$TMPDIR_AC"
  printf '%b' '\033[?25h\033[0m'
}
trap cleanup EXIT
trap 'echo ""; echo -e "\n  ${RED}Aborted.${NC}"; exit 1' INT TERM

# =============================================================================
# Platform detection
# =============================================================================
OS=""
PKG_MANAGER=""
INSTALL_CMD=""

detect_os() {
  case "$(uname -s)" in
    Linux)
      OS="linux"
      if   command -v apt-get &>/dev/null; then PKG_MANAGER="apt";    INSTALL_CMD="sudo apt-get install -y"
      elif command -v dnf     &>/dev/null; then PKG_MANAGER="dnf";    INSTALL_CMD="sudo dnf install -y"
      elif command -v yum     &>/dev/null; then PKG_MANAGER="yum";    INSTALL_CMD="sudo yum install -y"
      elif command -v pacman  &>/dev/null; then PKG_MANAGER="pacman"; INSTALL_CMD="sudo pacman -S --noconfirm"
      elif command -v zypper  &>/dev/null; then PKG_MANAGER="zypper"; INSTALL_CMD="sudo zypper install -y"
      else fail "No supported package manager found (need apt, dnf, yum, pacman, or zypper)."; fi
      ;;
    Darwin)
      OS="macos"
      PKG_MANAGER="brew"
      INSTALL_CMD="brew install"
      ;;
    *)
      fail "Unsupported OS: $(uname -s). AlienClaw supports macOS, Linux, and WSL2."
      ;;
  esac
  info "Platform: ${OS} (${PKG_MANAGER})"
}

# =============================================================================
# Dependency auto-install
# =============================================================================
require_cmd() {
  local cmd="$1" pkg="${2:-$1}"
  if command -v "$cmd" &>/dev/null; then
    success "$cmd found"
    return
  fi
  info "Installing $cmd..."
  if $DRYRUN; then echo -e "  ${YELLOW}[DRYRUN]${NC} $INSTALL_CMD $pkg"; return; fi
  if [[ "$OS" == "macos" ]]; then
    brew install "$pkg"
  elif [[ "$PKG_MANAGER" == "apt" ]]; then
    sudo apt-get update -qq && sudo apt-get install -y "$pkg"
  else
    $INSTALL_CMD "$pkg"
  fi
  success "$cmd installed"
}

ensure_homebrew() {
  [[ "$OS" != "macos" ]] && return
  if command -v brew &>/dev/null; then success "Homebrew found"; return; fi
  info "Installing Homebrew..."
  if $DRYRUN; then echo -e "  ${YELLOW}[DRYRUN]${NC} Install Homebrew"; return; fi
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" </dev/tty
  [[ -f /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"
  success "Homebrew installed"
}

ensure_node() {
  if command -v node &>/dev/null; then
    local major
    major=$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')
    if [[ "$major" -ge 22 ]]; then
      success "Node.js $(node --version)"
      return
    fi
    info "Node.js $(node --version) found but v22+ required. Upgrading..."
  else
    info "Node.js not found. Installing..."
  fi

  if $DRYRUN; then echo -e "  ${YELLOW}[DRYRUN]${NC} Install Node.js 22 via nvm"; return; fi

  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [[ -f "$NVM_DIR/nvm.sh" ]] && source "$NVM_DIR/nvm.sh" 2>/dev/null || true

  if ! command -v nvm &>/dev/null; then
    info "Installing nvm..."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    source "$NVM_DIR/nvm.sh"
  fi

  nvm install 22
  nvm use 22
  nvm alias default 22
  success "Node.js $(node --version) installed via nvm"
}

ensure_pnpm() {
  if command -v pnpm &>/dev/null; then success "pnpm found"; return; fi
  info "Installing pnpm..."
  if $DRYRUN; then echo -e "  ${YELLOW}[DRYRUN]${NC} npm install -g pnpm"; return; fi
  npm install -g pnpm 2>/dev/null || corepack enable pnpm 2>/dev/null || \
    fail "Could not install pnpm."
  success "pnpm installed"
}

refresh_path() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [[ -f "$NVM_DIR/nvm.sh" ]] && source "$NVM_DIR/nvm.sh" 2>/dev/null || true
  for p in "$HOME/.local/share/pnpm" "$HOME/.local/bin" "$HOME/Library/pnpm"; do
    [[ -d "$p" ]] && export PATH="$p:$PATH"
  done
  hash -r 2>/dev/null || true
}

# =============================================================================
# Banner
# =============================================================================
print_banner() {
  echo ""
  echo -e "${GREEN}${BOLD}"
  cat <<'BANNER'
     _    _ _            ____ _
    / \  | (_) ___ _ __ / ___| | __ ___      __
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
  print_banner

  # ── 1. Prerequisites ───────────────────────────────────────────────────────
  step "Detecting platform"
  detect_os

  step "Installing prerequisites"
  ensure_homebrew
  require_cmd curl
  require_cmd git
  ensure_node
  ensure_pnpm

  # ── 2. Install OpenClaw (includes onboarding + daemon setup) ───────────────
  step "Installing OpenClaw"
  info "Running the official OpenClaw installer."
  info "This will install OpenClaw and run onboarding (provider, API key, daemon)."
  info "Follow the prompts — AlienClaw takes over when OpenClaw finishes."
  echo ""

  if $DRYRUN; then
    echo -e "  ${YELLOW}[DRYRUN]${NC} Download and run OpenClaw installer"
    echo -e "  ${YELLOW}[DRYRUN]${NC} OpenClaw onboarding would run here"
  else
    local oc_installer
    oc_installer="$(mktemp)"
    curl -fsSL --proto '=https' --tlsv1.2 "$OPENCLAW_INSTALL_URL" -o "$oc_installer" || \
      fail "Could not download OpenClaw installer."
    if ! bash "$oc_installer"; then
      rm -f "$oc_installer"
      fail "OpenClaw installation failed. Fix the error above, then re-run this installer."
    fi
    rm -f "$oc_installer"
  fi
  echo ""
  success "OpenClaw installed and onboarded."

  # ── 3. Install lossless-claw plugin ────────────────────────────────────────
  refresh_path

  step "Installing lossless-claw plugin"
  if command -v openclaw &>/dev/null; then
    if $DRYRUN; then
      echo -e "  ${YELLOW}[DRYRUN]${NC} openclaw plugins install @martian-engineering/lossless-claw"
    else
      if openclaw plugins install @martian-engineering/lossless-claw 2>/dev/null; then
        success "lossless-claw installed."
      else
        warn "lossless-claw failed to install (non-critical, continuing)."
      fi
    fi
  else
    warn "openclaw not on PATH yet — skipping lossless-claw."
  fi

  # ── 4. Clone AlienClaw and play abduction animation ────────────────────────
  step "Preparing AlienClaw"
  TMPDIR_AC="$(mktemp -d)"
  local AC_ROOT=""

  info "Downloading AlienClaw..."
  if $DRYRUN; then
    echo -e "  ${YELLOW}[DRYRUN]${NC} git clone --depth 1 $ALIENCLAW_REPO"
    AC_ROOT="$TMPDIR_AC/alienclaw"
  else
    if git clone --depth 1 "$ALIENCLAW_REPO" "$TMPDIR_AC/alienclaw" 2>/dev/null; then
      AC_ROOT="$TMPDIR_AC/alienclaw"

      # Play the abduction animation (non-critical — never crash over this)
      if [[ -f "$AC_ROOT/installer/animation/abduction.mjs" ]]; then
        clear
        node "$AC_ROOT/installer/animation/abduction.mjs" 2>/dev/null || \
          info "Installing AlienClaw..."
      else
        info "Installing AlienClaw..."
      fi
    else
      warn "Could not clone AlienClaw repo — skipping animation."
    fi
  fi

  [[ -z "$AC_ROOT" ]] && fail "AlienClaw repo unavailable. Check your network and re-run."

  # ── 5. Apply AlienClaw overlay ─────────────────────────────────────────────
  step "Applying AlienClaw overlay"

  # Find the installed OpenClaw package directory
  refresh_path
  local OC_DIR=""
  local OC_BIN
  OC_BIN="$(command -v openclaw 2>/dev/null || true)"

  if [[ -n "$OC_BIN" ]]; then
    local OC_REAL
    OC_REAL="$(readlink -f "$OC_BIN" 2>/dev/null || realpath "$OC_BIN" 2>/dev/null || echo "")"
    if [[ -n "$OC_REAL" ]]; then
      local candidate
      candidate="$(dirname "$OC_REAL")"
      for _ in 1 2 3 4; do
        [[ -f "$candidate/package.json" ]] && { OC_DIR="$candidate"; break; }
        candidate="$(dirname "$candidate")"
      done
    fi
  fi
  # Fallback: npm global root
  if [[ -z "$OC_DIR" ]]; then
    local NPM_GLOBAL
    NPM_GLOBAL="$(npm root -g 2>/dev/null || true)"
    [[ -d "$NPM_GLOBAL/openclaw" ]] && OC_DIR="$NPM_GLOBAL/openclaw"
  fi
  [[ -z "$OC_DIR" ]] && fail "Cannot locate OpenClaw install directory. Is openclaw on your PATH?"

  info "OpenClaw found at $OC_DIR"

  if $DRYRUN; then
    echo -e "  ${YELLOW}[DRYRUN]${NC} Reskin OpenClaw → AlienClaw"
    echo -e "  ${YELLOW}[DRYRUN]${NC} Copy src/alienclaw/ overlay"
    echo -e "  ${YELLOW}[DRYRUN]${NC} Apply openclaw-patches/"
    echo -e "  ${YELLOW}[DRYRUN]${NC} Copy entry point + seed files"
    echo -e "  ${YELLOW}[DRYRUN]${NC} pnpm install && pnpm build"
    echo -e "  ${YELLOW}[DRYRUN]${NC} Link alienclaw binary"
  else
    # 5a. Reskin all text references: OpenClaw → AlienClaw
    info "Reskinning OpenClaw → AlienClaw..."
    bash "$AC_ROOT/installer/scripts/reskin.sh" --target "$OC_DIR" --execute

    # 5b. AlienClaw agent system (BossBot, AdvisorBot, CreatorBot, Meeseeks)
    info "Installing AlienClaw agent system..."
    cp -r "$AC_ROOT/src/alienclaw" "$OC_DIR/src/alienclaw"

    # 5c. Patched OpenClaw core files (command registry, etc.)
    if [[ -d "$AC_ROOT/src/openclaw-patches" ]]; then
      info "Applying core patches..."
      cp -r "$AC_ROOT/src/openclaw-patches"/. "$OC_DIR/src/"
    fi

    # 5d. Custom entry point (first-run gate + branding)
    if [[ -f "$AC_ROOT/installer/alienclaw-entry.mjs" ]]; then
      cp "$AC_ROOT/installer/alienclaw-entry.mjs" "$OC_DIR/alienclaw.mjs"
    fi

    # 5e. Seed files (Meeseeks genomes)
    if [[ -d "$AC_ROOT/seed" ]]; then
      cp -r "$AC_ROOT/seed" "$OC_DIR/seed"
    fi

    # 5f. Rebuild
    info "Rebuilding (this may take a minute)..."
    if ! (cd "$OC_DIR" && pnpm install 2>/dev/null && pnpm build 2>/dev/null); then
      if ! (cd "$OC_DIR" && npm install 2>/dev/null && npm run build 2>/dev/null); then
        echo ""
        echo -e "  ${RED}${BOLD}Build failed.${NC}"
        echo ""
        echo "  Please report this with the error output above:"
        echo "  https://github.com/AlienTool/AlienClaw/issues"
        echo ""
        exit 1
      fi
    fi
    success "Build complete."

    # 5g. Link the alienclaw binary
    local BIN_DIR
    BIN_DIR="$(npm bin -g 2>/dev/null || dirname "${OC_BIN:-/usr/local/bin/openclaw}")"
    if [[ -f "$OC_DIR/alienclaw.mjs" && -d "$BIN_DIR" ]]; then
      chmod +x "$OC_DIR/alienclaw.mjs"
      ln -sf "$OC_DIR/alienclaw.mjs" "$BIN_DIR/alienclaw" 2>/dev/null || true
      ln -sf "$OC_DIR/alienclaw.mjs" "$BIN_DIR/openclaw" 2>/dev/null || true
      success "alienclaw command linked."
    fi
  fi

  # ── 6. Evolution network opt-in ────────────────────────────────────────────
  step "AlienClaw configuration"
  mkdir -p "$ALIENCLAW_HOME"

  echo ""
  echo -e "  ${GREEN}${BOLD}Evolution Network${NC}"
  echo ""
  echo -e "  ${DIM}Your Meeseeks learn from every run. Share anonymous genome${NC}"
  echo -e "  ${DIM}fitness data with alienclaw.gg in exchange for leaderboard${NC}"
  echo -e "  ${DIM}access, community genomes, and cross-swarm intelligence.${NC}"
  echo ""
  echo -e "  ${BOLD}Join the Evolution network?${NC}"
  echo -e "    ${GREEN}[Y]${NC}es — named    ${GREEN}[A]${NC}nonymous    ${GREEN}[N]${NC}o, stay local"
  echo ""

  local EVOLUTION_MODE="off"
  if $DRYRUN; then
    echo -e "  ${YELLOW}[DRYRUN]${NC} Would prompt for evolution network choice"
  elif [[ -r /dev/tty && -w /dev/tty ]]; then
    printf "  Choice: "
    read -r -n 1 choice </dev/tty || true
    echo ""
    case "${choice:-n}" in
      [Yy]) EVOLUTION_MODE="named" ;;
      [Aa]) EVOLUTION_MODE="anonymous" ;;
      *)    EVOLUTION_MODE="off" ;;
    esac
  else
    warn "No TTY — defaulting to local mode. Change later in ~/.alienclaw/preferences.json"
  fi

  if ! $DRYRUN; then
    cat > "$ALIENCLAW_HOME/preferences.json" <<PREFS
{
  "evolutionMode": "$EVOLUTION_MODE",
  "setupComplete": true,
  "setupCompletedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
PREFS
  fi
  success "Evolution mode: $EVOLUTION_MODE"

  # ── 7. Done ────────────────────────────────────────────────────────────────
  echo ""
  echo -e "${GREEN}${BOLD}  👽 ALIENCLAW ONLINE${NC}"
  echo -e "${GREEN}${BOLD}  ════════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}  alienclaw run \"your first goal\"${NC}"
  echo -e "${GREEN}${BOLD}  ════════════════════════════════════════${NC}"
  echo ""

  if $DRYRUN; then
    echo -e "  ${YELLOW}${BOLD}Dry-run complete — no changes were made.${NC}"
    echo -e "  ${DIM}Run without --dryrun to install for real.${NC}"
    echo ""
  fi
}

main "$@"
