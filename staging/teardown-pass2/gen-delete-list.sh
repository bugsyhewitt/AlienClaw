#!/usr/bin/env bash
# gen-delete-list.sh — regenerate delete-list.txt for AlienClaw teardown pass 2.
#
# Usage: bash gen-delete-list.sh [REPO] [BASE_REF] [PASS1_REF] > delete-list.txt
#   REPO       any checkout of the AlienClaw repo   (default: /home/xil/dev/alienclaw)
#   BASE_REF   tree the list is expanded against    (default: origin/main)
#   PASS1_REF  pass-1 branch, for its deleted files (default: origin/chore/teardown-pass1)
#
# Output: one tracked file path per line, sorted, unique. It is the union of
#   (a) the pass-2 DROP pathspecs below, expanded with `git ls-tree` at BASE_REF, and
#   (b) every file PASS1_REF deletes relative to BASE_REF (so the kit works whether
#       or not PR #653 merges first), plus seed/martians/.gitkeep, which pass 1 adds.
# Bash 3.2 compatible (no mapfile, no associative arrays).
set -eu

REPO="${1:-/home/xil/dev/alienclaw}"
BASE="${2:-origin/main}"
PASS1="${3:-origin/chore/teardown-pass1}"

# Directories / files that pass 2 deletes outright (DROP), relative to repo root.
DROP_SPECS='
src/alienclaw/governance
src/alienclaw/agents
src/alienclaw/brains
src/alienclaw/martians
src/alienclaw/comms
src/alienclaw/bridge
src/alienclaw/cli
src/alienclaw/wiring
src/alienclaw/msb
src/alienclaw/config
src/alienclaw/prompts
src/alienclaw/registry/index.ts
src/alienclaw/registry/martian-registry.ts
src/alienclaw/registry/ms-loader.ts
src/alienclaw/registry/ms-types.ts
src/alienclaw/registry/registry.ts
src/alienclaw/registry/seed-installer.ts
src/alienclaw/registry-bootstrap.ts
src/alienclaw/types.ts
src/alienclaw/evolution/bridge_runner.py
src/alienclaw/evolution/live_evo.py
src/alienclaw/diagnostics/composition_decoder_audit.py
src/alienclaw/diagnostics/synthetic_compositions.py
src/alienclaw/diagnostics/sensitivity_audit.py
src/alienclaw/diagnostics/scaling_experiment.py
seed
site
scripts/check-seed-drift.sh
scripts/gen-seed-genomes.py
scripts/run_packet25_experiments.py
scripts/run_packet28_rerun.py
scripts/deploy.sh
scripts/local-preview.sh
test/governance
test/agents
test/brains
test/martians
test/comms
test/bridge
test/cli
test/config
test/wiring
test/msb
test/site
test/integration
test/registry/martian-registry.test.ts
test/registry/ms-loader-strict-metadata.test.ts
test/registry/ms-loader.test.ts
test/registry/registry-bootstrap.test.ts
test/registry/registry.test.ts
test/registry/seed-installer-edge-cases.test.ts
test/registry/seed-installer-pad64.test.ts
test/registry/seed-installer.test.ts
test/brain-composition.test.ts
test/cli-args.test.ts
test/decide_null_check.test.ts
test/rule5-channel-isolation.test.ts
test/helpers/agent-channel-cleanup.ts
test/fixtures/brain-registry-fixtures.json
test/fixtures/martian-registry-fixtures.json
test/fixtures/martian-substitution-fixtures.json
test/fixtures/bridge-fixture.json
test/fixtures/test-goals
test/evolution/test_bridge_runner.py
test/evolution/test_end_to_end.py
test/evolution/test_composition_evolution.py
test/evolution/test_live_evo.py
test/evolution/test_main_cli.py
test/diagnostics/test_composition_decoder_audit.py
test/diagnostics/test_synthetic_compositions.py
test/diagnostics/test_sensitivity_audit.py
test/diagnostics/test_martian_sensitivity_audit.py
test/diagnostics/test_scaling_experiment.py
test/diagnostics/test_instrumentation.py
'
# Not listed on purpose (D-1, resolved KEEP): src/alienclaw/fitness/conformance.py and
# its tests (test/fitness/test_conformance.py, test/fitness/test_field_valid_branches.py,
# test/tools/test_pkt087_extract_json_empty_extracted.py). decoupling.patch makes the
# scorer take its contracts as an explicit input, so it survives seed/msb/ going.

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

for spec in $DROP_SPECS; do
  git -C "$REPO" ls-tree -r --name-only "$BASE" -- "$spec" >> "$TMP"
done

if git -C "$REPO" rev-parse --verify --quiet "$PASS1" >/dev/null; then
  git -C "$REPO" diff --name-only --diff-filter=D "$BASE" "$PASS1" >> "$TMP"
  echo "seed/martians/.gitkeep" >> "$TMP"
else
  echo "gen-delete-list.sh: warning: $PASS1 not found; pass-1 paths omitted" >&2
fi

LC_ALL=C sort -u "$TMP"
