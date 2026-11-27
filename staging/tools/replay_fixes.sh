#!/usr/bin/env bash
# Replay the in-tree fix commits from overnight/2026-11-26 onto the current branch, keeping
# only their src/, test/ and .gitignore changes (a few of them also touch staging/, which
# does not exist on main). Each replayed commit reuses the original message and author.
# Usage, on a clean branch made from origin/main:
#   git switch -c fix/overnight-2026-11-26 origin/main
#   bash <path-to-overnight-checkout>/staging/tools/replay_fixes.sh
# The Miller-Madow MI commit (ad784b98) and its revert (7353747d) are deliberately left out.
set -eu
COMMITS="7fa90aa3 c4527f06 2601a4b8 cfbeb8ac 83136f28 6e671b21 fa2ef841 29a0746d d18c5c5d
66292280 751f2058 a6165101 8d66853c"
for c in $COMMITS; do
  if git diff --quiet "$c^" "$c" -- src test .gitignore; then
    echo "skip    $c (no in-tree change)"
    continue
  fi
  git diff --binary "$c^" "$c" -- src test .gitignore | git apply --index --3way
  git commit -q -C "$c"
  echo "applied $c  $(git log -1 --format=%s "$c")"
done
