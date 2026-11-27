# pho3nix-tuner (staging)

An offline genetic algorithm that tunes Pho3nix recon-tool profiles (gobuster threads,
delay and timeout, plus the nmap timing template) from Pho3nix run history imported
from a rig. It scores candidate configs with a reward model fit to past runs: success
counts for, timeouts and partial results count against. It never runs a scan.

This is a **copy** of the in-tree `pho3nix_tuner/` (Phase 3 of the AlienClaw repurpose),
re-pointed at the staged GA engine `alienclaw_ga` (`staging/ga-engine`). The in-tree
package is untouched, and nothing has moved to Pho3nix. A later lift into the Pho3nix
repo needs the owner's go-ahead. `PROVENANCE.json` maps every staged file to its
source and git blob and lists every divergence.

## Layout

```
pyproject.toml          name pho3nix-tuner, version 0.0.0.dev0, depends on alienclaw-ga
src/pho3nix_tuner/
  genome_schema.py      PHO00001 codec: EXECUTION slot Xcodes 0-3 <-> config dict
  inspect_history.py    Step-1 data gate (the STOP gate), CLI + inspect()
  reward_model.py       per-row reward; recency-weighted k-NN with Bayesian shrinkage
  fitness_adapter.py    RunMartianCallback + evaluate_config() over the reward model
  run_ga.py             gate -> reward model -> baselines -> GA -> held-out gate -> artifacts
  tooltime_bounds.py    min/max/direction table for the in-scope params
  results/.gitkeep
tests/                  synthetic histories only (tests/_synth.py); everything writes to tmp_path
```

## The data gate, and why it is closed today

`inspect_history.inspect()` is a hard gate in front of any GA run. `run_ga.py` calls it
first and exits 1 on STOP, including with `--dry-run`. It returns GO only when all of
these hold:

1. at least 20 rows for the target tools (nmap, gobuster, sqlmap);
2. timestamps are present and parse (they drive the oldest-75% / newest-25%
   train/held-out split);
3. at least 2 distinct param signatures in some (tool, endpoint-scheme) context.

The gate is closed today because no rig has param-varied history for these tools.
According to `PLAN.md` §8 (D2/D3), the xil-1 rig runs nuclei, wafw00f, testssl and arjun,
with zero nmap/gobuster/sqlmap rows. The tunable params it does log never vary from run
to run, so there is no counterfactual to learn from. A GA run on such data would chase noise. That is why the gate exists, and why this
package has never run on real data. The owner has parked any change to how Pho3nix logs
these fields, and this package proposes none.

The gate reopens on its own when imported history meets the three conditions above. You
do not need to change any code for that.

## How to run

The engine is not published, so put both `src/` dirs on `PYTHONPATH`. Here `W` is the
AlienClaw repo root.

```bash
export PYTHONPATH=W/staging/pho3nix-tuner/src:W/staging/ga-engine/src

# Step 1: the gate on its own (exit 1 = STOP, 0 = GO; --json for a machine report)
python3 -m pho3nix_tuner.inspect_history path/to/run_history.json

# The same gate through the runner, stopping before the GA
python3 -m pho3nix_tuner.run_ga --dry-run --history path/to/run_history.json

# A full run (only meaningful once the gate says GO)
python3 -m pho3nix_tuner.run_ga --history path/to/run_history.json \
    --tool gobuster --context 'gobuster|https' --pop-size 12 --generations 5 \
    --output /some/dir/winner.genome.txt

# The bounds table
python3 -m pho3nix_tuner.tooltime_bounds [--all] [--json]
```

Running `python3 src/pho3nix_tuner/run_ga.py` as a script also works. The runner
inserts its own `src/` into `sys.path`. Defaults to watch for:

- `--history` defaults to `~/.pho3nix_data/history/run_history.json`.
- `--output` defaults to the cwd-relative `pho3nix_tuner/results/winner.genome.txt`.
- The population store is `$ALIENCLAW_POPULATIONS_ROOT`. If that is unset, the runner
  creates a fresh `mkdtemp` directory when it is imported.

Real rig dumps belong in a gitignored directory, never in this package.

