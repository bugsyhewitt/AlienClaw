#!/usr/bin/env bash
# installer/scripts/verify.sh
#
# Verifies that the AlienClaw build has been assembled correctly.
# Checks that the overlay was applied and the build output exists.
#
# Usage:
#   installer/scripts/verify.sh --target <dir>               # full check + build
#   installer/scripts/verify.sh --target <dir> --skip-build  # checks only, no pnpm build
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed

set -euo pipefail

# ── Argument parsing ────────────────────────────────────────────────────────────
TARGET=""
SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target)
            TARGET="${2:?'--target requires a directory path'}"
            shift 2
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        -h|--help)
            sed -n '2,20p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

if [[ -z "$TARGET" ]]; then
    echo "error: --target <dir> is required" >&2
    echo "usage: $0 --target <dir> [--skip-build]" >&2
    exit 1
fi

TARGET="$(cd "$TARGET" && pwd)"

if [[ ! -d "$TARGET" ]]; then
    echo "error: target directory does not exist: $TARGET" >&2
    exit 1
fi

# ── Colours ─────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    CYAN='\033[0;36m'; WHITE='\033[1;37m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; CYAN=''; WHITE=''; NC=''
fi

PASS=0
FAIL=0

pass() { echo -e "  ${GREEN}PASS${NC}  $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}FAIL${NC}  $1"; FAIL=$((FAIL + 1)); }
warn() { echo -e "  ${YELLOW}WARN${NC}  $1"; }
info() { echo -e "        $1"; }

# ── Header ───────────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       AlienClaw Build Verify — installer/scripts/verify.sh   ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  Target     : $TARGET"
echo "  Skip build : $SKIP_BUILD"
echo ""

# ── Check 1: Entry point exists ─────────────────────────────────────────────────
echo -e "${WHITE}[1] Entry point${NC}"
if [[ -f "$TARGET/openclaw.mjs" ]]; then
    pass "openclaw.mjs exists"
else
    fail "openclaw.mjs not found at $TARGET/openclaw.mjs"
fi
echo ""

# ── Check 2: package.json exists and is valid ────────────────────────────────────
echo -e "${WHITE}[2] package.json${NC}"
PKG="$TARGET/package.json"
if [[ ! -f "$PKG" ]]; then
    fail "package.json not found"
else
    pkg_name="$(grep '"name"' "$PKG" | head -1 \
        | sed 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' 2>/dev/null || echo '')"
    if [[ -n "$pkg_name" ]]; then
        pass "package name = \"$pkg_name\""
    else
        fail "could not read package name"
    fi

    if grep -q '"openclaw"[[:space:]]*:' "$PKG" 2>/dev/null; then
        pass "bin contains openclaw key"
    else
        fail "bin does not contain openclaw key"
    fi
fi
echo ""

# ── Check 3: AlienClaw overlay applied ───────────────────────────────────────────
echo -e "${WHITE}[3] AlienClaw overlay${NC}"
if [[ -d "$TARGET/src/alienclaw" ]]; then
    pass "src/alienclaw/ directory exists"
else
    fail "src/alienclaw/ not found — overlay was not applied"
fi

if [[ -f "$TARGET/src/alienclaw/constants.ts" ]]; then
    pass "src/alienclaw/constants.ts exists"
else
    fail "src/alienclaw/constants.ts not found"
fi

if [[ -f "$TARGET/src/alienclaw/cli/cli.ts" ]]; then
    pass "src/alienclaw/cli/cli.ts exists"
else
    fail "src/alienclaw/cli/cli.ts not found"
fi
echo ""

# ── Check 4: Core patches applied ───────────────────────────────────────────────
echo -e "${WHITE}[4] Core patches${NC}"
CMD_REG="$TARGET/src/cli/program/command-registry.ts"
if [[ -f "$CMD_REG" ]]; then
    if grep -q 'alienclaw' "$CMD_REG" 2>/dev/null; then
        pass "command-registry.ts contains alienclaw entries"
    else
        fail "command-registry.ts does not contain alienclaw entries"
    fi
else
    fail "command-registry.ts not found at expected path"
fi

BANNER="$TARGET/src/cli/banner.ts"
if [[ -f "$BANNER" ]]; then
    if grep -q 'AlienClaw' "$BANNER" 2>/dev/null; then
        pass "banner.ts shows AlienClaw branding"
    else
        warn "banner.ts does not mention AlienClaw"
    fi
