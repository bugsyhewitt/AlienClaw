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
ALIENCLAW_BIN=""   # Full path to alienclaw binary — set in step 4
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
  # Background the temp dir removal so the script exits instantly.
  # WSL2 rm -rf on thousands of files (cloned repo + node_modules) can take 30s+.
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
# npm prefix fix (Linux — ensures npm install -g doesn't require sudo)
# =============================================================================
fix_npm_prefix() {
  [[ "$OS" != "linux" ]] && return 0
  local npm_prefix
  npm_prefix="$(npm config get prefix 2>/dev/null || true)"
  if [[ -n "$npm_prefix" ]] && ! [[ -w "$npm_prefix" || -w "${npm_prefix}/lib" ]]; then
    info "Configuring npm for user-local installs..."
    mkdir -p "$HOME/.npm-global"
    npm config set prefix "$HOME/.npm-global" </dev/null
    export PATH="$HOME/.npm-global/bin:$PATH"
    for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
      if [[ -f "$rc" ]] && ! grep -q ".npm-global" "$rc"; then
        echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> "$rc"
      fi
    done
    success "npm configured for user-local installs"
  fi
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
  fix_npm_prefix
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

  # ── 3. Build AlienClaw from source ────────────────────────────────────────
  # We build from the vendored OpenClaw source (not npm install -g) because:
  #   - npm-installed OpenClaw only has dist/ — no src/ to overlay onto
  #   - We need to: copy vendor → overlay agents/patches → compile
  # No reskin — we keep OpenClaw system filenames intact and just overlay
  # the AlienClaw agent system + branding patches on top.
  step "Building AlienClaw"

  local INSTALL_DIR="$ALIENCLAW_HOME/package"

  if $DRYRUN; then
    info "[DRYRUN] Would build AlienClaw from vendored OpenClaw source"
  else
    if [[ ! -d "$AC_ROOT/openclaw" ]]; then
      fail "Vendored OpenClaw source not found at $AC_ROOT/openclaw"
    fi

    # 3a. Copy vendored OpenClaw source → build/
    info "Copying vendored OpenClaw source..."
    bash "$AC_ROOT/installer/scripts/copy-dist.sh" </dev/null || \
      fail "copy-dist.sh failed."

    # 3b. Overlay: agent system + core patches + entry point + installer + seeds
    # (no reskin step — we keep OpenClaw filenames intact)
    info "Applying AlienClaw overlay..."
    bash "$AC_ROOT/installer/scripts/overlay-dist.sh" </dev/null || \
      fail "Overlay failed."

    # 3c. Install dependencies and compile
    info "Installing dependencies (this may take a minute)..."
    if ! (cd "$AC_ROOT/build" && pnpm install </dev/null) 2>&1; then
      if ! (cd "$AC_ROOT/build" && npm install </dev/null) 2>&1; then
        fail "Dependency install failed."
      fi
    fi

    info "Compiling..."
    if ! (cd "$AC_ROOT/build" && pnpm build </dev/null) 2>&1; then
      if ! (cd "$AC_ROOT/build" && npm run build </dev/null) 2>&1; then
        fail "Build failed. Please report: https://github.com/AlienTool/AlienClaw/issues"
      fi
    fi

    success "Build complete."
  fi

  # ── 4. Install to ~/.alienclaw/package/ ─────────────────────────────────
  step "Installing AlienClaw"

  if $DRYRUN; then
    info "[DRYRUN] Would install to $INSTALL_DIR"
  else
    mkdir -p "$ALIENCLAW_HOME"
    rm -rf "$INSTALL_DIR"
    cp -r "$AC_ROOT/build" "$INSTALL_DIR"
    success "Installed to $INSTALL_DIR"

    # Set the canonical binary path — openclaw.mjs (we no longer rename it)
    ALIENCLAW_BIN="$INSTALL_DIR/openclaw.mjs"
    chmod +x "$ALIENCLAW_BIN"

    # Verify the entry point actually exists
    if [[ ! -f "$ALIENCLAW_BIN" ]]; then
      fail "Build succeeded but openclaw.mjs not found at $ALIENCLAW_BIN"
    fi

    # Symlink into ~/.alienclaw/bin/ — a known, stable location we control.
    # Both `openclaw` and `alienclaw` commands point to the same binary.
    local BIN_DIR="$ALIENCLAW_HOME/bin"
    mkdir -p "$BIN_DIR"
    ln -sf "$ALIENCLAW_BIN" "$BIN_DIR/openclaw"
    ln -sf "$ALIENCLAW_BIN" "$BIN_DIR/alienclaw"
    export PATH="$BIN_DIR:$PATH"
    hash -r 2>/dev/null || true

    # Persist PATH for future shells (bashrc / zshrc / profile)
    local path_line='export PATH="$HOME/.alienclaw/bin:$PATH"'
    for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
      if [[ -f "$rc" ]] && ! grep -qF '.alienclaw/bin' "$rc"; then
        echo "" >> "$rc"
        echo '# AlienClaw' >> "$rc"
        echo "$path_line" >> "$rc"
      fi
    done

    # Verify key files exist (don't run the binary yet — preferences.json isn't written until step 8)
    if [[ -f "$INSTALL_DIR/dist/entry.js" ]] || [[ -f "$INSTALL_DIR/dist/entry.mjs" ]]; then
      success "Build output verified (dist/entry found)"
    else
      warn "dist/entry.js not found — build may be incomplete"
    fi

    success "Symlinked: openclaw + alienclaw → $ALIENCLAW_BIN"
  fi

  # ── 5. Onboarding ────────────────────────────────────────────────────────
  # Run OpenClaw's onboarding for provider + API key config.
  # --skip-daemon --skip-health: the systemd daemon checks hang on WSL2
  #   (isSystemdUserServiceAvailable calls systemctl which blocks on D-Bus).
  # --skip-ui: prevents the post-onboard TUI/GUI menu from blocking.
  #
  # IMPORTANT: Our custom entry point (alienclaw-entry.mjs, installed as
  # openclaw.mjs) checks ~/.alienclaw/preferences.json for setupComplete.
  # If missing, it intercepts ALL commands and runs the first-run wizard
  # instead of the real CLI. We write a preliminary preferences.json here
  # so the entry point passes through to OpenClaw's real onboard command.
  # Step 8 overwrites it with the final version (evolution mode, etc).
  refresh_path

  step "OpenClaw onboarding"
  if [[ -n "$ALIENCLAW_BIN" ]]; then
    if $DRYRUN; then
      info "[DRYRUN] Would run onboarding"
    else
      # Write preliminary preferences so entry point doesn't intercept
      mkdir -p "$ALIENCLAW_HOME"
      cat > "$ALIENCLAW_HOME/preferences.json" <<PREFS_EARLY
{
  "setupComplete": true
}
PREFS_EARLY

      info "Running OpenClaw onboarding (provider & API key setup)."
      info "Follow the prompts below."
      echo ""
      "$ALIENCLAW_BIN" onboard --skip-daemon --skip-health --skip-ui </dev/tty || \
        warn "Onboarding exited with a warning (continuing)."
      echo ""
      success "Onboarding complete."
    fi
  else
    warn "Skipping onboarding — run 'openclaw onboard' manually after install."
  fi

  # ── 6. Install lossless-claw plugin ────────────────────────────────────────
  step "Installing lossless-claw plugin"
  if [[ -n "$ALIENCLAW_BIN" ]]; then
    if $DRYRUN; then
      info "[DRYRUN] Would install lossless-claw plugin"
    else
      if "$ALIENCLAW_BIN" plugins install @martian-engineering/lossless-claw </dev/null; then
        success "lossless-claw installed."
      else
        warn "lossless-claw failed to install (non-critical, continuing)."
      fi
    fi
  else
    warn "Skipping lossless-claw — alienclaw binary not set."
  fi

  # ── 7. Abduction animation ────────────────────────────────────────────────
  if [[ -f "$AC_ROOT/installer/animation/abduction.mjs" ]]; then
    clear
    node "$AC_ROOT/installer/animation/abduction.mjs" 2>/dev/null || true
  fi

  # ── 8. Evolution network opt-in ────────────────────────────────────────────
  step "AlienClaw configuration"
  mkdir -p "$ALIENCLAW_HOME"
  mkdir -p "$ALIENCLAW_HOME/registry/ms"
  mkdir -p "$ALIENCLAW_HOME/registry/msb"
  mkdir -p "$ALIENCLAW_HOME/registry/lineage"
  mkdir -p "$ALIENCLAW_HOME/registry/telemetry"
  mkdir -p "$ALIENCLAW_HOME/workspace/output"

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
  local LEADERBOARD_NAME=""
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

    # If named, ask for a leaderboard name (letters only)
    if [[ "$EVOLUTION_MODE" == "named" ]]; then
      echo ""
      echo -e "  ${BOLD}Choose a leaderboard name${NC} ${DIM}(letters only)${NC}"
      local raw_name=""
      printf "  Name: "
      read -r raw_name </dev/tty || true
      # Strip everything that isn't a letter
      raw_name="${raw_name//[^a-zA-Z]/}"
      if [[ -n "$raw_name" ]]; then
        LEADERBOARD_NAME="$raw_name"
        success "Leaderboard name: $LEADERBOARD_NAME"
      else
        warn "No valid name entered — defaulting to anonymous."
        EVOLUTION_MODE="anonymous"
      fi
    fi
  else
    warn "No TTY — defaulting to local mode. Change later in ~/.alienclaw/preferences.json"
  fi

  if ! $DRYRUN; then
    cat > "$ALIENCLAW_HOME/preferences.json" <<PREFS
{
  "provider": "minimax",
  "evolutionMode": "$EVOLUTION_MODE",
  "leaderboardName": "$LEADERBOARD_NAME",
  "setupComplete": true,
  "setupCompletedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
PREFS
  fi
  success "Evolution mode: $EVOLUTION_MODE"

  # ── 9. Done ─────────────────────────────────────────────────────────────
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
    return 0
  fi

  # ── What next? ──────────────────────────────────────────────────────────
  if [[ -z "$ALIENCLAW_BIN" || ! -f "$ALIENCLAW_BIN" ]]; then
    warn "Binary not found — run the installer again or check ~/.alienclaw/package/"
    echo ""
    return 1
  fi

  echo -e "  ${BOLD}What would you like to do?${NC}"
  echo ""
  echo -e "    ${GREEN}[T]${NC}UI  — open the terminal interface"
  echo -e "    ${GREEN}[D]${NC}ashboard — open the web dashboard"
  echo -e "    ${GREEN}[N]${NC}othing  — exit to shell"
  echo ""

  if [[ -r /dev/tty && -w /dev/tty ]]; then
    local launch=""
    printf "  Choice: "
    read -r -n 1 launch </dev/tty || true
    echo ""
    echo ""
    case "${launch:-n}" in
      [Tt])
        info "Launching TUI..."
        exec "$ALIENCLAW_BIN" </dev/tty
        ;;
      [Dd])
        info "Opening dashboard..."
        "$ALIENCLAW_BIN" dashboard </dev/tty || warn "Could not open dashboard."
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
