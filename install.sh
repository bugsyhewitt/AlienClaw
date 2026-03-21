#!/usr/bin/env bash
# AlienClaw Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/AlienTool/AlienClaw/main/install.sh | bash
set -euo pipefail

ALIENCLAW_REPO="https://github.com/AlienTool/AlienClaw.git"
ALIENCLAW_HOME="${ALIENCLAW_HOME:-$HOME/.alienclaw}"
TMPDIR_AC=""
GREEN='\033[38;2;0;255;136m'
BOLD='\033[1m'
DIM='\033[2m'
RED='\033[38;2;255;60;60m'
YELLOW='\033[38;2;255;200;0m'
NC='\033[0m'

cleanup() {
  [[ -n "$TMPDIR_AC" && -d "$TMPDIR_AC" ]] && rm -rf "$TMPDIR_AC"
  printf '%b' '\033[?25h\033[0m'  # restore cursor + reset
}
trap cleanup EXIT
trap 'echo ""; echo -e "${RED}Aborted.${NC}"; exit 1' INT TERM

info()  { echo -e "  ${GREEN}▸${NC} $*"; }
warn()  { echo -e "  ${YELLOW}⚠${NC} $*"; }
fail()  { echo -e "  ${RED}✘${NC} $*" >&2; exit 1; }

# ── Step 1: Prerequisites ────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}  ╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}  ║   👽  A L I E N C L A W  installer    ║${NC}"
echo -e "${GREEN}${BOLD}  ╚════════════════════════════════════════╝${NC}"
echo ""

for cmd in bash git curl; do
  command -v "$cmd" &>/dev/null || fail "$cmd is required but not found."
done

if ! command -v node &>/dev/null; then
  echo ""
  echo -e "${RED}${BOLD}  Node.js is not installed.${NC}"
  echo ""
  echo "  AlienClaw requires Node.js 22 or later."
  echo ""
  echo "  Install it for your platform:"
  echo "    Mac:      brew install node"
  echo "    Ubuntu:   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
  echo "    WSL2:     same as Ubuntu (above)"
  echo "    Any:      https://nodejs.org/en/download"
  echo ""
  exit 1
fi

NODE_MAJOR="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  fail "Node.js 22+ required (found $(node --version)). Please upgrade: https://nodejs.org"
fi
info "Node $(node --version)"

# ── Step 2: Install OpenClaw ─────────────────────────────────────────────────
info "Installing OpenClaw..."
echo ""
if ! curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/openclaw/openclaw/main/install.sh | bash; then
  echo ""
  fail "OpenClaw installation failed. Fix the error above, then re-run this installer."
fi
echo ""
info "OpenClaw installed and onboarded."

# ── Step 3: Install lossless-claw plugin ─────────────────────────────────────
OPENCLAW_BIN="$(command -v openclaw 2>/dev/null || true)"
if [[ -n "$OPENCLAW_BIN" ]]; then
  info "Installing lossless-claw plugin..."
  if openclaw plugins install @martian-engineering/lossless-claw 2>/dev/null; then
    info "lossless-claw installed."
  else
    warn "lossless-claw plugin failed to install (non-critical, continuing)."
  fi
else
  warn "openclaw not on PATH — skipping lossless-claw plugin."
fi

# ── Step 4: Clone repo and play abduction animation ─────────────────────────
TMPDIR_AC="$(mktemp -d)"
info "Cloning AlienClaw..."
if git clone --depth 1 "$ALIENCLAW_REPO" "$TMPDIR_AC/alienclaw" 2>/dev/null; then
  AC_ROOT="$TMPDIR_AC/alienclaw"

  # Play the animation (non-critical)
  if [[ -f "$AC_ROOT/installer/animation/abduction.mjs" ]]; then
    clear
    node "$AC_ROOT/installer/animation/abduction.mjs" 2>/dev/null || info "Installing AlienClaw..."
  else
    info "Installing AlienClaw..."
  fi
else
  warn "Could not clone AlienClaw repo — skipping animation."
  AC_ROOT=""
fi

# ── Step 5: Apply AlienClaw overlay ──────────────────────────────────────────
if [[ -z "$AC_ROOT" ]]; then
  fail "AlienClaw repo not available. Re-run the installer or check your network."
fi

