# staging/tools

## build_drop_manifest.py

Builds the DROP archive manifest for the AlienClaw salvage teardown: a reproducible,
script-generated inventory of every file being retired, what still depends on it, and how
to restore it. Outputs:

- `docs/salvage/drop-manifest.json`: machine-readable, one record per tracked file.
- `docs/salvage/DROP-ARCHIVE-MANIFEST.md`: human summary.

Stdlib only, plus PyYAML to parse the CI workflow. Git is used read-only (`ls-tree`,
`rev-parse`, `cat-file`, `log`, `merge-base`, `bundle list-heads`, `bundle verify`).

### Run

```bash
H=/path/to/heavy.sh   # Alfred's shared lock; wraps only `git bundle verify`
python3 staging/tools/build_drop_manifest.py --repo . \
  --ref HEAD --pass1-ref origin/chore/teardown-pass1 --ci .github/workflows/ci.yml \
  --lock-cmd "$H" \
  --json docs/salvage/drop-manifest.json --md docs/salvage/DROP-ARCHIVE-MANIFEST.md
```

| Flag | Default | Meaning |
|---|---|---|
| `--repo` | `.` | Repository to read |
| `--ref` | `HEAD` | Tree to inventory |
| `--pass1-ref` | `origin/chore/teardown-pass1` | Teardown pass 1, for the pass-1 status column |
| `--ci` | `.github/workflows/ci.yml` | Workflow to map; read from `--ref` when tracked there, else from disk |
| `--tag` | `pre-teardown-20261126` | Archive tag |
| `--bundle` | `/home/xil/archive/alienclaw-pre-teardown-20261126.bundle` | Archive bundle |
| `--lock-cmd` | none | Wrapper command for `git bundle verify` (e.g. `heavy.sh`) |
| `--no-bundle-verify` | off | Skip `git bundle verify` (size, sha256 and heads are still recorded) |

A full verify of the 90 MB bundle takes a few minutes. Running the whole script under
`heavy.sh` without `--lock-cmd` is equivalent; never combine the two, because the inner
`flock` would wait on the outer one forever. The output is byte-identical for the
same refs and bundle: everything is sorted, and the only provenance is the `generated_from`
block (ref, commit and tree shas, CI blob sha). There are no timestamps.

### What it records

Per tracked file at `--ref`: path, area, verdict (DROP / KEEP / DEFER / REVIEW), the rule
and reason that produced the verdict, bytes, LOC (newline count; `null` for binary files),
git blob sha, file mode, pass-1 status, whether the archive tag holds the identical blob,
and (for DROP files) the count of inbound references by kind.

Files named `.env*` are never read and never listed; only their count appears.

### Classification

`RULES` in the script is an ordered table; the first match wins. Three modes:

- `static`: the rule fixes the verdict (for example `src/alienclaw/governance/` is DROP).
- `derived`: the verdict follows the files that reference this one. The strongest
  surviving referrer wins (KEEP > DEFER > REVIEW). If only DROP files reference it, it is
  DROP. If nothing does, it gets the rule's fallback verdict. Used for the top-level
  `src/alienclaw/*.ts` files and for `test/helpers/` and `test/fixtures/`.
- `auto`: test files outside the DROP test directories. A test becomes DROP when
  everything outside `test/` that it imports or reads is DROP, or when it is named after a
  DROP module it imports (`test_bridge_runner.py` imports `bridge_runner.py`). Otherwise it
  keeps the rule's verdict.

CI references never keep a file alive, because the CI steps are edited as part of the
teardown. Prose mentions don't either.

### Edges

Every tracked text file is scanned once. `MEMORY/` and `.packet-reports/` are classified
but not scanned, since they hold session history, not code. The manifest keeps the edges
that point from a surviving file (KEEP, DEFER, REVIEW) into DROP.

