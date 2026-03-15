#!/usr/bin/env bash
# installer/scripts/reskin.sh
#
# Applies the AlienClaw brand reskin to a working copy of OpenClaw source.
# This is the canonical record of EVERY modification AlienClaw makes to OpenClaw.
#
# Usage:
#   installer/scripts/reskin.sh --target <dir>              # dry-run (default)
#   installer/scripts/reskin.sh --target <dir> --execute    # apply all changes
#
# Rules:
#   - Only operates on --target <dir>. Never touches vendor/openclaw or src/alienclaw.
#   - Idempotent: safe to run on an already-reskinned directory (no-ops cleanly).
#   - Portable: bash 3.2+ (macOS), bash 4+ (Linux / WSL2).
#
# Substitution map (three mutually exclusive character-class patterns; any order is safe):
#   OpenClaw   -> AlienClaw     (title-case: capital O + capital C)
#   OPENCLAW   -> ALIENCLAW     (all-caps: covers OPENCLAW_HOME, OPENCLAW_*, etc.)
#   openclaw   -> alienclaw     (lowercase: covers ~/.openclaw, docs.openclaw.ai, pkg names)
#
# File rename:
#   openclaw.mjs -> alienclaw.mjs   (entry-point binary)
#   *openclaw*   -> *alienclaw*     (any other file whose name contains "openclaw")

set -euo pipefail

# ── Argument parsing ────────────────────────────────────────────────────────────
TARGET=""
EXECUTE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target)
            TARGET="${2:?'--target requires a directory path'}"
            shift 2
            ;;
        --execute)
            EXECUTE=true
            shift
            ;;
        -h|--help)
            sed -n '2,30p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'
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
    echo "usage: $0 --target <dir> [--execute]" >&2
    exit 1
fi

TARGET="$(cd "$TARGET" && pwd)"

if [[ ! -d "$TARGET" ]]; then
    echo "error: target directory does not exist: $TARGET" >&2
    exit 1
fi

# ── sed portability (BSD macOS vs GNU Linux/WSL) ────────────────────────────────
if sed --version >/dev/null 2>&1; then
    # GNU sed
    SED_INPLACE() { sed -i "$@"; }
else
    # BSD sed (macOS)
    SED_INPLACE() { sed -i '' "$@"; }
fi

# ── Colours ─────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; WHITE='\033[1;37m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; CYAN=''; MAGENTA=''; WHITE=''; NC=''
fi

# ── Skip configuration ──────────────────────────────────────────────────────────
# Directories: skip entirely (prune from find)
SKIP_DIRS=(node_modules .git .pnpm-store dist .turbo .build .artifacts coverage)

# File extensions: binary/non-text files that sed must never touch
SKIP_EXT_RE='\.(png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|otf|mp3|wav|ogg|zip|tar|gz|bz2|xz|7z|bin|exe|node|map|wasm|icns|dylib|so|dll|pdf|lock)$'

# ── Header ───────────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         AlienClaw Reskin — installer/scripts/reskin.sh       ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  Target : $TARGET"
if $EXECUTE; then
    echo -e "  Mode   : ${GREEN}EXECUTE — changes will be written${NC}"
else
    echo -e "  Mode   : ${YELLOW}DRY-RUN — no files modified (pass --execute to apply)${NC}"
fi
echo ""
echo -e "${WHITE}── Text replacements ───────────────────────────────────────────${NC}"

# ── Build find -prune args ──────────────────────────────────────────────────────
PRUNE_ARGS=()
for d in "${SKIP_DIRS[@]}"; do
    PRUNE_ARGS+=(-name "$d" -prune -o)
done

# ── Idempotency guard ───────────────────────────────────────────────────────────
# A file that still contains "openclaw" needs processing.
# A file where the only matches are already "alienclaw" is already done.
needs_reskin() {
    local file="$1"
    grep -qE 'openclaw|OpenClaw|OPENCLAW' "$file" 2>/dev/null
}

# ── Apply substitutions to a single file ───────────────────────────────────────
apply_subs() {
    local file="$1"
    SED_INPLACE \
        -e 's/OpenClaw/AlienClaw/g' \
        -e 's/OPENCLAW/ALIENCLAW/g' \
        -e 's/openclaw/alienclaw/g' \
        "$file"
}