# Find OpenClaw install directory
OC_DIR=""
if [[ -n "$OPENCLAW_BIN" ]]; then
  OC_REAL="$(readlink -f "$OPENCLAW_BIN" 2>/dev/null || realpath "$OPENCLAW_BIN" 2>/dev/null || echo "")"
  if [[ -n "$OC_REAL" ]]; then
    # Walk up from the binary to find the package root (has package.json)
    candidate="$(dirname "$OC_REAL")"
    for _ in 1 2 3 4; do
      [[ -f "$candidate/package.json" ]] && { OC_DIR="$candidate"; break; }
      candidate="$(dirname "$candidate")"
    done
  fi
fi
# Fallback: npm root -g
if [[ -z "$OC_DIR" ]]; then
  NPM_GLOBAL="$(npm root -g 2>/dev/null || true)"
  [[ -d "$NPM_GLOBAL/openclaw" ]] && OC_DIR="$NPM_GLOBAL/openclaw"
fi
[[ -z "$OC_DIR" ]] && fail "Cannot find OpenClaw install directory. Is openclaw on your PATH?"

info "OpenClaw found at $OC_DIR"

# 5a. Reskin
info "Reskinning OpenClaw → AlienClaw..."
bash "$AC_ROOT/installer/scripts/reskin.sh" --target "$OC_DIR" --execute

# 5b. Copy AlienClaw overlay source
info "Copying AlienClaw agent system..."
cp -r "$AC_ROOT/src/alienclaw" "$OC_DIR/src/alienclaw"

if [[ -d "$AC_ROOT/src/openclaw-patches" ]]; then
  cp -r "$AC_ROOT/src/openclaw-patches"/. "$OC_DIR/src/"
fi

# 5c. Copy custom entry point
if [[ -f "$AC_ROOT/installer/alienclaw-entry.mjs" ]]; then
  cp "$AC_ROOT/installer/alienclaw-entry.mjs" "$OC_DIR/alienclaw.mjs"
fi

# 5d. Rebuild
info "Rebuilding..."
if (cd "$OC_DIR" && pnpm install --frozen-lockfile 2>/dev/null && pnpm build); then
  info "Build succeeded."
else
  echo ""
  echo -e "${RED}${BOLD}  Build failed.${NC}"
  echo ""
  echo "  Please report this issue with the error output above:"
  echo "  https://github.com/AlienTool/AlienClaw/issues"
  echo ""
  exit 1
fi

# ── Step 6: Evolution network opt-in ─────────────────────────────────────────
mkdir -p "$ALIENCLAW_HOME"
echo ""
echo -e "  ${GREEN}${BOLD}Evolution Network${NC}"
echo ""
echo -e "  ${DIM}Your Meeseeks learn from every run.${NC}"
echo -e "  ${DIM}Share anonymous genome fitness data with alienclaw.gg${NC}"
echo -e "  ${DIM}in exchange for leaderboard access, community genomes,${NC}"
echo -e "  ${DIM}and cross-swarm intelligence boosts.${NC}"
echo ""
echo -e "  ${BOLD}Join the Evolution network?${NC}"
echo -e "    ${GREEN}[Y]${NC}es — named    ${GREEN}[A]${NC}nonymous    ${GREEN}[N]${NC}o, stay local"
echo ""

EVOLUTION_MODE="off"
if [[ -r /dev/tty ]]; then
  printf "  Choice: "
  read -r -n 1 choice </dev/tty || true
  echo ""
  case "$choice" in
    [Yy]) EVOLUTION_MODE="named" ;;
    [Aa]) EVOLUTION_MODE="anonymous" ;;
    *)    EVOLUTION_MODE="off" ;;
  esac
else
  warn "No TTY — defaulting to local mode. Change later in ~/.alienclaw/preferences.json"
fi

# Write preferences
cat > "$ALIENCLAW_HOME/preferences.json" <<PREFS
{
  "evolutionMode": "$EVOLUTION_MODE",
  "setupComplete": true,
  "setupCompletedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
PREFS
info "Evolution mode: $EVOLUTION_MODE"

# ── Step 7: Done ─────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}  👽 ALIENCLAW ONLINE${NC}"
echo -e "${GREEN}${BOLD}  ════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  alienclaw run \"your first goal\"${NC}"
echo -e "${GREEN}${BOLD}  ════════════════════════════════════════${NC}"
echo ""
