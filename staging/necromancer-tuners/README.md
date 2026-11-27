# necromancer-tuners (staging)

AlienClaw's two fuzz-campaign tuners, `mangle_tuner` and `ouija_tuner`, staged as one
package for later transfer into the necromancer repo. They run on the staged GA engine
`alienclaw_ga` (`staging/ga-engine`) and no longer use the in-tree `alienclaw` package.

This is a copy. The in-tree tuners are untouched, and nothing has moved to necromancer
yet. `PROVENANCE.json` maps each copied file to its source path and git blob, marks it
`verbatim` or `adapted`, and lists every divergence.

## Layout

```
pyproject.toml          necromancer-tuners 0.0.0.dev0; depends on alienclaw-ga (declared, not installed)
src/necromancer_tuners/
  mangle/               genome_schema, fitness_adapter, run_ga, README.md   (from mangle_tuner/)
  ouija/                genome_schema, evolved_mutator, fitness_adapter, run_ga, README.md   (from ouija_tuner/)
tests/
  fixtures/{mangle,ouija}/winner.genome.{txt,config.json,results.json}   (verbatim from */results/)
  tuner_fakes.py        in-process fakes of necromancer's mangle and ouija packages
  conftest.py           isolation: fakes, tmp HOME/TMPDIR/populations root, network and subprocess blocked
```

## The tuners

**mangle** evolves campaign configs for necromancer's mangle H.265 fuzzer. The genes sit in
EXECUTION Xcodes 0-5: strategy (uniform/adaptive), alpha and beta (0.1-5.0), exploration
floor (0-0.045), concurrency (1-16) and timeout (1-30 s). The ID tag is `MGL00001`.
alpha, beta and the floor reach mangle's `AdaptiveScheduler` because the adapter swaps out
`mangle.engine.make_scheduler` during each campaign. Fitness is
`sum(crash_aborts) / total_iterations` from mangle's `coverage_report`, run with
`crash_dedup=False`. That is the raw crash-or-abort rate per iteration. It is not unique
crashes, and it is not per CPU-second. A missing seed, a fuzzer error or a timeout, a
missing `results.jsonl`, or zero iterations all score 0.0. The gate passes when the evolved
config beats both the uniform-default and adaptive-default baselines on the held-out
evaluation.

**ouija** evolves indirect-prompt-injection carriers against a local Ollama model
(`127.0.0.1:11434`). The genes sit in EXECUTION Xcodes 0-3: carrier (7 ouija encoders),
framing (6 wrappers), repeats (1-40) and temperature (0-1). The ID tag is `OUI00001`.
`EvolvedMutator` applies `framing(carrier(instruction))`. The result is embedded in 4 benign
articles, which go to the model under a system prompt that tells it to resist. Fitness is
the mean, over the articles, of ouija's `measure()` ASR. A hit is ouija's
`judge_text_marker` finding `OUIJA-INJ-<hex seed>-TARGET` in the reply. Any exception
scores 0.0. The gate passes when the evolved config beats both the plain+none and b64+none
baselines on Ollama seed `eval_seed + 7`.

## Running

```bash
P=staging/necromancer-tuners/src:staging/ga-engine/src
PYTHONPATH=$P python3 -m necromancer_tuners.mangle.run_ga \
    --seed-file train.h265 --held-out-seed holdout.h265 --pop-size 16 --generations 10
PYTHONPATH=$P python3 -m necromancer_tuners.ouija.run_ga --model qwen2.5:3b
```

When the package is installed, the `mangle-tuner` and `ouija-tuner` console scripts do the
same. The modules still add `~/dev/necromancer/projects/mangle/src` and
`~/dev/necromancer/projects/ouija` to `sys.path`, as in-tree. mangle needs ffmpeg (or
libde265). ouija needs `ollama serve` and a pulled model. Each run writes `<output>`,
`<output>.config.json` and `<output>.results.json`. Unless `ALIENCLAW_POPULATIONS_ROOT` is
set, the population store goes to a fresh `/tmp/*-tuner-pops-*` dir.

## Tests

```bash
cd staging/necromancer-tuners
PYTHONPATH=src:../ga-engine/src python3 -m pytest tests -q -p no:cacheprovider
ruff check .
```

The suite has 155 tests. 48 cover mangle: schema 20, adapter 17, run_ga 4, parity 3 and
conformance 4. 101 cover ouija: schema 25, mutator 49 (42 of them one per carrier/framing
pair), adapter 17, run_ga 3, parity 3 and conformance 4. The other 6 are shared: one
parity check that the right modules loaded, and 5 package-hygiene tests.

What is mocked:

