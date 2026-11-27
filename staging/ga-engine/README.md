# alienclaw-ga (staging)

AlienClaw's genetic-algorithm engine, copied out of `src/alienclaw/` so it can be
depended on without the retired three-agent product (BossBot / AdvisorBot /
CreatorBot, the "DROP" surface). The three tuners (`mangle_tuner`, `ouija_tuner`,
`pho3nix_tuner`) already reuse this engine with their own fitness functions.

This is a **copy**. The in-tree sources are untouched and remain what the
tuners import today. `PROVENANCE.json` maps every staged file to its source
path and git blob, marks it `verbatim` or `adapted`, and lists every divergence.

## Layout

```
pyproject.toml            name alienclaw-ga, version 0.0.0.dev0, requires-python >=3.10
src/alienclaw_ga/
  __init__.py             package docstring + __version__ (new)
  numeric.py              clamp01 (extracted from alienclaw.fitness.function)
  genome/                 alphabet, checksum, codec, operators, types, validation
                          + schema.py (DROP-free stand-in for brains.types, see below)
  evolution/              generation, population, selection, storage, stats, types,
                          scale_experiment, diagnostics/plateau_detector
  diagnostics/            bayesian_optimizer, diversity_tracker, dynamics_summary,
                          fixation_theory, genome_information, instrumentation,
                          per_genome_capture, plateau_detector
tests/                    ported in-tree tests + contract and DROP-import guards
  fixtures/genome-spec-fixtures.json   shared cross-language (Python/TS) vectors
```

`genome/` and `evolution/` use only the standard library. `diagnostics/` needs the
optional `diagnostics` extra: numpy (dynamics_summary, genome_information), and
scikit-learn plus scipy (bayesian_optimizer).

## Public API the tuners rely on

These are all the names the tuners import, checked by `tests/test_tuner_contract.py`.
That test also re-derives the list from the tuner sources when they sit next to this
folder, so it fails if a tuner starts importing something new.

| Module | Names |
|---|---|
| `alienclaw_ga.evolution.generation` | `evaluate_and_evolve(pop, config, run_martian, rng)`, `FitnessReport(fitness, run_metadata={})` |
| `alienclaw_ga.evolution.population` | `Population` (`Population.create(config)`, `.all()`) |
| `alienclaw_ga.evolution.types` | `EvolutionConfig` (frozen dataclass) |
| `alienclaw_ga.genome.alphabet` | `ALPHABET` (62 chars), `SECTION_LENGTH` (64) |
| `alienclaw_ga.genome.checksum` | `compute_checksum(sections012)` |
| `alienclaw_ga.genome.codec` | `decode_xcode`, `encode_xcode`, `xcode_to_param_value`, `param_value_to_xcode`, `round_trip_check` |
| `alienclaw_ga.genome.operators` | `random_genome(rng, id_tag, namespace=...)` |

To move a tuner onto this package, change each `alienclaw.` import to
`alienclaw_ga.` and drop the `sys.path` insert of `<repo>/src`. Nothing else
changes: `ALIENCLAW_POPULATIONS_ROOT` (the population store; default
`~/.alienclaw/populations`) and `ALIENCLAW_DIAGNOSTICS=1` (the instrumentation
opt-in flag) are kept, and so are the `martian_type` and `RunMartianCallback` names.

## What was excluded, and why

DROP packages are never imported: `alienclaw.{bridge, brains, martians,
governance, agents, comms, cli, wiring, msb, registry, config, api}`.
`tests/test_no_drop_imports.py` enforces this. It runs an AST scan that covers
lazy and `TYPE_CHECKING` imports, relative imports, `importlib`, DROP identifiers
and string annotations. It also imports every module in a clean interpreter
that has no in-tree `alienclaw` on its path.

