#!/usr/bin/env bash
# dry_run.sh — rehearse AlienClaw teardown pass 2 on a throwaway worktree.
#
# Usage:
#   bash dry_run.sh [WORKTREE]
#     WORKTREE  a FRESH, CLEAN, detached worktree of origin/main with node_modules
#               present (a symlink to the main checkout's node_modules is fine).
#               Default: /home/xil/dev/alienclaw/.claude/worktrees/pass2-dryrun
#
# Environment:
#   HEAVY    wrapper that gates heavy commands (RAM > 4 GB + shared flock).
#            Default: the session's heavy.sh (see HEAVY_DEFAULT below).
#   LOGDIR   where step logs + summary go. Default: <kit>/last-run (wiped first).
#
# What it does, in order:
#   1. preflight   worktree exists, is clean, has node_modules
#   2. apply       rm every path in delete-list.txt (already-absent paths are fine,
#                  so it works with or without PR #653 merged), prune emptied dirs,
#                  then `git apply` decoupling.patch and ci-pass2.patch (working tree
#                  only: nothing is staged or committed)
#   3. guard       the patched ci.yml still has the three required job names, has no
#                  install-smoke job and no DROP path, contains every command this
#                  script runs (so the rehearsal cannot drift from the workflow), and
#                  has the KEEP TypeScript coverage step inside the TypeScript
#                  typecheck job, with line and branch thresholds
#   4. suites      ONE heavy.sh call re-enters this script with --inner and runs the
#                  CI-equivalent steps of the three required jobs with HOME pointed
#                  at a temp dir (CI's `rm -rf ~/.alienclaw/...` never touches the
#                  real home) and ALIENCLAW_TEST_DB_URL unset (no MySQL here). The
#                  KEEP TypeScript coverage step runs the `run:` block read out of the
#                  patched ci.yml verbatim, thresholds included. One kit-only step
#                  (tag `kit`, not in CI) runs the conformance tests that D-1 keeps.
#   5. summary     per-step PASS/FAIL, test counts, coverage; exit 1 on any failure
#
# Not reproducible here (see README): the MySQL-backed API suites and the
# "Run migrations" steps, the API coverage thresholds (they need the DB), actionlint,
# the shell linter, and the non-required jobs.
#
# Bash 3.2 compatible: no mapfile, no associative arrays, no ${x,,}, no |&.
set -u

KIT_DIR="$(cd "$(dirname "$0")" && pwd)"
HEAVY_DEFAULT=/tmp/claude-1000/-home-xil-dev-alienclaw/8583d279-be75-4906-9885-a0f66a34619d/scratchpad/heavy.sh
HEAVY="${HEAVY:-$HEAVY_DEFAULT}"
REQUIRED_JOBS='TypeScript typecheck|Unit tests|Python lint + test + genome coverage'

die() { echo "dry_run.sh: $*" >&2; exit 2; }

# Coverage floor for a Python module, read from the PATCHED ci.yml: the first
# --cov-fail-under=N at or after the line that carries --cov=<module>.
floor_for() {
  awk -v mod="--cov=$1" '
    index($0, mod) { f = 1 }
    f && match($0, /--cov-fail-under=[0-9]+/) { print substr($0, RSTART + 17, RLENGTH - 17); exit }
  ' "$2/.github/workflows/ci.yml"
}

# The `run: |` body of the ci.yml step named $1, de-indented, so the rehearsal runs
# exactly what CI runs. Prints nothing if the step or its block is missing.
KEEP_TS_STEP='KEEP TypeScript tests with coverage'
ci_run_block() {
  awk -v want="- name: $1" '
    !found { s = $0; sub(/^ +/, "", s); if (s == want) found = 1; next }
    !inrun {
      if ($0 ~ /^ +- name: /) exit
      if ($0 ~ /^ +run: \|$/) { inrun = 1; match($0, /^ +/); ind = RLENGTH }
      next
    }
    {
      if ($0 ~ /^ *$/) { print ""; next }
      match($0, /^ */)
      if (RLENGTH <= ind) exit
      if (!bi) bi = RLENGTH
      print substr($0, bi + 1)
    }
  ' "$2/.github/workflows/ci.yml"
}

