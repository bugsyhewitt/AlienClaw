# repo-skeleton: the draft public repository for the agent-tool sandbox

**Nothing here is active in AlienClaw.** This folder holds the repo-level files the future
open-source monorepo needs (plan `docs/salvage/OSS-LIB-EXTRACTION-PLAN.md` §2 one monorepo,
§4 gates G9-G14, §5 layout) and the procedure for importing the staged packages into it.
The workflow lives in `github-workflows-proposed/`, not `.github/`, so no CI picks it up,
and AlienClaw's `staging/run-all-tests.sh` does not run `tools/` here.

The owner has **not** chosen the repo home, the package names, the license, the security
contact or the public identity. Every such value is a placeholder written `<<NAME>>`.
Nothing was created, registered, published or sent.

This README and `LICENSE-OPTIONS.md` stay in AlienClaw; everything else is meant for the
import commit.

## Files

| File | Goes to | What it is |
|---|---|---|
| `github-workflows-proposed/ci.yml` | `.github/workflows/ci.yml` | CI for G9 (jobs below) |
| `SECURITY.md` | `SECURITY.md` | G10: supported versions, private reporting, 90-day disclosure, scope |
| `CONTRIBUTING.md` | `CONTRIBUTING.md` | Corpus-first workflow, regeneration commands, DCO/CLA placeholder |
| `CHANGELOG.md` | `CHANGELOG.md` | Keep a Changelog; `[Unreleased]` describes the code as imported |
| `tools/render_parity.py` | `tools/render_parity.py` | Renders `docs/parity.md` (stdlib only; `--check` for CI) |
| `tools/test_render_parity.py` | `tools/test_render_parity.py` | The committed page equals a fresh render; parser shape tests |
| `docs/parity.md` | `docs/parity.md` | G3 evidence: every block-list entry, Python / TS / strictest-wins, corpus counts cross-checked |
| `LICENSE-OPTIONS.md` | not imported | G11 decision input: MIT vs `MIT OR Apache-2.0`, and the file layout each needs |
| `README.md` (this file) | not imported | Import procedure |

`render_parity.py` finds `policy/` next to its parent directory (the monorepo) or one level
higher (here), so the same file works in both places. Run it here as
`python3 staging/agent-tool-sandbox/repo-skeleton/tools/render_parity.py [--check]`.

## Tool choices

- **mypy `--strict`, not pyright.** mypy is a pure pip install that lives in the Python job's
  hash-pinned requirements, checks against `--python-version 3.11` from any runner, and needs
  no Node runtime (the `pyright` PyPI wrapper downloads Node and the npm package when it
  first runs). The code is stdlib only, so pyright's stronger inference buys little.
  **Status today:** 14 errors in 2 files (`pinning.py` 13, `ssrf_guard.py` 1: attr-defined,
  no-any-return, misc, untyped defs). `py-lint` stays red until they are fixed.
- **Biome, not ESLint.** One pinned devDependency with no plugin tree, lint and format in
  one command (`biome ci`), for a package whose selling point is zero runtime dependencies.
  ESLint with typescript-eslint adds a large transitive tree; its type-aware rules matter
  less here because `tsc --strict` runs in the same job.
- **Two stages.** `workflow-lint`, `wall-check` and `codegen-drift` install nothing and
  gate everything else, so a leaked name or a stale generated table fails in seconds.
- **`tools/offline.sh` in CI**, with `OFFLINE_REQUIRED=1`, after lifting Ubuntu's AppArmor
  restriction on unprivileged user namespaces, so the suites run in a loopback-only netns
  as they do here. macOS has no namespaces; the fake resolver and transport stubs still apply.
- **Hash-pinned dev dependencies** (`python/requirements-dev.txt` with `--require-hashes`,
  `ts/package-lock.json` with `npm ci --ignore-scripts`) and SHA-pinned actions.
- Python 3.15 and Node 26 rows run with `continue-on-error` until the manifests list them.

## Placeholders to fill

`grep -rnE '<<[A-Z][A-Z_]*(:[^>]*)?>>' .` in the import tree lists them; CI's
`workflow-lint` fails while any remains.