else
    warn "banner.ts not found (branding may be missing)"
fi
echo ""

# ── Check 5: Entry point content ────────────────────────────────────────────────
echo -e "${WHITE}[5] Entry point content${NC}"
MJS="$TARGET/openclaw.mjs"
if [[ -f "$MJS" ]]; then
    # Should contain our first-run gate (references ~/.alienclaw/)
    if grep -q 'alienclaw' "$MJS" 2>/dev/null; then
        pass "openclaw.mjs contains AlienClaw first-run gate"
    else
        warn "openclaw.mjs may not have the custom entry point"
    fi
    if grep -q 'dist/entry' "$MJS" 2>/dev/null; then
        pass "openclaw.mjs delegates to dist/entry"
    else
        warn "openclaw.mjs does not reference dist/entry"
    fi
fi
echo ""

# ── Check 6: Installer + animation assets ───────────────────────────────────────
echo -e "${WHITE}[6] Installer assets${NC}"
if [[ -d "$TARGET/installer" ]]; then
    pass "installer/ directory exists"
else
    fail "installer/ not found"
fi

if [[ -f "$TARGET/installer/animation/abduction.mjs" ]]; then
    pass "abduction animation found"
else
    warn "abduction animation missing (non-critical)"
fi
echo ""

# ── Check 7: Seed files ─────────────────────────────────────────────────────────
echo -e "${WHITE}[7] Seed files${NC}"
if [[ -d "$TARGET/src/alienclaw/seed" ]] || [[ -d "$TARGET/seed" ]]; then
    pass "seed directory found"
else
    warn "seed directory not found (seeds may be in a different location)"
fi
echo ""

# ── Check 8: Build (optional) ──────────────────────────────────────────────────
if $SKIP_BUILD; then
    echo -e "${WHITE}[8] Build${NC}"
    warn "Skipped (--skip-build)"
    echo ""
else
    echo -e "${WHITE}[8] Build${NC}"

    if ! command -v pnpm >/dev/null 2>&1; then
        fail "pnpm not found in PATH — cannot run build check"
    else
        echo "  Running: pnpm install --frozen-lockfile && pnpm build"
        echo "  (this may take a few minutes)"
        echo ""

        build_log="$(mktemp)"
        if (cd "$TARGET" && pnpm install --frozen-lockfile && pnpm build) >"$build_log" 2>&1; then
            pass "pnpm build completed successfully"
        else
            fail "pnpm build failed — see output below"
            echo ""
            tail -40 "$build_log" | sed "s/^/        /" || true
        fi
        rm -f "$build_log"
    fi
    echo ""
fi

# ── Check 9: Build output ──────────────────────────────────────────────────────
echo -e "${WHITE}[9] Build output${NC}"
if [[ -f "$TARGET/dist/entry.js" ]] || [[ -f "$TARGET/dist/entry.mjs" ]]; then
    pass "dist/entry found"
else
    if $SKIP_BUILD; then
        warn "dist/entry not found (build was skipped)"
    else
        fail "dist/entry not found after build"
    fi
fi
echo ""

# ── Check 10: Soul files ───────────────────────────────────────────────────────
echo -e "${WHITE}[10] Soul files${NC}"
SOUL_COUNT=0
if [[ -d "$TARGET/src/alienclaw/prompts" ]]; then
    SOUL_COUNT=$(find "$TARGET/src/alienclaw/prompts" -name '*.soul.md' -type f 2>/dev/null | wc -l)
fi
if [[ $SOUL_COUNT -gt 0 ]]; then
    pass "$SOUL_COUNT soul file(s) found"
else
    warn "No soul files found in src/alienclaw/prompts/"
fi
echo ""

# ── Summary ──────────────────────────────────────────────────────────────────────
echo -e "${WHITE}──────────────────────────────────────────────────────────────────${NC}"
echo ""
if [[ $FAIL -eq 0 ]]; then
    echo -e "${GREEN}All checks passed ($PASS passed, 0 failed).${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}$FAIL check(s) failed, $PASS passed.${NC}"
    echo ""
    echo "Fix the issues above then re-run:"
    echo "  installer/scripts/verify.sh --target $TARGET"
    echo ""
    exit 1
fi