# ── 1. Text replacements ────────────────────────────────────────────────────────
TOTAL=0
CHANGED=0
SKIPPED_BINARY=0

while IFS= read -r -d '' file; do
    # Skip binary extensions
    if [[ "$file" =~ $SKIP_EXT_RE ]]; then
        SKIPPED_BINARY=$((SKIPPED_BINARY + 1))
        continue
    fi
    # Must be a readable regular file
    [[ -f "$file" && -r "$file" ]] || continue

    TOTAL=$((TOTAL + 1))

    if needs_reskin "$file"; then
        CHANGED=$((CHANGED + 1))
        rel="${file#$TARGET/}"
        echo -e "  ${WHITE}MODIFY${NC}  $rel"

        if $EXECUTE; then
            apply_subs "$file"
        else
            # Dry-run: show what would change (first 5 matching lines)
            grep -nE 'openclaw|OpenClaw|OPENCLAW' "$file" 2>/dev/null | head -5 \
                | sed "s/^/         ${YELLOW}/" | sed "s/$/${NC}/" || true
        fi
    fi
done < <(find "$TARGET" \
    "${PRUNE_ARGS[@]}" \
    -type f -print0)

# ── 2. File renames ─────────────────────────────────────────────────────────────
echo ""
echo -e "${WHITE}── File renames ────────────────────────────────────────────────${NC}"
RENAMED=0

# Rename openclaw.mjs -> alienclaw.mjs first (exact match, before wildcard)
while IFS= read -r -d '' f; do
    dir="$(dirname "$f")"
    newpath="$dir/alienclaw.mjs"
    rel="${f#$TARGET/}"
    echo -e "  ${MAGENTA}RENAME${NC}  $rel  →  alienclaw.mjs"
    RENAMED=$((RENAMED + 1))
    if $EXECUTE; then mv "$f" "$newpath"; fi
done < <(find "$TARGET" \
    "${PRUNE_ARGS[@]}" \
    -name 'openclaw.mjs' -type f -print0)

# Rename any other FILE whose name contains 'openclaw', 'OpenClaw', or 'OPENCLAW'
# (all three case variants — the bash substitution handles them all)
while IFS= read -r -d '' f; do
    dir="$(dirname "$f")"
    base="$(basename "$f")"
    newbase="${base//OpenClaw/AlienClaw}"
    newbase="${newbase//OPENCLAW/ALIENCLAW}"
    newbase="${newbase//openclaw/alienclaw}"
    if [[ "$newbase" == "$base" ]]; then continue; fi
    newpath="$dir/$newbase"
    rel="${f#$TARGET/}"
    echo -e "  ${MAGENTA}RENAME${NC}  $rel  →  $newbase"
    RENAMED=$((RENAMED + 1))
    if $EXECUTE; then mv "$f" "$newpath"; fi
done < <(find "$TARGET" \
    "${PRUNE_ARGS[@]}" \
    \( -name '*openclaw*' -o -name '*OpenClaw*' -o -name '*OPENCLAW*' \) \
    ! -name 'openclaw.mjs' -type f -print0)

# Rename DIRECTORIES that contain 'openclaw', 'OpenClaw', or 'OPENCLAW' in their name.
# Must be processed bottom-up (deepest path first) so renaming a parent doesn't
# invalidate children that haven't been renamed yet. We achieve this by sorting
# the null-delimited list by path length descending before processing.
while IFS= read -r -d '' d; do
    dir="$(dirname "$d")"
    base="$(basename "$d")"
    newbase="${base//OpenClaw/AlienClaw}"
    newbase="${newbase//OPENCLAW/ALIENCLAW}"
    newbase="${newbase//openclaw/alienclaw}"
    if [[ "$newbase" == "$base" ]]; then continue; fi
    newpath="$dir/$newbase"
    rel="${d#$TARGET/}"
    echo -e "  ${MAGENTA}RENAME-DIR${NC}  $rel/  →  $newbase/"
    RENAMED=$((RENAMED + 1))
    if $EXECUTE; then mv "$d" "$newpath"; fi
done < <(find "$TARGET" \
    "${PRUNE_ARGS[@]}" \
    \( -name '*openclaw*' -o -name '*OpenClaw*' -o -name '*OPENCLAW*' \) \
    -type d -print0 \
    | tr '\0' '\n' | awk '{print length, $0}' | sort -rn | cut -d' ' -f2- \
    | tr '\n' '\0')

