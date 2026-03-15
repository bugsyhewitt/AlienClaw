#!/usr/bin/env bash
# AlienClaw Phase 1 — Reskin Script (bash / WSL2)
# Usage: ./reskin.sh              # dry-run (shows what will change)
#        ./reskin.sh --execute    # apply changes
#
# Run from repo root: /mnt/c/alienclaw  (or wherever you've mounted it in WSL)

set -euo pipefail

EXECUTE=false
if [[ "${1:-}" == "--execute" ]]; then
    EXECUTE=true
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Skip patterns ─────────────────────────────────────────────────────────────
SKIP_DIRS=("node_modules" ".git" ".pnpm-store" "dist" ".turbo")
SKIP_EXT_RE="\.(png|jpg|jpeg|gif|ico|woff2?|ttf|eot|mp3|wav|zip|tar|gz|bin|exe|node|map)$"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; WHITE='\033[1;37m'; NC='\033[0m'

echo ""
echo -e "${CYAN}AlienClaw Reskin — Phase 1${NC}"
echo "Repo root : $REPO_ROOT"
if $EXECUTE; then
    echo -e "Mode      : ${GREEN}EXECUTE${NC}"
else
    echo -e "Mode      : ${YELLOW}DRY-RUN (no changes written)${NC}"
fi
echo "──────────────────────────────────────────────────────────────────"

# ── Build find -prune args for skip dirs ─────────────────────────────────────
PRUNE_ARGS=()
for d in "${SKIP_DIRS[@]}"; do
    PRUNE_ARGS+=( -name "$d" -prune -o )
done

# ── Replacement function (sed, in-place or dry) ───────────────────────────────
# Order matters: most specific first
do_replacements() {
    local file="$1"
    if $EXECUTE; then
        sed -i \
            -e 's|~/.alienclaw|~/.alienclaw|g' \
            -e 's|ALIENCLAW_HOME|ALIENCLAW_HOME|g' \
            -e 's|ALIENCLAW_|ALIENCLAW_|g' \
            -e 's|AlienClaw|AlienClaw|g' \
            -e 's|ALIENCLAW|ALIENCLAW|g' \
            -e 's|alienclaw|alienclaw|g' \
            -e 's|docs\.alienclaw\.ai|docs.alienclaw.ai|g' \
            "$file"
    else
        grep -nE 'alienclaw|AlienClaw|ALIENCLAW|docs\.alienclaw\.ai' "$file" 2>/dev/null || true
    fi
}

has_match() {
    grep -qE 'alienclaw|AlienClaw|ALIENCLAW|docs\.alienclaw\.ai' "$file" 2>/dev/null
}

# ── 1. Text replacement in all source files ───────────────────────────────────
TOTAL=0; CHANGED=0

while IFS= read -r -d '' file; do
    # skip binary-ish extensions
    if [[ "$file" =~ $SKIP_EXT_RE ]]; then continue; fi
    # skip non-regular or non-readable files
    [[ -f "$file" && -r "$file" ]] || continue

    TOTAL=$((TOTAL+1))

    if has_match; then
        CHANGED=$((CHANGED+1))
        echo -e "  ${WHITE}MODIFY${NC}  ${file#$REPO_ROOT/}"
        do_replacements "$file"
    fi
done < <(find "$REPO_ROOT" \
    "${PRUNE_ARGS[@]}" \
    -type f -print0)

echo ""
echo "── File renames ────────────────────────────────────────────────────"

RENAMED=0

# ── 2. Rename alienclaw.mjs → alienclaw.mjs ────────────────────────────────────
while IFS= read -r -d '' f; do
    dir="$(dirname "$f")"
    newpath="$dir/alienclaw.mjs"
    echo -e "  ${MAGENTA}RENAME${NC}  ${f#$REPO_ROOT/}  →  alienclaw.mjs"
    RENAMED=$((RENAMED+1))
    if $EXECUTE; then mv "$f" "$newpath"; fi
done < <(find "$REPO_ROOT" \
    "${PRUNE_ARGS[@]}" \
    -name 'alienclaw.mjs' -print0)

# ── 3. Rename any other files with 'alienclaw' in their name ──────────────────
while IFS= read -r -d '' f; do
    dir="$(dirname "$f")"
    base="$(basename "$f")"
    newbase="${base//alienclaw/alienclaw}"
    newpath="$dir/$newbase"
    echo -e "  ${MAGENTA}RENAME${NC}  ${f#$REPO_ROOT/}  →  $newbase"
    RENAMED=$((RENAMED+1))
    if $EXECUTE; then mv "$f" "$newpath"; fi
done < <(find "$REPO_ROOT" \
    "${PRUNE_ARGS[@]}" \
    -name '*alienclaw*' ! -name 'alienclaw.mjs' -type f -print0)

# ── 4. package.json — report what the sed pass will have changed ──────────────
echo ""
echo "── package.json ────────────────────────────────────────────────────"
PKG="$REPO_ROOT/package.json"
if [[ -f "$PKG" ]]; then
    if grep -qE '"name".*alienclaw|"bin".*alienclaw' "$PKG"; then
        echo -e "  ${WHITE}package.json name/bin fields will be updated by the sed pass above${NC}"
    else
        echo "  (no alienclaw references in name/bin fields)"
    fi
else
    echo -e "  ${RED}package.json not found${NC}"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "──────────────────────────────────────────────────────────────────"
echo "Files scanned  : $TOTAL"
echo -e "Files to modify: ${YELLOW}$CHANGED${NC}"
echo -e "Files to rename: ${MAGENTA}$RENAMED${NC}"

if $EXECUTE; then
    echo ""
    echo -e "${GREEN}Reskin complete.${NC}"
    echo "Next: pnpm install && pnpm build — then verify with: alienclaw --version"
else
    echo ""
    echo -e "${YELLOW}DRY-RUN complete. No files were changed.${NC}"
    echo -e "${CYAN}Run with --execute to apply:  ./reskin.sh --execute${NC}"
fi
