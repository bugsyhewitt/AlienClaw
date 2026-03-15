#!/usr/bin/env bash
# installer/scripts/verify.sh
#
# Verifies that the AlienClaw reskin has been applied correctly to a target directory
# and (optionally) that the build passes clean.
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
echo -e "${CYAN}║        AlienClaw Reskin — installer/scripts/verify.sh        ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  Target     : $TARGET"
echo "  Skip build : $SKIP_BUILD"
echo ""

# ── Check 1: alienclaw.mjs entry point exists ───────────────────────────────────
echo -e "${WHITE}[1] Entry point${NC}"
if [[ -f "$TARGET/alienclaw.mjs" ]]; then
    pass "alienclaw.mjs exists"
else
    fail "alienclaw.mjs not found at $TARGET/alienclaw.mjs"
fi

if [[ -f "$TARGET/openclaw.mjs" ]]; then
    fail "openclaw.mjs still present (rename was not applied)"
else
    pass "openclaw.mjs absent (rename applied)"
fi
echo ""

# ── Check 2: package.json fields ────────────────────────────────────────────────
echo -e "${WHITE}[2] package.json fields${NC}"
PKG="$TARGET/package.json"
if [[ ! -f "$PKG" ]]; then
    fail "package.json not found"
else
    # name field
    pkg_name="$(grep '"name"' "$PKG" | head -1 \
        | sed 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' 2>/dev/null || echo '')"
    if [[ "$pkg_name" == "alienclaw" ]]; then
        pass "name = \"alienclaw\""
    else
        fail "name = \"$pkg_name\" (expected alienclaw)"
    fi

    # bin field
    if grep -q '"alienclaw"[[:space:]]*:' "$PKG" 2>/dev/null; then
        pass "bin contains alienclaw key"
    else
        fail "bin does not contain alienclaw key"
    fi

    # cli-entry
    if grep -q '"cli-entry"' "$PKG" 2>/dev/null; then
        cli_val="$(grep '"./cli-entry"' "$PKG" | head -1 | grep -o '"[^"]*\.mjs"' || echo '')"
        if echo "$cli_val" | grep -q 'alienclaw'; then
            pass "./cli-entry points to alienclaw.mjs ($cli_val)"
        else
            fail "./cli-entry does not point to alienclaw.mjs (got: $cli_val)"
        fi
    else
        warn "no ./cli-entry export found in package.json (may be intentional)"
    fi

    # Guard: old name must not remain
    if grep -q '"name"[[:space:]]*:[[:space:]]*"openclaw"' "$PKG" 2>/dev/null; then
        fail "name is still openclaw in package.json"
    else
        pass "name is not openclaw"
    fi
fi
echo ""

# ── Check 3: No remaining 'openclaw' text references ────────────────────────────
echo -e "${WHITE}[3] Residual openclaw references (text scan)${NC}"

# Skip directories that are expected to be pristine/ignored
SKIP_DIRS=(node_modules .git .pnpm-store dist .turbo .build .artifacts coverage)

# Overlay directories that intentionally reference OpenClaw by name
# (e.g. comments documenting the interface boundary to the upstream codebase)
OVERLAY_DIRS=(src/alienclaw)

PRUNE_ARGS=()
for d in "${SKIP_DIRS[@]}"; do
    PRUNE_ARGS+=(-name "$d" -prune -o)
done
# Also prune overlay dirs from the residual scan
for d in "${OVERLAY_DIRS[@]}"; do
    PRUNE_ARGS+=(-path "*/$d" -prune -o)
done

# Binary extensions to skip
SKIP_EXT_RE='\.(png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|otf|mp3|wav|ogg|zip|tar|gz|bz2|xz|7z|bin|exe|node|map|wasm|icns|dylib|so|dll|pdf|lock)$'

RESIDUAL_FILES=()
RESIDUAL_COUNT=0

while IFS= read -r -d '' file; do
    [[ "$file" =~ $SKIP_EXT_RE ]] && continue
    [[ -f "$file" && -r "$file" ]] || continue

    if grep -qE 'openclaw|OpenClaw|OPENCLAW' "$file" 2>/dev/null; then
        RESIDUAL_FILES+=("${file#$TARGET/}")
        RESIDUAL_COUNT=$((RESIDUAL_COUNT + 1))
    fi
done < <(find "$TARGET" \
    "${PRUNE_ARGS[@]}" \
    -type f -print0)

if [[ $RESIDUAL_COUNT -eq 0 ]]; then
    pass "No residual openclaw/OpenClaw/OPENCLAW references found in text files"
else
    fail "$RESIDUAL_COUNT file(s) still contain openclaw references"
    for f in "${RESIDUAL_FILES[@]}"; do
        info "${RED}$f${NC}"
        grep -nE 'openclaw|OpenClaw|OPENCLAW' "$TARGET/$f" 2>/dev/null | head -3 \
            | sed "s/^/        /" || true
    done
fi
echo ""

# ── Check 4: No openclaw filenames remain ───────────────────────────────────────
echo -e "${WHITE}[4] Residual openclaw filenames${NC}"

OLD_NAMES=()
while IFS= read -r -d '' f; do
    OLD_NAMES+=("${f#$TARGET/}")
done < <(find "$TARGET" \
    "${PRUNE_ARGS[@]}" \
    -name '*openclaw*' -type f -print0)

if [[ ${#OLD_NAMES[@]} -eq 0 ]]; then
    pass "No files with openclaw in their name"
else
    fail "${#OLD_NAMES[@]} file(s) still have openclaw in their filename"
    for f in "${OLD_NAMES[@]}"; do
        info "${RED}$f${NC}"
    done
fi
echo ""

# ── Check 5: alienclaw.mjs content spot-check ───────────────────────────────────
echo -e "${WHITE}[5] alienclaw.mjs content${NC}"
MJS="$TARGET/alienclaw.mjs"
if [[ -f "$MJS" ]]; then
    if grep -q 'alienclaw' "$MJS" 2>/dev/null; then
        pass "alienclaw.mjs contains alienclaw references (reskin applied)"
    else
        warn "alienclaw.mjs contains no alienclaw references (may be empty or unusual)"
    fi
    if grep -qE 'openclaw' "$MJS" 2>/dev/null; then
        fail "alienclaw.mjs still contains openclaw references"
        grep -nE 'openclaw' "$MJS" | head -5 | sed "s/^/        /" || true
    else
        pass "alienclaw.mjs: no residual openclaw references"
    fi
fi
echo ""

# ── Check 6: Build (optional) ────────────────────────────────────────────────────
if $SKIP_BUILD; then
    echo -e "${WHITE}[6] Build${NC}"
    warn "Skipped (--skip-build)"
    echo ""
else
    echo -e "${WHITE}[6] Build${NC}"

    # Require pnpm
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