| In-tree module | Reason |
|---|---|
| `evolution/bridge_runner.py` | imports `alienclaw.bridge.server` |
| `evolution/live_evo.py` | uses bridge_runner; live-campaign loop of the retired product |
| `evolution/__main__.py` | CLI built on bridge_runner |
| `evolution/experiment.py`, `evolution/governance_gate.py` | Its imports are DROP-free, but this is the seam where BossBot/AdvisorBot governance reviews each generation through the bridge. No tuner uses it (the tuners call `evaluate_and_evolve` directly). It can be re-added if needed. |
| `evolution/online_fitness.py` | Imports are DROP-free, but its only consumer is live_evo. It is live-campaign telemetry that defaults to `~/.alienclaw/online_fitness.jsonl`. |
| `evolution/migrations/` | Renames legacy per-tool population dirs (`compute`, `http_get`, ...). These are Martian names from the retired product, and the tuners never used that layout. |
| `evolution/graph/`, `evolution/reflective/`, `make-evolution-flag.ts` | TypeScript (agent-graph / reflective layers of the product) |
| `diagnostics/composition_decoder_audit.py`, `synthetic_compositions.py`, `sensitivity_audit.py` | import brains / martians / bridge |
| `diagnostics/__main__.py`, `reporting.py` | import sensitivity_audit |
| `diagnostics/fitness_formula_candidates.py` | lazily imports `alienclaw.bridge.server`; research formulas for the retired composition fitness |
| `diagnostics/scaling_experiment.py` | imports fitness_formula_candidates |
| `diagnostics/fitness_ceiling.py` | delegates to `alienclaw.fitness.function.evaluate`, the retired Martian-composition scorer (tool_calls / slot_count), which SALVAGE.md marks DROP |
| `diagnostics/martian_stub_generator.py`, `stub_servers.py` | Imports are DROP-free, but these are campaign inputs and HTTP stubs for Martian tool runners, and their only consumer is sensitivity_audit. |
| `fitness/` | Only `clamp01` is needed. It is copied into `alienclaw_ga/numeric.py`; the retired scorer is not staged. |

## Divergences from the in-tree code (summary; full list in PROVENANCE.json)

- **`EvolutionConfig.brain`**: in-tree this field is annotated `BrainSpec | None` (from `alienclaw.brains`, DROP). Here it is `DirectedMutationSpec | None`, a Protocol in `genome/schema.py` that only needs a `parameter_schema`. That attribute is the only thing `mutate_directed` reads. The field name, default, and runtime behavior are unchanged, and an in-tree `BrainSpec` still works. `genome/schema.py` also provides `ParameterSchemaField` (copied field for field) and a minimal concrete `MutationSchema`.
- **`clamp01`** now comes from `alienclaw_ga.numeric` and not from `alienclaw.fitness.function`.
- **Imports**: all `alienclaw.X` imports and patch targets are rewritten to `alienclaw_ga.X`.
- **Ported tests**: unused imports were removed and import blocks re-sorted by ruff. The two directed-mutation fixtures use `MutationSchema`. `test_dynamics_summary` carries local copies of two research formulas. `test_instrumentation` drives the recorders directly, not through the bridge.
- **Lint ignores**: the diagnostics copies keep their math-style names (`N`, `H_x`, `X_obs`) and the public `CaptureHook()` name, using per-file N8xx ignores. In-tree CI never ran ruff on diagnostics.

## Tests

```
PYTHONPATH=src python3 -m pytest tests -q -p no:cacheprovider
ruff check .
```

Ported from in-tree: all of `test/genome/*.py` (the TS runners stay in-tree), plus
the `test/evolution/` and `test/diagnostics/` files that cover the modules staged
here. The cross-language runner `tests/genome/test_fixtures.py` runs every case in
`tests/fixtures/genome-spec-fixtures.json`. This is the same file the TS codec
tests consume, so the two languages stay locked together.

`tests/conftest.py` points `HOME` and `ALIENCLAW_POPULATIONS_ROOT` at the per-test
`tmp_path` and turns off the Hypothesis example database, so a run writes nothing
under the real home directory. This matches CI's "Verify no leak directories" step.
Hypothesis still drops a self-gitignored `.hypothesis/` cache (constants and unicode
data) in the working directory.

## Known leftovers

- Docstrings and comments still name in-tree files: the TS mirror
  `src/alienclaw/registry/genome-codec.ts`, `bridge/server.py` as the instrumentation
  producer, and `# list[Optional[BrainSpec]]` in `mutate_directed`.
- `diagnostics/instrumentation.py` has no producer in this package. In-tree it is
  fed only by the DROP bridge, so here it stays inert until a host calls `record_*`.