| Placeholder | Where | Decision |
|---|---|---|
| `<<REPO_URL>>` | SECURITY.md, CHANGELOG.md | repo home: `v3x-tech` org or the `bugsyhewitt` user (plan §8) |
| `<<SECURITY_CONTACT>>` | SECURITY.md | a dedicated alias, not a personal address (G10) |
| `<<PYPI_NAME>>`, `<<PY_IMPORT_NAME>>` | SECURITY.md, CHANGELOG.md, CONTRIBUTING.md | staged: `agent-tool-sandbox` / `agent_tool_sandbox` |
| `<<NPM_NAME>>` | SECURITY.md, CHANGELOG.md | staged: `@v3x/hardened-fetch`; plan suggests `@v3x/agent-tool-sandbox` |
| `<<LICENSE_EXPRESSION>>`, `<<COPYRIGHT_LINE>>` | CONTRIBUTING.md, LICENSE-OPTIONS.md | G11 |
| `<<DECISION: DCO ... or a CLA>>` | CONTRIBUTING.md | contribution terms |
| `<<SHA>>` (21 actions + 1 image digest), `<<VERSION>>` | ci.yml | resolved mechanically at import |
| `<<PUBLIC_NAME>>`, `<<PUBLIC_EMAIL>>`, `<<SIGNING_KEY>>` | step 6 below | public identity for the import commit (noreply address recommended) |

`ci.yml` also sets `PY_IMPORT_NAME: agent_tool_sandbox` (the staged import name) and reads
the npm name from `ts/package.json`, so a rename touches only the manifests.

## Found while drafting (fix before or in the import commit)

1. **`tools/wall_check.py` names the source project in plain text.** Its `TERMS` tuple
   spells out the project and its parts; only the hosting-provider names are rot13. Copying
   it into the public repo publishes them. Either encode every term the way it encodes the
   providers, or keep the tool private and run it from AlienClaw against the import tree
   (then drop the CI step that imports it).
2. **`wall_check.py` scans only `python/` and `ts/`.** The corpora and policy ship too, and
   12 lines in 4 files there match its terms: `vectors/fs-vectors.json` 6 (a product
   dot-directory name and a `{base}/home/` fixture path), `vectors/ssrf-vectors.json` 3
   (ticket references in `refs`), `vectors/DIFFERENCES.md` 2, `vectors/generate-ts.mjs` 1
   (the word in its networking sense). The proposed CI adds a whole-tree sweep with the same
   terms. Rewording a corpus input means re-recording and re-running both languages.
3. **Private references the term list does not catch:** the plan path `docs/salvage/...`,
   "in-tree", and the owner's name, in `policy/README.md`, `vectors/*.md`, both package
   READMEs, `python/pyproject.toml` (`authors`) and 13 test files (counting the wall-check
   terms too; the two parity-in-tree suites are not imported). The input wording
   "plan §3.4" / "plan gate G7" also reaches `docs/parity.md` through `DIFFERENCES.md` and
   the policy `refs`; reword, then re-render.
4. **`vectors/DIFFERENCES.md` has a stale count.** Its text says TS is the stricter side on
   11 vectors; the corpus and the file's own summary table say 10 (40 + 10 = 50). The
   parity page shows this as **NO** under "Do the counts agree?". It goes to `yes` when the
   sentence is fixed and the page re-rendered.
5. **The TS package has no development setup of its own.** It borrows the source repo's
   root `typescript`, `vitest`, `fast-check` and `@types/node` (G14). The source repo's root
   vitest config sets only excludes, so no `ts/vitest.config.ts` should be needed.
6. **No LICENSE yet (G11).** `codegen-drift`'s license step and both package-smoke jobs fail
   without one, on purpose.
