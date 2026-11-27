# tooltime-bounds: per-parameter tuning bounds for ToolTime tool.yaml (proposal)

**Status:** staged proposal in AlienClaw, 2026-11-26. Nothing in `~/dev/tooltime` or
`~/dev/pho3nix` has been changed. This adds catalog metadata only. It does not ask Pho3nix
to log anything new: the owner has parked rate-limit, concurrency and timeout logging.

## Problem

AlienClaw's `pho3nix_tuner` evolves Pho3nix recon profiles with a GA. The gene space (which
params, their ranges, which way is "more aggressive") is hand-coded twice: once in
`pho3nix_tuner/tooltime_bounds.py` (8 entries, 4 evolvable) and again as constants in
`pho3nix_tuner/genome_schema.py`. ToolTime is the one place that already describes every
tool's params, but `tool.yaml` has no way to say "search 5..50, higher is more aggressive".
So every new tunable tool means more hand-written Python, kept in sync with nothing.

## What tool.yaml params look like today

A real example, `~/dev/tooltime/agents/agent-01/tools/nmap/pho3nix_config/tool.yaml`:

```yaml
cli_template: "nmap -sV -p {ports} {target}"
params:
  timing:
    required: false
    type: string
    default: "-T3"
    enum: ["-T1", "-T2", "-T3", "-T4", "-T5"]
    description: "Timing template. T1=slow, T3=normal, T4=aggressive, T5=insane."
```

`params` is a **mapping of param name to spec**, not a list. A read-only survey of all 3,334
`pho3nix_config/tool.yaml` files on disk (21 agent folders plus `output/orphans_renamed`)
found:

- `params` is a mapping in 2,752 files and null or absent in 582. No file uses a list.
- The spec keys in use are `required`, `type`, `description` (on about 3,940 params),
  `default` (539), `enum` (109), `validation` (51, free text such as `"1..50"`), `flag` (36),
  `example` (27), `minimum` and `maximum` (3 params in 2 files: breacher, carboncopy), and
  `items` (1).
- `type` uses JSON Schema names: `string` (3,548), `integer` (194), `boolean` (193),
  `number` (7), `array` (1).
- Param names are snake_case. 966 of them are not `{placeholders}` in `cli_template`. nmap
  `timing` is one: the spec documents a knob that something other than the template applies.

Who reads `params` today:

- `output/pho3nix_integration/add_tool.py` (packet-39) **overwrites** `params` with
  `derive_params(parse_cli_template(...))`, so its code generation never sees extra keys.
- Pho3nix `server_core/tag_index.py` reads only `tags`.
- `scripts/check_catalog_integrity.py` checks only that each file parses (W3).

None of these readers enforces an allow-list of spec keys, so a new optional key inside a
param spec is inert to them. These are the readers a grep of both repos found; others may
exist.

## The extension: `params.<name>.bounds`

The shape follows ToolTime's existing conventions: nested in the param spec, snake_case,
JSON Schema type names. It uses the existing `minimum`/`maximum` keywords for hard
validity.

```yaml
params:
  threads:
    required: false
    type: integer
    default: 10
    flag: -t
    minimum: 1                    # EXISTING keyword: hard validity limit (optional)
    bounds:                       # NEW, optional: the tuning search space
      min: 5                      # inclusive; required when evolvable
      max: 50                     # inclusive; must be > min
      step: 1                     # optional, default 1, > 0
      unit: threads               # optional
      direction: increases_aggressiveness   # required
      evolvable: true             # required
      rationale: "Pho3nix optimization_profiles: stealth=5, normal=20, aggressive=50."  # required
      source: "pho3nix server_core/parameter_optimizer.py"    # optional
      value_template: "{value}"   # optional; REQUIRED when the param is type: string
```

| Key | Required | Meaning |
|---|---|---|
| `min`, `max` | together; both required if `evolvable: true` | Gene range, inclusive, `min < max`. Integers for `type: integer` params. |
| `step` | no (default 1) | Gene granularity, `> 0`. Integer for integer params. |
| `unit` | no | Unit of the **gene** value (`ms`, `s`, `threads`, `requests/s`). |
| `direction` | yes | `increases_aggressiveness`, `decreases_aggressiveness`, or `neutral`. |
| `evolvable` | yes | `true` means the catalog owner allows unattended automated search anywhere in `[min, max]`. |
| `value_template` | for string params | Turns a numeric gene into the param value, with exactly one `{value}` and no other braces: `-T{value}`, `{value}ms`. |
| `rationale` | yes | Why these numbers. |
| `source` | no | Where they came from: a file, a doc, or `--help`. |

Decisions behind the shape:

1. **`bounds` is not `minimum`/`maximum`.** Hard limits say what is legal for any caller.
   Bounds say what a tuner may try. These differ: gobuster accepts any thread count ≥ 1,
   but the GA should only search 5..50. Writing `maximum: 50` would wrongly forbid a human
   from asking for 100 if a Path A schema ever honours it. When both exist, bounds must sit
   inside the hard limits.