| Kind | Source |
|---|---|
| `runtime` | Python `import` / `from` (function-level imports included), TS/JS `import ... from`, `export ... from`, bare `import`, `import()`, `require()`, `vi.mock()` and related calls, resolved relative to the file (`.js` maps to `.ts`, directory imports map to `index.*`) |
| `type-only` | Python imports under `if TYPE_CHECKING:`; TS `import type`, `export type`, or braces in which every specifier is `type X`. These don't run, but a TS one still fails `tsc --noEmit` |
| `data` | Path strings in code and config: single literals, `path.join(...)` argument runs, Python `Path / "a" / "b"` chains, dotted `alienclaw.x.y` module strings, shell and YAML tokens, JSON string values |
| `ci` | Tokens in the `run` (and `with` / `env`) text of each step of `--ci`, plus any other file under `.github/` |
| `mention` | A path inside a prose string (a sentence, or a Markdown code span). Recorded, but not a blocker |

Comments and Python docstrings are skipped. A path string is matched in this order:
exactly, relative to the referencing file, from the repository root, by unique path
suffix, and by unique basename. Glob and `$VAR` tails are cut back to their directory.

**Blockers** are DROP targets (files, or directories in which every file is DROP) with at
least one `runtime`, `data` or `ci` edge. `cut_list` groups the same edges by the surviving
file that has to change. Each CI step lists its DROP references and areas, plus
`partial_refs` (directories that still hold some DROP files, where coverage floors may
move) and `implicit_scope` (`tsc`, or `vitest run` with no path).

### Pass-1 status

This compares the file at `--ref` with `--pass1-ref`, starting from their merge base:

- `deleted-in-pass1`: present at the base, absent at pass 1.
- `restored-in-pass1`: deleted by some first-parent commit in `base..pass1`, then back
  with the base blob.
- `modified-in-pass1`: present at both, with a different blob.
- `untouched`: anything else, including files added on the ref side after the fork.

### Restore

The `archive` block records the tag and its commit, the bundle path, size, sha256 and ref
count, whether the tag is in the bundle, and the `git bundle verify` result. Recipes:

```bash
git clone <bundle> alienclaw-restore && git -C alienclaw-restore checkout pre-teardown-20261126
git fetch <bundle> refs/tags/pre-teardown-20261126:refs/tags/pre-teardown-20261126
git checkout pre-teardown-20261126 -- <path>
git cat-file -p <blob> > <path>     # exact bytes; `git hash-object <path>` prints <blob>
```

`drop_roots` is the smallest set of directories (each fully DROP) and loose files that
covers the DROP set, one `git checkout` line each.

### Tests

```bash
$H python3 -m pytest -p no:cacheprovider -q staging/tools/tests
```

The tests build a synthetic repository in `tmp_path` (KEEP and DROP files with Python and
TS imports, a fake `ci.yml`, a pass-1 branch with a delete commit and a restore commit, a
tag and a bundle). They check classification, blob shas, LOC, edge detection, type-only
flagging, pass-1 status, CI mapping, the archive block, `.env*` exclusion and
byte-identical output. A smoke test runs against the real worktree, and is skipped when
the worktree isn't a git repository or the pass-1 ref is missing.

## check_drift.py

Keeps staged copies honest. Every `staging/<package>/PROVENANCE.json` records, per staged file,
its in-tree source and the source's git blob sha at staging time. The checker reports:

- **DRIFT**: the source changed since staging (`git hash-object <source>` ≠ `source_blob`), or a
  `verbatim` copy was edited.
- **ERROR**: a staged file or source is missing, or a PROVENANCE.json is malformed.
- **INFO**: a staged code file has no provenance entry. New files can be declared in an optional
  top-level `new_files` list, which accepts paths or globs.

```bash
python3 staging/tools/check_drift.py            # human report; exit 0 clean, 1 drift/error, 2 can't run
python3 staging/tools/check_drift.py --json     # machine-readable
```

Hidden, cache and `node_modules` folders are skipped, and so is any subfolder that has its own
PROVENANCE.json. Tests: `staging/tools/tests/test_check_drift.py` (synthetic repos in `tmp_path`,
plus a smoke run against this worktree).

When a source is fixed in-tree, re-port the fix into the staged copy and refresh `source_blob`
with `git hash-object <source>`.
