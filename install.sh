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
set -uo pipefail
# NOTE: we intentionally do NOT use set -e.  We check errors explicitly
# because nvm (a shell function) and several apt/brew commands return
# non-zero for non-error conditions and set -e kills the script silently.

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

detect_os() {
  case "$(uname -s)" in
    Linux)
      OS="linux"
      if   command -v apt-get &>/dev/null; then PKG_MANAGER="apt"
      elif command -v dnf     &>/dev/null; then PKG_MANAGER="dnf"
      elif command -v yum     &>/dev/null; then PKG_MANAGER="yum"
      elif command -v pacman  &>/dev/null; then PKG_MANAGER="pacman"
      elif command -v zypper  &>/dev/null; then PKG_MANAGER="zypper"
      else fail "No supported package manager found (need apt, dnf, yum, pacman, or zypper)."; fi
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
# Package install (stdin-safe: all commands get </dev/null)
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
  fail "$cmd could not be installed. Install it manually, then re-run this installer."
}

# =============================================================================
# Homebrew (macOS only)
# =============================================================================
ensure_homebrew() {
  [[ "$OS" != "macos" ]] && return 0
  if command -v brew &>/dev/null; then success "Homebrew found"; return 0; fi
  info "Installing Homebrew..."
  if $DRYRUN; then info "[DRYRUN] Would install Homebrew"; return 0; fi
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" </dev/tty
  # Apple Silicon path
  [[ -f /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"
  if command -v brew &>/dev/null; then
    success "Homebrew installed"
  else
    fail "Homebrew installation failed."
  fi
}

# =============================================================================
# Node.js 22+  (platform-native install — avoids nvm+set-e issues)
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

  # --- Platform-specific Node install (no nvm, no stdin issues) ---
  if [[ "$PKG_MANAGER" == "apt" ]]; then
    info "Adding NodeSource repository..."
    local ns_tmp
    ns_tmp="$(mktemp)"
    if ! curl -fsSL https://deb.nodesource.com/setup_22.x -o "$ns_tmp"; then
      rm -f "$ns_tmp"
      fail "Could not download NodeSource setup script."
    fi
    # Run with explicit stdin from /dev/null so it never steals our pipe
    if ! sudo -E bash "$ns_tmp" </dev/null; then
      rm -f "$ns_tmp"
      fail "NodeSource setup failed."
    fi
    rm -f "$ns_tmp"
    if ! sudo apt-get install -y nodejs </dev/null; then
      fail "Could not install Node.js via apt."
    fi

  elif [[ "$PKG_MANAGER" == "brew" ]]; then
    if ! brew install node@22 </dev/null; then
      fail "Could not install Node.js via Homebrew."
    fi
    # Ensure node@22 is linked
    brew link --overwrite node@22 2>/dev/null || true

  elif [[ "$PKG_MANAGER" == "dnf" || "$PKG_MANAGER" == "yum" ]]; then
    local ns_tmp
    ns_tmp="$(mktemp)"
    curl -fsSL https://rpm.nodesource.com/setup_22.x -o "$ns_tmp" || fail "Could not download NodeSource setup."
    sudo bash "$ns_tmp" </dev/null || fail "NodeSource setup failed."
    rm -f "$ns_tmp"
    sudo "${PKG_MANAGER}" install -y nodejs </dev/null || fail "Could not install Node.js."

  else
    # Fallback: nvm (wrapped safely — no set -e, explicit stdin protection)
    info "Installing via nvm (fallback)..."
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

    if [[ ! -f "$NVM_DIR/nvm.sh" ]]; then
      local nvm_tmp
      nvm_tmp="$(mktemp)"
      curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh -o "$nvm_tmp" || \
        fail "Could not download nvm installer."
      bash "$nvm_tmp" </dev/null || fail "nvm installation failed."
      rm -f "$nvm_tmp"
    fi

    # Source nvm (it's a shell function, may return non-zero harmlessly)
    source "$NVM_DIR/nvm.sh" 2>/dev/null || true

    if ! command -v nvm &>/dev/null; then
      fail "nvm installed but could not be loaded. Try restarting your terminal and re-running."
    fi

    # nvm commands can return non-zero for benign reasons — don't let them crash us
    nvm install 22  </dev/null || true
    nvm use 22      </dev/null || true
    nvm alias default 22 </dev/null || true
  fi

  # --- Verify ---
  hash -r 2>/dev/null || true
  if ! command -v node &>/dev/null; then
    fail "Node.js installation completed but 'node' is not on PATH. Try restarting your terminal."
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
    fail "Could not install pnpm. Install it manually: npm install -g pnpm"
  fi
}

# =============================================================================
# Refresh PATH (pick up tools installed by child processes)
# =============================================================================
refresh_path() {
  # nvm
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [[ -f "$NVM_DIR/nvm.sh" ]] && { source "$NVM_DIR/nvm.sh" 2>/dev/null || true; }
  # Common tool directories
  for p in "$HOME/.local/share/pnpm" "$HOME/.local/bin" "$HOME/Library/pnpm" \
           "$HOME/.nvm/versions/node/"*/bin; do
    [[ -d "$p" ]] && case ":$PATH:" in *":$p:"*) ;; *) export PATH="$p:$PATH" ;; esac
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
  # ── CRITICAL: Redirect stdin from /dev/tty for curl|bash safety ──────────
  # Without this, child processes (sudo, bash, apt-get) consume the curl pipe
  # and bash loses the rest of the script.
  if [[ ! -t 0 ]] && [[ -r /dev/tty ]]; then
    exec </dev/tty
  fi

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

  # ── 2. Clone AlienClaw repo ──────────────────────────────────────────────
  # Clone FIRST — we need the vendored OpenClaw installer and overlay files.
  step "Downloading AlienClaw"
  TMPDIR_AC="$(mktemp -d)"
  local AC_ROOT=""

  if $DRYRUN; then
    info "[DRYRUN] Would clone $ALIENCLAW_REPO"
    AC_ROOT="$TMPDIR_AC/alienclaw"
  else
    info "Cloning AlienClaw repository..."
    if git clone --depth 1 "$ALIENCLAW_REPO" "$TMPDIR_AC/alienclaw"; then
      AC_ROOT="$TMPDIR_AC/alienclaw"
      success "AlienClaw downloaded."
    else
      fail "Could not clone AlienClaw repo. Check your network and re-run."
    fi
  fi

  # ── 3. Install OpenClaw (using vendored installer — pinned version) ────────
  step "Installing OpenClaw"
  info "Running the vendored OpenClaw installer (pinned to tested version)."
  info "This installs OpenClaw and runs onboarding (provider, API key, daemon)."
  info "Follow the prompts — AlienClaw takes over when OpenClaw finishes."
  echo ""

  local OC_INSTALLER="$AC_ROOT/openclaw/scripts/install.sh"
  if $DRYRUN; then
    info "[DRYRUN] Would run OpenClaw installer from $OC_INSTALLER"
    info "[DRYRUN] OpenClaw onboarding would run here"
  else
    if [[ ! -f "$OC_INSTALLER" ]]; then
      fail "Vendored OpenClaw installer not found at $OC_INSTALLER"
    fi
    if ! bash "$OC_INSTALLER" </dev/tty; then
      fail "OpenClaw installation failed. Fix the error above, then re-run this installer."
    fi
  fi
  echo ""
  success "OpenClaw installed and onboarded."

  # ── 4. Install lossless-claw plugin ────────────────────────────────────────
  refresh_path

  step "Installing lossless-claw plugin"
  if command -v openclaw &>/dev/null; then
    if $DRYRUN; then
      info "[DRYRUN] Would run: openclaw plugins install @martian-engineering/lossless-claw"
    else
      if openclaw plugins install @martian-engineering/lossless-claw </dev/null; then
        success "lossless-claw installed."
      else
        warn "lossless-claw failed to install (non-critical, continuing)."
      fi
    fi
  else
    warn "openclaw not on PATH yet — skipping lossless-claw."
  fi

  # ── 5. Abduction animation ────────────────────────────────────────────────
  # Play the animation (non-critical — never crash over this)
  if [[ -f "$AC_ROOT/installer/animation/abduction.mjs" ]]; then
    clear
    node "$AC_ROOT/installer/animation/abduction.mjs" 2>/dev/null || \
      info "Installing AlienClaw..."
  else
    info "Installing AlienClaw..."
  fi

  # ── 6. Apply AlienClaw overlay ─────────────────────────────────────────────
  step "Applying AlienClaw overlay"

  # Find the installed OpenClaw package directory
  refresh_path
  local OC_DIR=""
  local OC_BIN
  OC_BIN="$(command -v openclaw 2>/dev/null || true)"

  if [[ -n "${OC_BIN:-}" ]]; then
    local OC_REAL
    OC_REAL="$(readlink -f "$OC_BIN" 2>/dev/null || realpath "$OC_BIN" 2>/dev/null || echo "")"
    if [[ -n "${OC_REAL:-}" ]]; then
      local candidate
      candidate="$(dirname "$OC_REAL")"
      local i
      for i in 1 2 3 4; do
        [[ -f "$candidate/package.json" ]] && { OC_DIR="$candidate"; break; }
        candidate="$(dirname "$candidate")"
      done
    fi
  fi
  # Fallback: npm global root
  if [[ -z "$OC_DIR" ]]; then
    local NPM_GLOBAL
    NPM_GLOBAL="$(npm root -g 2>/dev/null || true)"
    [[ -d "${NPM_GLOBAL:-}/openclaw" ]] && OC_DIR="$NPM_GLOBAL/openclaw"
  fi
  [[ -z "$OC_DIR" ]] && fail "Cannot locate OpenClaw install directory. Is openclaw on your PATH?"

  info "OpenClaw found at $OC_DIR"

  if $DRYRUN; then
    info "[DRYRUN] Would reskin OpenClaw → AlienClaw"
    info "[DRYRUN] Would copy src/alienclaw/ overlay"
    info "[DRYRUN] Would apply openclaw-patches/"
    info "[DRYRUN] Would copy entry point + seed files"
    info "[DRYRUN] Would rebuild (pnpm install && pnpm build)"
    info "[DRYRUN] Would link alienclaw binary"
  else
    # 6a. Reskin all text references: OpenClaw → AlienClaw
    info "Reskinning OpenClaw → AlienClaw..."
    if ! bash "$AC_ROOT/installer/scripts/reskin.sh" --target "$OC_DIR" --execute </dev/null; then
      fail "Reskin failed."
    fi

    # 6b. AlienClaw agent system (BossBot, AdvisorBot, CreatorBot, Meeseeks)
    info "Installing AlienClaw agent system..."
    cp -r "$AC_ROOT/src/alienclaw" "$OC_DIR/src/alienclaw"

    # 6c. Patched OpenClaw core files (command registry, etc.)
    if [[ -d "$AC_ROOT/src/openclaw-patches" ]]; then
      info "Applying core patches..."
      cp -r "$AC_ROOT/src/openclaw-patches"/. "$OC_DIR/src/"
    fi

    # 6d. Custom entry point (first-run gate + branding)
    if [[ -f "$AC_ROOT/installer/alienclaw-entry.mjs" ]]; then
      cp "$AC_ROOT/installer/alienclaw-entry.mjs" "$OC_DIR/alienclaw.mjs"
    fi

    # 6e. Seed files (Meeseeks genomes)
    if [[ -d "$AC_ROOT/seed" ]]; then
      cp -r "$AC_ROOT/seed" "$OC_DIR/seed"
    fi

    # 6f. Rebuild (show errors — don't suppress stderr)
    info "Rebuilding (this may take a minute)..."
    local build_ok=false
    if (cd "$OC_DIR" && pnpm install </dev/null && pnpm build </dev/null) 2>&1; then
      build_ok=true
    elif (cd "$OC_DIR" && npm install </dev/null && npm run build </dev/null) 2>&1; then
      build_ok=true
    fi

    if $build_ok; then
      success "Build complete."
    else
      echo ""
      echo -e "  ${RED}${BOLD}Build failed.${NC}"
      echo ""
      echo "  Please report this with the full terminal output:"
      echo "  https://github.com/AlienTool/AlienClaw/issues"
      echo ""
      exit 1
    fi

    # 6g. Link the alienclaw binary
    local BIN_DIR
    BIN_DIR="$(npm bin -g 2>/dev/null || dirname "${OC_BIN:-/usr/local/bin/openclaw}")"
    if [[ -f "$OC_DIR/alienclaw.mjs" && -d "${BIN_DIR:-}" ]]; then
      chmod +x "$OC_DIR/alienclaw.mjs"
      ln -sf "$OC_DIR/alienclaw.mjs" "$BIN_DIR/alienclaw" || \
        warn "Could not link alienclaw binary. You may need: sudo ln -sf $OC_DIR/alienclaw.mjs $BIN_DIR/alienclaw"
      ln -sf "$OC_DIR/alienclaw.mjs" "$BIN_DIR/openclaw" || true
      if command -v alienclaw &>/dev/null; then
        success "alienclaw command linked."
      else
        warn "alienclaw is not on PATH. Add $BIN_DIR to your PATH."
      fi
    fi
  fi

  # ── 7. Evolution network opt-in ────────────────────────────────────────────
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
    info "[DRYRUN] Would prompt for evolution network choice"
  elif [[ -r /dev/tty && -w /dev/tty ]]; then
    local choice=""
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

  # ── 8. Done ────────────────────────────────────────────────────────────────
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