2. **`direction` is a fact about the tool, not an optimisation goal.** `tooltime_bounds.py`
   uses `maximize`/`minimize`/`context`, which mixes "what the value does" with "which way
   the optimiser pushes". A catalog can own the first. The tuner owns the second.
   Translation: `maximize` becomes `increases_aggressiveness` and `minimize` becomes
   `decreases_aggressiveness`. The two `context` entries are settled by the ordering of
   Pho3nix's `optimization_profiles` (stealth, then normal, then aggressive): nmap timing
   goes T2, T4, T5 (`increases`), and gobuster timeout goes 30s, 10s, 5s (`decreases`).
3. **`value_template` lets catalog params stay strings.** nmap `timing` is a string enum and
   gobuster `--delay`/`--timeout` take Go durations. The gene stays an integer and the
   template renders it. The validator checks that every rendered value is in `enum`, so
   `-T2..-T5` is checked against nmap's real enum. Templates are applied with a plain
   string replace, never `str.format`.
4. **`evolvable` is permission, not capability.** The catalog says "safe to auto-tune".
   Whether a consumer can apply the param (whether Pho3nix's `rebuild_command_with_params`
   handles it) stays the consumer's own filter.
5. **Bounds are not allowed** on `boolean` or `array` params.

## Validation

`validate_bounds.py` uses only the stdlib and PyYAML:

```bash
python3 validate_bounds.py examples/*.tool.yaml          # files
python3 validate_bounds.py ~/dev/tooltime/agents          # directories (recursive tool.yaml)
python3 validate_bounds.py --json examples/               # machine-readable report
```

Exit code 0 means no errors; 1 means at least one error, an unreadable or unparseable file,
or no `tool.yaml` found. Errors cover:

- the bounds structure: a mapping, no unknown keys, the required keys present
- `direction` in its enum, `evolvable` a real boolean
- `min`/`max` finite numbers (not booleans), given together, with `min < max`
- evolvable params having `min`/`max`, integer params having integer bounds, `step > 0`
- string params having a `value_template`; no bounds on boolean or array params
- bounds inside the param's `minimum`/`maximum`, and rendered values inside its `enum`

Warnings never change the exit code. They flag a `default` outside the range, a range that
is not a whole number of steps, or a range too large to check against `enum`.

`schema/tool-param-bounds.schema.json` (draft 2020-12) is the same contract in declarative
form, for editors and other languages. JSON Schema cannot express `min < max`, the
containment checks, or int-versus-`5.0`, so the validator is the stricter of the two.
`tests/test_schema.py` checks that both accept the examples and both reject every invalid
case the schema can express. It runs only if `jsonschema` is importable; it is here
(4.23.0).

## Backward compatibility

- Every key is optional and nested. A tool.yaml with no `bounds` produces zero findings.
  `tests/test_tooltime_compat.py` runs the validator read-only over every real
  `pho3nix_config/tool.yaml` under `$TOOLTIME_DIR` (default `~/dev/tooltime`). All 3,334
  pass, and none carries `bounds` today. It also drops the proposed nmap bounds into the
  real nmap spec in memory and gets zero findings.
- Existing param keys are untouched, including `type`, `enum`, `minimum` and `maximum`.
- `add_tool.py` rebuilds `params` from `cli_template` and ignores the extension. Nothing in
  Pho3nix has to change, and nothing new has to be logged.

## How pho3nix_tuner would consume it

```python
import yaml
from validate_bounds import validate_document, evolvable_genes, render

doc = yaml.safe_load(open(tool_yaml_path))
assert validate_document(doc).ok
genes = [g for g in evolvable_genes(doc) if (g["tool"], g["param"]) in REBUILD_APPLICABLE]
# genes -> [{"tool": "gobuster", "param": "threads", "min": 5, "max": 50, "step": 1,
#            "direction": "increases_aggressiveness", "value_template": None, ...}, ...]
```

1. `genome_schema.py` would replace `_THREADS_MIN/_MAX` and the other constants with the gene
   list, giving one Xcode per gene in catalog order. It would keep its `PHO00001` tag and
   EXECUTION slot.
2. `config_to_gobuster_params` and `config_to_nmap_params` would be replaced by
   `render(bounds, gene_value)`, keyed by the catalog param name, which is already the
   `rebuild_command_with_params` key (`threads`, `delay`, `timeout`, `timing`).