# ───────────────────────────── inner: the three required jobs ─────────────────────────────
inner() {
  WT="$1"; LOGDIR="$2"
  ORIG_HOME="$HOME"
  RUN_HOME="$(mktemp -d "${TMPDIR:-/tmp}/pass2-home.XXXXXX")"
  export HOME="$RUN_HOME"
  export PYTHONUSERBASE="${PYTHONUSERBASE:-$ORIG_HOME/.local}"   # user-site packages
  export npm_config_cache="${npm_config_cache:-$ORIG_HOME/.npm}"
  unset ALIENCLAW_TEST_DB_URL ALIENCLAW_HOME
  GENOME_FLOOR="$(floor_for alienclaw.genome "$WT")"
  EVO_FLOOR="$(floor_for alienclaw.evolution "$WT")"
  DIAG_FLOOR="$(floor_for alienclaw.diagnostics "$WT")"
  N=0

  step() {  # step <job-tag> <step name> <command...>
    _job="$1"; _name="$2"; shift 2
    N=$((N + 1))
    _log="$LOGDIR/$(printf '%02d' "$N")-$_job.log"
    printf '>>> [%s] %s\n' "$_job" "$_name"
    _t0=$(date +%s)
    ( cd "$WT" && "$@" ) >"$_log" 2>&1
    _rc=$?
    _dt=$(( $(date +%s) - _t0 ))
    printf '%s\t%s\t%s\t%s\t%s\n' "$_job" "$_name" "$_rc" "${_dt}s" "$_log" >> "$LOGDIR/status.tsv"
    if [ "$_rc" -eq 0 ]; then echo "    PASS (${_dt}s)"; else echo "    FAIL rc=$_rc (${_dt}s) — see $_log"; fi
  }

  py_validate_fixture() {
    python3 -c "
import json
with open('test/fixtures/genome-spec-fixtures.json') as f:
    data = json.load(f)
assert 'cases' in data, 'fixture missing cases array'
assert len(data['cases']) >= 50, f'fewer than 50 cases: {len(data[\"cases\"])}'
assert data.get('\$schema_version') == '1.0', 'fixture schema version unexpected'
print(f'Fixture OK: {len(data[\"cases\"])} cases')
"
  }
  py_evolution() {
    rm -rf "$HOME/.alienclaw/populations/"
    PYTHONPATH=src pytest test/evolution/ --cov=alienclaw.evolution --cov-report=term-missing \
      --cov-fail-under="$EVO_FLOOR" -q
  }
  py_leak_check() {
    if [ -d "$HOME/.alienclaw/populations/" ]; then
      echo "FAIL: tests left ~/.alienclaw/populations/ behind"; ls -la "$HOME/.alienclaw/populations/"; return 1
    fi
    echo "Leak check: OK — no leftover directories"
  }
  py_diagnostics() {
    rm -rf "$HOME/.alienclaw/diagnostics/"
    PYTHONPATH=src pytest test/diagnostics/ --cov=alienclaw.diagnostics --cov-report=term-missing \
      --cov-fail-under="$DIAG_FLOOR" -q || return $?
    if [ -d "$HOME/.alienclaw/diagnostics/" ]; then
      echo "FAIL: diagnostics tests left ~/.alienclaw/diagnostics/ behind"; return 1
    fi
  }

  echo "inner: HOME=$HOME  floors genome=$GENOME_FLOOR evolution=$EVO_FLOOR diagnostics=$DIAG_FLOOR"

  # Job: TypeScript typecheck  (the two migration/API steps need MySQL; see below)
  step ts "Typecheck" npx tsc --noEmit
  step ts "Cross-language genome spec compliance (TypeScript side)" \
    npx vitest run test/genome/ts-fixture-runner.test.ts
  step ts "$KEEP_TS_STEP (run: block from ci.yml)" bash -c "$(ci_run_block "$KEEP_TS_STEP" "$WT")"
  step ts "API surface tests (DB-less: coverage REPORTED, thresholds NOT enforced)" \
    npx vitest run test/api/ --no-file-parallelism --coverage --coverage.provider=v8 \
      --coverage.reporter=text-summary '--coverage.include=src/alienclaw/api/**'

  # Job: Unit tests  (migrations step needs MySQL; DB-backed suites self-skip)
  step unit "Run tests" npx vitest run --reporter=verbose --no-file-parallelism

  # Job: Python lint + test + genome coverage
  step py "Validate fixture file" py_validate_fixture
  step py "Lint Python files" ruff check src/alienclaw/genome/ test/genome/
  step py "Test genome module with coverage" env PYTHONPATH=src pytest test/genome/ \
    --cov=alienclaw.genome --cov-report=term-missing --cov-fail-under="$GENOME_FLOOR" -q
  step py "Lint evolution module" ruff check src/alienclaw/evolution/ test/evolution/
  step py "Run evolution tests with coverage" py_evolution
  step py "Verify no leak directories" py_leak_check
  step py "Run diagnostics tests with coverage" py_diagnostics
  step py "Web search backend test" env PYTHONPATH=src pytest test/tools/test_web_search_backend.py -v

  # Kit-only, not a CI step: D-1 keeps fitness/conformance.py, and its tests sit outside
  # CI's pytest scope, so the rehearsal runs them (and the rest of test/fitness/) here.
  step kit "Conformance + fitness tests (not in CI)" env PYTHONPATH=src pytest test/fitness/ \
    test/tools/test_pkt087_extract_json_empty_extracted.py \
    --cov=alienclaw.fitness.conformance --cov-report=term-missing -q

  rm -rf "$RUN_HOME"
  return 0
}