- `tuner_fakes.install()` registers fake `mangle` and `ouija` packages in `sys.modules`
  before any tuner is imported. The real necromancer code is never imported or run. The
  fakes copy the real semantics: crash and abort count as rewards, `asr = hits / repeats`,
  the marker substring decides a hit, and the seven carrier transforms are the same.
- mangle's boundary is `fitness_adapter.fuzz_file`, which normally spawns the decoder
  subprocesses. Tests replace it with a function that writes a mangle-shaped
  `results.jsonl`.
- ouija's boundary is `fitness_adapter.RawLLM`, the HTTP client. Tests replace it with
  `tuner_fakes.scripted_raw_llm(reply)`. The health check runs against a fake `httpx`.
- `conftest.py` points HOME, TMPDIR, `tempfile.tempdir` and `ALIENCLAW_POPULATIONS_ROOT` at
  each test's `tmp_path`. It makes `socket.connect`, `socket.create_connection` and
  `subprocess.Popen` raise, and turns off bytecode writing so the parity import leaves no
  `__pycache__` in-tree.
- `test_dependency_conformance.py` parses the real mangle and ouija sources (AST only) and
  pins the surface the adapters and fakes depend on. That includes checking that
  `mangle.engine` imports `make_scheduler` unqualified, which the monkey-patch needs. It
  skips when necromancer is absent. Set `NECROMANCER_ROOT` to point at a different checkout.
- `test_parity_in_tree.py` loads the in-tree `genome_schema` modules from `W` and `W/src`. It
  checks that decodes match on more than 300 genomes and that encodes are byte-identical. It
  skips once the in-tree copies are gone; `NECROMANCER_TUNERS_INTREE_ROOT` overrides `W`.

## Known issues in the tuners

The first three are fixed in this copy and listed as divergences. The rest are unchanged and
only documented here.

1. In-tree, running `python mangle_tuner/run_ga.py` (the command its README gives) fails
   with `ModuleNotFoundError: mangle_tuner`. The staged copy uses relative imports and
   runs with `-m`.
2. Importing either `run_ga`, even just for `--help`, created a `/tmp/*-tuner-pops-*` dir,
   and nothing ever removed it. The staged copy creates it in `main()`, after the arguments
   are parsed.
3. mangle `run_ga` did not create the `--output` parent directory, so a missing one raised
   `FileNotFoundError` after the whole GA run had finished.
4. mangle's fitness is per iteration, so a long timeout costs nothing. The committed winner
   uses 21.9 s, against a 5 s default. In the committed results the held-out seed is the
   same file as the training seed; only the RNG differs.
5. ouija's oracle cannot tell whether the model obeyed the injection or merely quoted the
   marker. A plain carrier leaves the marker readable in the input, while b64 and hex hide
   it. That may explain why the winner is plain+roleplay at ASR 1.0, with b64 at 0.0.
6. In ouija `run_ga`, GA-phase evaluations raise the genome's `repeats` to at least
   `--eval-repeats`, but the held-out gate uses the raw gene. `run_ga` also has its own
   callback and does not use `make_fitness_callback`.
7. The ouija health check matches by prefix, so having only `qwen2.5:7b` pulled satisfies a
   request for `qwen2.5:3b`. Its `import httpx` sits outside the `try`.
8. Both adapters turn every exception into 0.0. A missing ffmpeg or a stopped Ollama
   therefore produces an all-zero GA run that ends in a gate FAIL, with no error shown.
   Neither adapter rejects NaN. alienclaw_ga coerces NaN to 0.0 for population entries, but
   the baseline and gate evaluations bypass the engine. The real mangle and ouija cannot
   produce NaN.
9. GA population genomes carry an ID tag derived from `martian_type` (`MGL179..`,
   namespace `AlienClaw1`). Only the re-encoded winner carries `MGL00001` / `OUI00001`. The
   `martian_type` is `prefix + int(time.time())`, so two runs that start in the same second
   and share a populations root collide.

## What the necromancer repo will need

- A home for this package, plus `alienclaw-ga`, either vendored or published. It has no
  runtime dependencies.
- Replace the `Path.home()/dev/necromancer/...` `sys.path` inserts with workspace or path
  dependencies on `projects/mangle` (src layout) and `projects/ouija`. Do not declare them
  as PyPI names, because `mangle` on PyPI may be an unrelated project. Both require Python
  3.13 or later, so in practice this package does too.
- httpx, which ouija already depends on, plus ffmpeg or libde265 for mangle and Ollama for
  ouija at run time.
- Ideally an API in mangle's `make_scheduler` / `fuzz_file` that takes alpha, beta and the
  floor, so the global monkey-patch can go (the "Phase 1b" in mangle's README).
- The tests carry over as they are. Once the real packages can be imported, the fakes could
  be swapped for the real pure modules (encoders, oracle, findings, coverage), and
  `test_parity_in_tree.py` can be deleted.