3. `tooltime_bounds.py` would shrink to a loader plus the tuner's own capability filter
   (`REBUILD_APPLICABLE`, today's `in_rebuild`).
4. Until names converge, the tuner keeps an alias map from gene to catalog param:
   `delay_ms` to `delay`, `timeout_sec` to `timeout`, `timing_t` to `timing`.
   `tests/test_tuner_agreement.py` holds it and proves that the gene space built from the
   examples equals `tooltime_bounds.EVOLVABLE_BOUNDS`.

## Migration steps for ToolTime (described, not done)

1. **Choose where the bounds live.** `agents/*/tools/` is gitignored in ToolTime
   (`.gitignore:28`). Of the 3,334 emitted tool.yaml files, only about 106 are force-added.
   None of the 4 example tools is tracked, and a re-bootstrap regenerates the files. Bounds
   written there can be lost. The options are (a) force-add the edited tool.yaml files, as
   packet work already does for some, or (b) keep a tracked overlay, for example
   `shared/policies/param_bounds.yaml` keyed by `safe_name.param`, that
   `bootstrap_tooltime.py` merges in. Option (b) is recommended.
2. Copy `validate_bounds.py` to `scripts/` and the schema to `docs/`. Add a check to
   `scripts/check_catalog_integrity.py`: a hard error if a bounds block is invalid, and
   nothing if bounds are absent.
3. Add a commented, optional `bounds:` stanza to `TOOL_YAML_TEMPLATE` in
   `shared/scripts/bootstrap_tooltime.py`, so agents and reviewers see the contract.
4. Seed nmap, gobuster, sqlmap and nuclei from `examples/`. gobuster gains a `params`
   block for the first time.
5. Retire the `--tooltime-dir` writer in `pho3nix_tuner/tooltime_bounds.py`. It is broken
   against the real catalog in three ways, all reproduced on scratch copies:
   - It looks for `<dir>/<tool>/tool.yaml`, but the real path is
     `agents/agent-NN/tools/<tool>/pho3nix_config/tool.yaml`, so it skips every tool.
   - It treats `params` as a list, so on nmap's mapping it raises
     `AttributeError: 'str' object has no attribute 'get'`.
   - On gobuster, which has no `params`, it writes a **list** `params`, which this
     validator rejects.

   It would also write flat `min`/`max`/`direction` keys at param level, where they collide
   in meaning with the JSON Schema `minimum`/`maximum`.
6. Later: once the overlay exists, move the tuner to read the catalog (see above).

## Open questions for the owner

1. **Overlay or in-place?** Should bounds go in a tracked overlay
   (`shared/policies/param_bounds.yaml`) or in force-added tool.yaml files? This decides
   whether a re-bootstrap keeps them.
2. **Is timeout's direction right?** The proposal says a longer timeout
   `decreases_aggressiveness` for gobuster and nuclei. That follows the profile ordering,
   but the effect is indirect. Would you rather call it `neutral`?
3. **Param names:** should catalog names follow Pho3nix's rebuild keys (`delay`, `timeout`,
   as proposed) or the tuner's unit-suffixed gene names (`delay_ms`, `timeout_sec`)? A
   related mismatch: Pho3nix's rebuild key for nuclei is `rate-limit` (hyphen), but ToolTime
   names are snake_case (`rate_limit`).
4. **Are the nuclei ceilings right?** `rate_limit` 1..150 and `concurrency` 1..25 cap at
   nuclei's own defaults; the lab cap in Pho3nix's skill library is 10. Is the upstream
   default the right ceiling, or should it be the lab cap? (They stay `evolvable: false`
   either way while the logging is parked.)
5. **Should hard limits be added?** The examples add `minimum` (and sqlmap `maximum: 10`,
   from `MAX_NUMBER_OF_THREADS`) only where upstream defines them. Should ToolTime add hard
   limits more widely, and convert the 51 free-text `validation: "1..50"` strings to
   `minimum`/`maximum`?

## Found along the way (outside this proposal's scope)

- **Tuner delay resolution.** `genome_schema.config_to_gobuster_params` renders delay as
  `f"{ms/1000:.1f}s"`, so the 1,001-value `delay_ms` gene produces only **11** distinct
  gobuster delays (0.0s to 1.0s). The catalog's `{value}ms` template keeps full resolution.
- **gobuster template.** ToolTime's gobuster `cli_template` is
  `gobuster -u {url} -w {wordlist}`. gobuster 3.8.2 requires a mode subcommand (`dir`,
  `dns`, ...).
- **nmap timeout.** Pho3nix `rebuild_command_with_params` appends `--timeout` for nmap, but
  nmap has no such flag (`--host-timeout` is the real one). `tooltime_bounds.py` describes
  `timeout_sec` as a "gobuster/nmap timeout"; the nmap example deliberately has no timeout
  bounds.
- **nuclei version drift.** The catalog lists `v3.6.2.r245`; the installed Arch package is
  v3.11.1. The flags cited here come from that package's `/usr/share/doc/nuclei/README.md`.

## Files

| Path | What |
|---|---|
| `README.md` | This proposal. |
| `schema/tool-param-bounds.schema.json` | JSON Schema (draft 2020-12) for the extension. |
| `validate_bounds.py` | Validator CLI and library (`validate_document`, `evolvable_genes`, `render`). |
| `examples/{nmap,gobuster,nuclei,sqlmap}.tool.yaml` | Real ToolTime tool.yaml files with bounds added (diffs marked `NEW`). |
| `tests/` | Validator units, examples, schema parity, tuner agreement, read-only ToolTime compatibility. |
| `PROVENANCE.json` | Sources and divergences. |

Run: `python3 -m pytest tests -q -p no:cacheprovider` (set `TOOLTIME_DIR` to point the
compatibility test elsewhere).