if [ "${1:-}" = "--inner" ]; then
  inner "$2" "$3"
  exit $?
fi

# ───────────────────────────── outer ─────────────────────────────
WT="${1:-/home/xil/dev/alienclaw/.claude/worktrees/pass2-dryrun}"
LOGDIR="${LOGDIR:-$KIT_DIR/last-run}"
STARTED="$(date '+%Y-%m-%d %H:%M:%S %Z')"

# 1. preflight
[ -d "$WT" ] || die "worktree not found: $WT"
git -C "$WT" rev-parse --git-dir >/dev/null 2>&1 || die "not a git worktree: $WT"
[ -z "$(git -C "$WT" status --porcelain)" ] || die "worktree is not clean: $WT (use a fresh one)"
[ -e "$WT/node_modules/.bin/vitest" ] || die "no node_modules in $WT (symlink the main checkout's)"
[ -x "$HEAVY" ] || die "HEAVY wrapper not executable: $HEAVY"
for f in delete-list.txt decoupling.patch ci-pass2.patch; do
  [ -f "$KIT_DIR/$f" ] || die "missing kit file: $KIT_DIR/$f"
done
HEAD_SHA="$(git -C "$WT" rev-parse HEAD)"
rm -rf "$LOGDIR"; mkdir -p "$LOGDIR"
: > "$LOGDIR/status.tsv"
echo "dry_run.sh: worktree=$WT head=$HEAD_SHA started=$STARTED"