# ── 3. Normalize workspace references in package.json files ─────────────────────
# After the main sed pass, any internal dep that was "openclaw": ">=x.y.z" is now
# "alienclaw": ">=x.y.z". pnpm 10+ requires workspace:* protocol for local packages;
# bare version ranges go to the registry and 404. Fix: rewrite all versioned alienclaw
# peer/dev/deps to "workspace:*".
echo ""
echo -e "${WHITE}── Workspace ref normalization ─────────────────────────────────${NC}"
WS_FIXED=0

while IFS= read -r -d '' pkgfile; do
    # Match "alienclaw": "<version-starting-with >=^~0-9>" (not already workspace:*)
    if grep -qE '"alienclaw"[[:space:]]*:[[:space:]]*"[>=^~0-9]' "$pkgfile" 2>/dev/null; then
        rel="${pkgfile#$TARGET/}"
        echo -e "  ${WHITE}WS-FIX${NC}  $rel"
        WS_FIXED=$((WS_FIXED + 1))
        if $EXECUTE; then
            SED_INPLACE \
                -e 's|"alienclaw"\([[:space:]]*\):\([[:space:]]*\)"[>=^~][^"]*"|"alienclaw"\1:\2"workspace:*"|g' \
                -e 's|"alienclaw"\([[:space:]]*\):\([[:space:]]*\)"[0-9][^"]*"|"alienclaw"\1:\2"workspace:*"|g' \
                "$pkgfile"
        fi
    fi
done < <(find "$TARGET" \
    "${PRUNE_ARGS[@]}" \
    -name 'package.json' -type f -print0)

if [[ $WS_FIXED -eq 0 ]]; then
    echo -e "  (no versioned alienclaw deps found — nothing to normalize)"
fi

# ── 4. package.json spot-check ──────────────────────────────────────────────────
echo ""
echo -e "${WHITE}── package.json verification ───────────────────────────────────${NC}"
PKG="$TARGET/package.json"
if [[ -f "$PKG" ]]; then
    if $EXECUTE; then
        # After text-replacement pass above, check the result
        name_val="$(grep '"name"' "$PKG" | head -1 | sed 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
        bin_val="$(grep '"alienclaw"' "$PKG" | head -1 || echo '(not found)')"
        if [[ "$name_val" == "alienclaw" ]]; then
            echo -e "  ${GREEN}OK${NC}  name = \"$name_val\""
        else
            echo -e "  ${RED}WARN${NC}  name = \"$name_val\" (expected alienclaw)"
        fi
        if grep -q '"alienclaw"' "$PKG"; then
            echo -e "  ${GREEN}OK${NC}  bin key contains alienclaw"
        else
            echo -e "  ${RED}WARN${NC}  bin key does not contain alienclaw"
        fi
    else
        echo -e "  ${YELLOW}DRY-RUN${NC}  Would update name/bin/cli-entry fields via sed pass above"
        grep -E '"name"|"bin"|"cli-entry"|"openclaw"' "$PKG" | head -8 \
            | sed "s/^/         ${YELLOW}/" | sed "s/$/${NC}/" || true
    fi
else
    echo -e "  ${RED}WARN${NC}  package.json not found at target root"
fi

# ── Summary ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${WHITE}──────────────────────────────────────────────────────────────────${NC}"
printf "  Files scanned   : %d\n" "$TOTAL"
printf "  Binary skipped  : %d\n" "$SKIPPED_BINARY"
echo -e "  Text modified   : ${YELLOW}$CHANGED${NC}"
echo -e "  Files renamed   : ${MAGENTA}$RENAMED${NC}"
echo -e "  WS refs fixed   : ${CYAN}$WS_FIXED${NC}"
echo ""

if $EXECUTE; then
    echo -e "${GREEN}Reskin applied successfully.${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. cd $TARGET"
    echo "  2. pnpm install"
    echo "  3. pnpm build"
    echo "  4. installer/scripts/verify.sh --target $TARGET --skip-build"
else
    echo -e "${YELLOW}DRY-RUN complete — no files were modified.${NC}"
    echo ""
    echo -e "To apply:  $0 --target $TARGET --execute"
fi
echo ""