### Tests

```bash
cd W/staging/pho3nix-tuner
PYTHONPATH=src:W/staging/ga-engine/src python3 -m pytest tests -q -p no:cacheprovider
ruff check .
```

Every history in the tests is built by hand in `tests/_synth.py`. The rows have the shape
Pho3nix's run-history store writes, but every value is invented. The tests use
`tmp_path`, with `HOME` and `ALIENCLAW_POPULATIONS_ROOT` redirected, and no network.
Coverage:

- genome round-trip for the three baseline profiles, with clamping and bounds;
- agreement between the gene bounds and `tooltime_bounds.py`;
- gate verdicts for empty, no-target-tool, no-timestamp, single-signature and
  sufficient histories;
- the STOP gate as a subprocess: `run_ga.py --dry-run` exits 1 or 0;
- reward-model monotonicity and bounds;
- a 2-generation GA run;
- parity against the in-tree package, which skips when that package is not importable.

## Divergences from in-tree (full list in PROVENANCE.json)

- Every `alienclaw.*` import becomes `alienclaw_ga.*`, and the `sys.path` insert of
  `<repo>/src` is gone.
- **Loader fix**. In-tree, a `{"history": [...]}` dump passed the gate, but `run_ga`
  (Step 2) and `RewardModel.from_file` only looked under `entries` and `runs`, so they
  read it as empty. The staged copy uses the gate's `_load_history` in both places.
  `tests/test_parity_in_tree.py` asserts this one difference explicitly.
- `__version__` is `0.0.0.dev0`, matching `pyproject.toml`. In-tree it is `0.1.0`.

## Lifting into Pho3nix (what it would need)

- **Dependency.** `alienclaw-ga` must be resolvable: either published, or vendored, or
  added as a path or git dependency on `staging/ga-engine`. The tuner uses only the
  stdlib-only parts (`genome`, `evolution`). The contract is pinned by
  `staging/ga-engine/tests/test_tuner_contract.py`.
- **Placement.** Drop `src/pho3nix_tuner/` and `tests/` in as a self-contained
  package. The import name `pho3nix_tuner` stays the same. Keep a gitignored directory
  for imported history, and point `--output` somewhere explicit.
- **Data.** The gate has to say GO on real history before a GA result means anything.
- **No Pho3nix code changes are proposed here.** The tuner only reads a run-history JSON
  dump.

## Fragilities noticed (described, not fixed)

- **The gate is global.** Variation in any one context opens it for every context, and
  the 20-row minimum counts all three tools together. `--tool` and `--context` are
  never consulted. Two tests document this.
- **k-NN matches on key names.** Candidate vectors use the gene names (`threads`,
  `delay_ms`, `timeout_sec`, `timing_t`), and distance is computed only over keys that
  also appear in a row's `params`. Logged params under other names or units (for
  example a `"0.5s"` string, parsed as seconds) drop out of the distance. With no
  shared key, every row sits at the same constant distance and the estimate stops
  depending on the genome. sqlmap has no genes, so its fitness is constant (tested).
- **Old history loses distance weighting.** Recency weight decays absolutely, and below
  a total weight of 1e-9 `estimate()` falls back to an unweighted mean. History about
  1.5 to 1.9 years old (sooner when the nearest neighbours are far away) loses its
  distance weighting.
- **Delay resolution is coarse.** `config_to_gobuster_params` emits the delay at 100 ms
  resolution: 1001 gene values map to 11 strings (tested).
- **Runner state.** `run_ga` names the population `pho<unix-seconds>`, so two runs in
  the same second that share a populations root collide. If
  `ALIENCLAW_POPULATIONS_ROOT` is unset, every import leaks a temp directory. Fitness
  callbacks swallow every exception and return 0.0.
- **Docstring drift.** `compute_reward` returns values in [-0.6, 1.0], not the
  documented [-0.5, 1.0]. For an empty bucket, `estimate()` returns the model's global
  mean, not `BAYES_PRIOR_MEAN`. `MIN_CONTEXT_KEYS` is unused. The `tooltime_bounds`
  header lists 2 sqlmap params, but the table has 4.