# 2. apply
removed=0; absent=0
while IFS= read -r p || [ -n "$p" ]; do
  case "$p" in ''|'#'*) continue ;; esac
  case "$p" in /*|*..*) die "refusing suspicious path in delete-list: $p" ;; esac
  if [ -e "$WT/$p" ] || [ -L "$WT/$p" ]; then
    rm -f "$WT/$p" || die "rm failed: $p"
    removed=$((removed + 1))
    d="$(dirname "$p")"
    while [ "$d" != "." ] && rmdir "$WT/$d" 2>/dev/null; do d="$(dirname "$d")"; done
  else
    absent=$((absent + 1))
  fi
done < "$KIT_DIR/delete-list.txt"
echo "apply: delete-list removed=$removed already-absent=$absent"
for patch in decoupling.patch ci-pass2.patch; do
  git -C "$WT" apply --check "$KIT_DIR/$patch" || die "git apply --check failed: $patch"
  git -C "$WT" apply "$KIT_DIR/$patch" || die "git apply failed: $patch"
  echo "apply: $patch OK"
done

# 3. guard
CI="$WT/.github/workflows/ci.yml"
guard_fail=0
OLDIFS="$IFS"; IFS='|'
for j in $REQUIRED_JOBS; do
  grep -qF "    name: $j" "$CI" || { echo "guard: required job name missing: $j"; guard_fail=1; }
done
IFS="$OLDIFS"
if grep -qE '^  install-smoke:' "$CI"; then echo "guard: install-smoke job still present"; guard_fail=1; fi
if grep -nE 'test/(brains|governance|martians|bridge|msb|wiring|cli|agents)/|seed/|site/|install\.sh|alienclaw\.brains|specialists/' "$CI"; then
  echo "guard: DROP reference still in ci.yml (lines above)"; guard_fail=1
fi
for c in 'npx tsc --noEmit' \
         'npx vitest run test/genome/ts-fixture-runner.test.ts' \
         'npx vitest run test/api/' \
         'npx vitest run --reporter=verbose --no-file-parallelism' \
         'ruff check src/alienclaw/genome/ test/genome/' \
         'PYTHONPATH=src pytest test/genome/' \
         'ruff check src/alienclaw/evolution/ test/evolution/' \
         'pytest test/evolution/' \
         'pytest test/diagnostics/' \
         'pytest test/tools/test_web_search_backend.py -v'; do
  grep -qF -- "$c" "$CI" || { echo "guard: ci.yml no longer contains: $c"; guard_fail=1; }
done
for m in alienclaw.genome alienclaw.evolution alienclaw.diagnostics; do
  fl="$(floor_for "$m" "$WT")"
  [ -n "$fl" ] || { echo "guard: no --cov-fail-under found for $m"; guard_fail=1; }
done
# The KEEP TypeScript gate must sit inside the required "TypeScript typecheck" job
# (from its name line up to the next top-level job key) and carry both thresholds.
awk '/^    name: TypeScript typecheck$/ { f = 1; next } f && /^  [A-Za-z0-9_-]+:$/ { exit } f' "$CI" \
  | grep -qF -- "- name: $KEEP_TS_STEP" \
  || { echo "guard: '$KEEP_TS_STEP' step missing from the TypeScript typecheck job"; guard_fail=1; }
KEEP_TS_BLOCK="$(ci_run_block "$KEEP_TS_STEP" "$WT")"
for c in 'npx vitest run' '--coverage.thresholds.lines=' '--coverage.thresholds.branches=' \
         '--coverage.include="src/alienclaw/net/**"'; do
  printf '%s\n' "$KEEP_TS_BLOCK" | grep -qF -- "$c" \
    || { echo "guard: '$KEEP_TS_STEP' run block lacks: $c"; guard_fail=1; }
done
[ "$guard_fail" -eq 0 ] && echo "guard: ci.yml OK (3 required jobs, no DROP refs, commands in sync, KEEP TS gate in place)"

# 4. suites — one heavy.sh call for everything
"$HEAVY" bash "$KIT_DIR/dry_run.sh" --inner "$WT" "$LOGDIR"
heavy_rc=$?

# 5. summary
strip() { tr -d '\033' < "$1" | sed 's/\[[0-9;]*m//g'; }
{
  echo "AlienClaw teardown pass 2 — dry run"
  echo "started:  $STARTED"
  echo "finished: $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "worktree: $WT @ $HEAD_SHA"
  echo "delete-list: removed=$removed already-absent=$absent; patches applied: decoupling.patch, ci-pass2.patch"
  echo "guard: $([ "$guard_fail" -eq 0 ] && echo PASS || echo FAIL)   heavy.sh rc=$heavy_rc"
  echo
  fails=0
  while IFS="$(printf '\t')" read -r job name rc dt log; do
    [ -n "$job" ] || continue
    if [ "$rc" -eq 0 ]; then st=PASS; else st="FAIL(rc=$rc)"; fails=$((fails + 1)); fi
    detail=""
    vt="$(strip "$log" | grep -E '^ +Tests +[0-9]' | tail -1 | sed 's/^ *//')"
    vf="$(strip "$log" | grep -E '^ +Test Files +[0-9]' | tail -1 | sed 's/^ *//')"
    pt="$(strip "$log" | grep -E '[0-9]+ (passed|failed|error)' | tail -1 | sed 's/=//g; s/^ *//; s/ *$//')"
    cv="$(strip "$log" | grep -E '^TOTAL ' | tail -1 | awk '{print "coverage " $NF}')"
    vc="$(strip "$log" | grep -E '^(Statements|Branches|Lines) +:' | sed 's/ *: */ /' | awk '{printf "%s %s; ", $1, $2}')"
    va="$(strip "$log" | grep -E '^All files +\|' | tail -1 \
          | awk -F'|' '{for (i = 2; i <= 5; i++) gsub(/ /, "", $i); printf "Statements %s%%; Branches %s%%; Lines %s%%; ", $2, $3, $5}')"
    if [ -n "$vt" ]; then detail="$vf | $vt"; elif [ -n "$pt" ]; then detail="$pt"; fi
    [ -n "$cv" ] && detail="$detail | $cv"
    [ -n "$vc" ] && detail="$detail | v8: $vc"
    [ -z "$vc" ] && [ -n "$va" ] && detail="$detail | v8: $va"
    printf '%-5s %-14s %-72s %6s  %s\n' "$job" "$st" "$name" "$dt" "$detail"
  done < "$LOGDIR/status.tsv"
  echo
  echo "NOT RUN here (need MySQL / other tooling): 'Run migrations' + API coverage thresholds"
  echo "(lines 75 / branches 63) in TypeScript typecheck; 'Run migrations' in Unit tests (DB suites"
  echo "self-skip without ALIENCLAW_TEST_DB_URL); actionlint; shellcheck; non-required jobs."
  echo "floors enforced (from patched ci.yml): genome=$(floor_for alienclaw.genome "$WT") evolution=$(floor_for alienclaw.evolution "$WT") diagnostics=$(floor_for alienclaw.diagnostics "$WT")"
  echo "KEEP TS thresholds (from patched ci.yml): $(printf '%s\n' "$KEEP_TS_BLOCK" | grep -oE 'thresholds\.(lines|branches)=[0-9]+' | sed 's/thresholds\.//' | tr '\n' ' ')"
  echo "'kit' rows are the kit's own checks, not CI steps."
  echo "logs: $LOGDIR"
  if [ "$fails" -eq 0 ] && [ "$guard_fail" -eq 0 ] && [ "$heavy_rc" -eq 0 ]; then
    echo "RESULT: GREEN"
  else
    echo "RESULT: RED (failed steps=$fails guard=$guard_fail heavy_rc=$heavy_rc)"
  fi
} | tee "$LOGDIR/summary.txt"

grep -q '^RESULT: GREEN' "$LOGDIR/summary.txt"
