#!/usr/bin/env bash
# Quick post-install verification. Exit code 0 = all good, non-zero = problem.
set -uo pipefail

OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
AGENTS_ROOT="$OPENCLAW_HOME/agents"
AGENT_IDS=(bossbot advisorbot creatorbot)
EXPECTED=(SOUL.md IDENTITY.md AGENTS.md USER.md TOOLS.md HEARTBEAT.md MEMORY.md)

fail=0

echo "→ Checking agent folders..."
for id in "${AGENT_IDS[@]}"; do
  base="$AGENTS_ROOT/$id"
  [ -d "$base/workspace" ] && base="$base/workspace"
  if [ ! -d "$base" ]; then
    echo "  ✘ MISSING folder: $AGENTS_ROOT/$id"
    fail=1
    continue
  fi
  for f in "${EXPECTED[@]}"; do
    if [ ! -f "$base/$f" ]; then
      echo "  ✘ MISSING: $base/$f"
      fail=1
    fi
  done
done

echo "→ Checking routing (AGENTS.md contents)..."
for id in "${AGENT_IDS[@]}"; do
  base="$AGENTS_ROOT/$id"
  [ -d "$base/workspace" ] && base="$base/workspace"
  a="$base/AGENTS.md"
  [ -f "$a" ] || continue
  case "$id" in
    bossbot)
      grep -qi advisorbot "$a"  || { echo "  ✘ $id AGENTS.md missing advisorbot";  fail=1; }
      grep -qi creatorbot "$a"  || { echo "  ✘ $id AGENTS.md missing creatorbot";  fail=1; }
      ;;
    advisorbot)
      grep -qi bossbot "$a"     || { echo "  ✘ $id AGENTS.md missing bossbot";     fail=1; }
      grep -qi creatorbot "$a"  || { echo "  ✘ $id AGENTS.md missing creatorbot";  fail=1; }
      ;;
    creatorbot)
      grep -qi bossbot "$a"     || { echo "  ✘ $id AGENTS.md missing bossbot";     fail=1; }
      grep -qi advisorbot "$a"  || { echo "  ✘ $id AGENTS.md missing advisorbot";  fail=1; }
      ;;
  esac
done

echo "→ Checking openclaw.json..."
CFG="$OPENCLAW_HOME/openclaw.json"
if [ -f "$CFG" ]; then
  grep -q 'bossbot' "$CFG" || { echo "  ✘ openclaw.json: bossbot workspace not set as default"; fail=1; }
else
  echo "  ✘ openclaw.json not found at $CFG"; fail=1
fi

echo "→ Checking bossbot SOUL explicitly instructs AdvisorBot consults..."
s="$AGENTS_ROOT/bossbot/SOUL.md"
[ -d "$AGENTS_ROOT/bossbot/workspace" ] && s="$AGENTS_ROOT/bossbot/workspace/SOUL.md"
if [ -f "$s" ]; then
  grep -qi 'consult AdvisorBot' "$s" || { echo "  ✘ bossbot SOUL.md does not instruct AdvisorBot consults"; fail=1; }
else
  echo "  ✘ bossbot SOUL.md not found"; fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "✔ All checks passed."
  exit 0
else
  echo "✘ One or more checks failed."
  exit 1
fi