7. **macOS has never run** either suite. Expect first-run failures on those rows (`/tmp`
   and `/var` are symlinks there; the jails' docs already note it).

## Path mapping (staged → monorepo)

| Source (`staging/agent-tool-sandbox/` unless noted) | Monorepo | Notes |
|---|---|---|
| `python/` | `python/` | minus `PROVENANCE.json`, `tests/test_parity_in_tree.py` and caches |
| `ts/` | `ts/` | minus `PROVENANCE.json`, `test/parity-in-tree.test.ts`, `node_modules/`, `dist/` |
| `policy/` | `policy/` | unchanged: the generators write `../python/...` and `../ts/...` |
| `vectors/` | `vectors/` | flat, unchanged: four harnesses hard-code `../../vectors/<file>.json`, so the plan's `vectors/v1/` split is a later change |
| `tools/wall_check.py` | `tools/wall_check.py` | see finding 1 |
| `staging/tools/offline.sh` | `tools/offline.sh` | generic; CI and CONTRIBUTING.md use it |
| `repo-skeleton/tools/*`, `repo-skeleton/docs/parity.md` | `tools/`, `docs/` | re-render after the edits |
| `repo-skeleton/{SECURITY,CONTRIBUTING,CHANGELOG}.md` | root | fill placeholders |
| `repo-skeleton/github-workflows-proposed/ci.yml` | `.github/workflows/ci.yml` | resolve SHAs |
| not imported | | both `PROVENANCE.json`, both parity-in-tree tests, `staging/tools/heavy.sh` (this machine's lock), this README, `LICENSE-OPTIONS.md`, everything under `docs/salvage/` |

The plan's `scripts/gen_blocklist.py` (one generator for both tables) is also later work;
the two generators stay in `policy/`.

## Import procedure

**0. Preconditions.** The owner's go, and the decisions in plan §8: repo home, names,
license, security contact, public identity, DCO or CLA. Gates G1-G8 as the owner wants them
for a first public commit (plan §4.1 has the status; G8, the independent review, is not met).

**1. Create the repository** at `<<REPO_URL>>`, empty: no README, license or .gitignore from
the web form (they would add a second commit). Turn on private vulnerability reporting.

**2. Assemble the tree** in a scratch directory outside any git checkout:

```bash
SRC=<AlienClaw checkout>/staging/agent-tool-sandbox
DST=$(mktemp -d)/agent-tool-sandbox && mkdir -p "$DST"
EXCLUDES=(--exclude PROVENANCE.json --exclude test_parity_in_tree.py
          --exclude parity-in-tree.test.ts --exclude __pycache__ --exclude .hypothesis
          --exclude .ruff_cache --exclude .mypy_cache --exclude node_modules --exclude dist
          --exclude build --exclude '*.egg-info')
for d in python ts policy vectors; do rsync -a "${EXCLUDES[@]}" "$SRC/$d/" "$DST/$d/"; done
mkdir -p "$DST/tools" "$DST/docs" "$DST/.github/workflows"
cp "$SRC/tools/wall_check.py" "$SRC/../tools/offline.sh" \
   "$SRC/repo-skeleton/tools/render_parity.py" "$SRC/repo-skeleton/tools/test_render_parity.py" \
   "$DST/tools/"
cp "$SRC/repo-skeleton/SECURITY.md" "$SRC/repo-skeleton/CONTRIBUTING.md" \
   "$SRC/repo-skeleton/CHANGELOG.md" "$DST/"
cp "$SRC/repo-skeleton/github-workflows-proposed/ci.yml" "$DST/.github/workflows/ci.yml"
```

**3. Make the import-commit edits** in `$DST`:

- G12: clear every wall-check line (findings 1-3), the package READMEs' divergence sections
  ("Divergences from ...", "Differences from the Python twin", the staged-copy notes), the
  `ts/package.json` description and the header comment of `ts/src/hardened-fetch.ts`.
- Names, license and identity in both manifests (`name`, `license`, `license-files`,
  `authors`), the LICENSE files per `LICENSE-OPTIONS.md` (root, `python/`, `ts/`), and every
  placeholder in SECURITY.md, CONTRIBUTING.md and CHANGELOG.md.
- Development setup: `ts/package.json` devDependencies (`typescript`, `vitest`,
  `fast-check`, `@types/node`, `@biomejs/biome`, and `tsx` for `vectors/generate.py`), at the
  versions the source repo resolves today, plus `"prepack": "npm run build"` and a
  `ts/biome.json`; then `ts/package-lock.json`. `python/requirements-dev.in` (`build`,
  `setuptools>=77`, `ruff`, `mypy`, `pytest`, `hypothesis`) compiled with hashes to
  `python/requirements-dev.txt` (`uv pip compile --generate-hashes` or pip-tools). Keep
  `"private": true` until the release workflow exists.
- A root `README.md` (plan §5: first line "guards, not a sandbox", a quickstart per language,
  the "Not covered" banner) and a `.gitignore` (`__pycache__/`, `.hypothesis/`, `.ruff_cache/`,
  `.mypy_cache/`, `node_modules/`, `dist/`, `build/`, `*.egg-info/`).
- Resolve each `<<SHA>>` to the full SHA of the tag in its comment, and the actionlint image
  digest.
- Re-render: `python3 tools/render_parity.py`.

**4. Verify locally, offline**, from `$DST`:

```bash
grep -rnE '<<[A-Z][A-Z_]*(:[^>]*)?>>' . && echo "placeholders left"   # must print nothing
grep -rnP '\t' .github/ && echo "tabs in workflows"                       # must print nothing
python3 tools/wall_check.py --tests                                        # exit 0
python3 policy/gen_python.py --check && node policy/gen-ts.mjs --check
python3 tools/render_parity.py --check && python3 -m pytest -q tools/
(cd python && bash ../tools/offline.sh python3 -m pytest -q)
(cd ts && npm ci && bash ../tools/offline.sh ./node_modules/.bin/vitest run)
```

Review the full file list (`find . -type f | sort`) against the mapping above.

**5. Secret scan (not run here).** Scan the tree before the commit and the commit after it,
with gitleaks and/or trufflehog, for example `gitleaks dir "$DST"` and, after step 6,
`gitleaks git "$DST"`; or `trufflehog filesystem "$DST"` and `trufflehog git file://$DST`
(flags per the installed version). Also review by hand: any e-mail address
(`grep -rEn '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[a-z]{2,}' .`), any hostname that is not an
`example`/`.test`/RFC 5737 fixture, and the hosting-provider names (`wall_check.py` covers
those). Keep the scan reports in AlienClaw `docs/salvage/`, not in the new repo.

**6. One signed import commit (G13).** AlienClaw history is not carried.

```bash
cd "$DST" && git init -b main
git config user.name "<<PUBLIC_NAME>>"
git config user.email "<<PUBLIC_EMAIL>>"
git config user.signingkey "<<SIGNING_KEY>>"     # add: git config gpg.format ssh, for an SSH key
git add -A && git status --short | wc -l          # matches the reviewed file list
git commit -S -m "Initial import"                 # no source-project names or ticket ids
git log --show-signature -1 && test "$(git rev-list --count HEAD)" = 1
git log --format='%an <%ae> / %cn <%ce>'          # the public identity, twice
```

**7. Record provenance privately:** the AlienClaw commit the tree came from, the import
commit's tree hash, and the source path and blob of every file, in AlienClaw
`docs/salvage/` only.

**8. Push, then the first CI run** (the owner's action): `git remote add origin
<<REPO_URL>>.git && git push -u origin main`. The run goes in this order:

1. **Stage 1, in parallel:** `actionlint` (workflow syntax, tabs, leftover placeholders),
   `wall-check` (the G12 evidence for the import commit), `codegen-drift` (both generated
   tables, `docs/parity.md`, the license copies, a clean tree afterwards).
2. **Stage 2, only if all three pass:** `py-lint`, `py-test` (8 required rows plus 3.15),
   `ts-lint`, `ts-test` (4 required rows plus Node 26), `vectors` (both languages on one
   checkout of the corpus, then `vectors/generate.py` in check mode: the G6 evidence), and
   the four package-smoke rows (the G14 evidence).
3. **Expected reds on the first run** unless step 3 handled them: `py-lint` (the mypy
   errors) and the macOS rows.

**9. After the first green run:** branch protection on `main` with every job above as a
required check (the names appear in the picker only after one run), Dependabot for
GitHub Actions, pip and npm, OpenSSF Scorecard (`scorecard.yml`), 2FA on the npm org and
the PyPI account. The release workflows (`release-python.yml`, `release-ts.yml`, trusted
publishing) are not drafted here.

## Validation done here (2026-11-26)

- `ci.yml` parses with `yaml.safe_load` (10 jobs); no tab characters in any file in this
  folder; all 22 `uses:` are SHA placeholders; all 41 `run:` blocks pass `bash -n`, none
  interpolates a `${{ }}` expression into shell, and their embedded
  Python and JavaScript compile. actionlint and shellcheck are not installed here, so they
  have not been run.
- The two package-smoke jobs were rehearsed offline on copies of the staged packages in a
  scratch directory, with the source repo's toolchain: wheel and sdist contents, install
  with `--no-index`, import from `site-packages`; `npm pack` contents (14 files), offline
  install of the tarball, import by name and subpath, consumer typecheck. The license
  checks were added afterwards and fail there, as intended, until G11.
- `tools/test_render_parity.py`: 9 passed, run through `staging/tools/offline.sh`.
- ruff (line length 100) is clean on `tools/`.
- The files meant for import (everything except this README and `LICENSE-OPTIONS.md`)
  contain none of `wall_check.py`'s terms.
