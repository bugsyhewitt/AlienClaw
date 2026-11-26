# pho3nix_tuner — AlienClaw × Pho3nix GA PoC

**Phase 3 of the AlienClaw repurpose roadmap.** Offline profile tuner: evolves Pho3nix
tool parameter profiles using AlienClaw's GA, scored by a reward model fit from real
rig run-history imported from xil-1 or sentry.

## Why offline?

Pho3nix scans are slow, side-effecting, scope-gated, and non-reproducible. A live
generational GA against real targets is impractical and legally fraught. Instead, the tuner
learns from *past* runs: what parameter values correlated with success, low timeout rate,
and fast completion on each tool × target-class context.

## What it optimises

**Reliability / efficiency** (not bug-discovery — `run_history` doesn't record findings):
- `gobuster`: threads, delay_ms, timeout_sec
- `nmap`: timing template (-T2 to -T5)

Gene space = intersection of `optimization_profiles` params ∩ `rebuild_command_with_params`
applicable params. sqlmap level/risk are documented in `tooltime_bounds.py` but NOT evolvable
(rebuild doesn't apply them).

## Setup (Step 0 — user must do this)

```bash
# Import real rig history from xil-1 (100.118.41.60) or sentry (100.79.87.69)
rsync -av xil-1:~/.pho3nix_data/history/run_history.json \
      pho3nix_tuner/data/run_history.xil-1.json

# Optionally also import tool stats context
rsync -av xil-1:~/.pho3nix_data/stats/tool_stats_context.json \
      pho3nix_tuner/data/tool_stats_context.xil-1.json
```

## Step 1: Pre-flight inspection (run this first — it's the STOP gate)

```bash
python pho3nix_tuner/inspect_history.py pho3nix_tuner/data/run_history.xil-1.json
```

This checks: target tool rows ≥ 20, timestamps present, ≥ 2 distinct param signatures
per context. If any check fails: **STOP** — the data doesn't have enough counterfactuals
to learn from. Alfred's local `~/.pho3nix_data/history/run_history.json` will correctly
trip this gate (synthetic smoke-test noise, 0% success, no timestamps, no nmap/gobuster).

## Running the GA

```bash
python pho3nix_tuner/run_ga.py \
    --history pho3nix_tuner/data/run_history.xil-1.json \
    --tool gobuster \
    --context gobuster|https \
    --pop-size 12 \
    --generations 5
```

## Gene schema

Stored in EXECUTION slot (slot_index=1), Xcodes 0–3. ID tag: `PHO00001`.

| Xcode | Param        | Range      | Meaning                                      |
|-------|-------------|------------|----------------------------------------------|
| 0     | threads     | [5, 50]    | gobuster parallel threads                    |
| 1     | delay_ms    | [0, 1000]  | gobuster request delay (ms → "Xs" string)    |
| 2     | timeout_sec | [5, 30]    | gobuster/nmap timeout in seconds             |
| 3     | timing_t    | [2, 5]     | nmap timing template (-T2 to -T5)            |

## Gate (success bar)

The evolved profile must beat ALL three hand-authored baseline profiles (stealth/normal/
aggressive) on the **held-out** (newest 25% by timestamp) reward slice, evaluated
per-context. Reward = success minus timeout/partial penalties.

## Tooltime bounds

```bash
python pho3nix_tuner/tooltime_bounds.py        # print bounds table
python pho3nix_tuner/tooltime_bounds.py --all  # include documented-only params
python pho3nix_tuner/tooltime_bounds.py --json # machine-readable output
```

## Execution boundary

**Now (no rig data needed):** scaffold + self-test. `inspect_history.py` and `run_ga.py --dry-run`
against Alfred's synthetic history confirm the STOP gate fires correctly.

**Blocked on user Step 0:** real GA run + held-out gate PASS require a rig dump with genuine
param variation and timestamps.
