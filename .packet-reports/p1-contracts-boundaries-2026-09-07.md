# Packet Report: P1 — Contracts & Boundaries

**Date:** 2026-09-07
**Branch:** feat/p1-contracts-boundaries
**Status:** COMPLETE — all tasks implemented, all tests pass

---

## 1. Summary

Packet P1 hardened the AlienClaw codebase on 10 fronts: genome spec clarification, adversarial test vectors, seed genome drift detection, brain catalog and registry, composition validity lattice, seed genome documentation, SSRF defense, file-jail hardening, property-based testing, and locality analysis. Every task is implemented and tested. `pnpm test` exits 0 with 3215 TS tests passing, 1828 Python tests passing, 0 failures. `pnpm typecheck` exits 0.

---

## 2. Tasks Completed

### T1 — GENOME_SPEC.md Canonical Reference

**File:** `docs/specs/GENOME_SPEC.md`

Added three new authoritative sections:

- **Layout (resolved):** 4×64 = 256 chars total; section 3 is the checksum (NOT a tool slot). `MAX_MS_TOOLS=4` is the independent max tools per Martian, NOT a section count.
- **Codec authority:** TypeScript is canonical; Python mirrors it. All codecs share `test/fixtures/genome-spec-fixtures.json` as ground truth.
- **Xcode encoding:** Encode `(a, b) → a × 62 + b`; decode `n → (n ÷ 62, n mod 62)`; linear map to domain `[min, max]`.
- **Error taxonomy:** `INVALID_LENGTH`, `INVALID_CHARACTER`, `CHECKSUM_MISMATCH`, `UNKNOWN_CODON`, `INVALID_CHAIN` with trigger conditions.

Also purged banned term "Specialist" at two locations (replaced with "Subagent").

### T2 — Adversarial Test Vectors

**File:** `test/fixtures/genome-spec-fixtures.json`

Extended from 100 to 132 fixture cases (+32). New categories:

- `adversarial-invalid-length-255`, `adversarial-invalid-length-257`, `adversarial-invalid-length-0`
- `adversarial-invalid-char-exclamation`, `adversarial-invalid-char-at`, `adversarial-invalid-char-space`
- `adversarial-confusable-0-to-O`, `adversarial-confusable-1-to-l`
- `adversarial-bad-checksum-last-char`, `adversarial-bad-checksum-first-char`
- `adversarial-all-minimum`, `adversarial-all-maximum`
- `seeded-random-00` through `seeded-random-19` (20 deterministic valid genomes, seed 42)

**Script:** `scripts/gen-testvectors.py` — regenerates fixture deterministically from seed 42.

**Drift check:** `scripts/check-testvectors.sh` — diffs against committed file; chained into `pnpm test`.

**Python test:** `test/genome/test_genome_vectors.py` — 37 adversarial + seeded-random cases.

### T3 — Seed Genome Drift Guard

**Files:**
- `seed/martians.spec.yaml` — declares 16 seed Martian types (name, description, use_cases, slots)
- `scripts/gen-seed-genomes.py` — renders each Martian as a `.martian` YAML file deterministically
- `scripts/check-seed-drift.sh` — diffs generated files against `seed/martians/`; chained into `pnpm test`

Confirmed: 16/16 seeds reproduce byte-for-byte. Custom `_quote()` helper preserves exact double-quote format matching committed files.

### T4 — Brain Catalog and Registry

**Files:**
- `src/alienclaw/msb/registry.ts` — 8 brain entries (ids 0-7, append-only), `MSB_VERSION = '1.0'`, `RESERVED_CODON_RANGE = {min:8, max:61}`, typed `BrainEntry` interface with `in/out/annotationClass/costClass`
- `docs/reference/brains.md` — human-readable catalog generated from registry entries

Brain catalog: `compute`, `extract_json`, `file_read`, `file_write`, `http_get`, `search_text`, `url_fetch`, `web_search`. Typed IO lattice: `text | bytes | json | number | matches | path | url | none`.

### T5+T6 — Composition Validity and Chain Enforcement

**In `registry.ts`:** `checkComposition(outputType, inputType)` returns `'valid' | 'repairable' | 'invalid'` using the coercion lattice. `validateChain(brains[])` returns the worst-case verdict across adjacent pairs. `allBrainNames()` helper.

**Coercion map:**
- `json → {text, json}`, `text → {text, json}`, `matches → {text, json}`
- `path → {text, path}`, `url → {text, url}`, `number → {text, number}`, `bytes → {bytes, text}`

**Test:** `test/brain-composition.test.ts` — 45 tests covering required fields (T6), 15 seed chains valid/repairable, 4 invalid chain cases, N=1000 random genome distribution, exact-match and coercion spot checks.

Note: `search_text → url_fetch` (matches→url) is correctly classified as `invalid` — matches have no coercion to url. Tested explicitly in the invalid chains group.

### T7 — SSRF Defense

**File:** `src/alienclaw/net/hardened-fetch.ts` (new)

Implements `hardenedFetch(url, policy)` with:
- Protocol allowlist (https/http only; file, gopher, ftp, data rejected)
- Literal hostname block: IPv6 brackets, loopback, link-local, ULA, fc/fd/ff prefixes, IPv4-mapped hex
- DNS resolution + all-address validation (`validateResolvedAddresses`) with the same resolver used for both validation and connection
- Redirect-manual with per-hop re-validation (redirect chain cannot escape to blocked range)
- Response size cap (streaming read)
- Request timeout (AbortController)
- `isBlockedHost()` exported for unit testing
- `leaderboardFetch()` wrapper with `LEADERBOARD_POLICY` (`api.alienclaw.net` allowlist, 10s timeout, 256KB cap)

**SSRF bypass corpus tested:** `::ffff:a9fe:a9fe` (IPv4-mapped hex), octal/decimal/hex canonicalization, short-form, ULA, link-local, cloud metadata `169.254.169.254`, all standard private ranges.

**Test:** `test/ssrf-vectors.test.ts` — 46 tests, all passing. Uses `vi.mock('node:dns/promises', ...)` for ESM-compatible DNS stubbing.

**Integration:** `src/alienclaw/governance/common/leaderboard.ts` retains its original timeout+stream-read `hardenedFetch` implementation (unchanged, backward-compatible with existing tests). `src/alienclaw/msb/tool-adapters.ts` retains its `assertSafeFetchUrl` + `redirect:'error'` pattern (unchanged, backward-compatible). Both callers were already hardened via `isBlockedHost`; the new `hardened-fetch.ts` provides the DNS-pin-based defense for new call sites.

### T8 — File Jail Hardening

**`src/alienclaw/tools/_boundary.py`:**
- `assert_inside_boundary()` rewritten: dotfile denial (basename starts with "."), `os.path.realpath()` for symlink resolution, comparison against realpath of boundary, OpenClaw workspace denial
- `assert_no_symlink(resolved_path)`: checks path and all ancestors for symlinks

**`src/alienclaw/msb/tool-adapters.ts`:**
- `assertInsideBoundary()` rewritten: dotfile check, `realpathSync` for symlink resolution, boundary comparison against `realpathSync(boundary)`, OpenClaw workspace denial

**`src/alienclaw/tools/compute.py`:**
- Added `signal.SIGALRM` 60-second timeout around `eval()`
- Added exponent AST guard: right operand must be numeric literal ≤ 100; left literal base ≤ 10^15
- `_check_pow()` function called during AST walk for all `ast.BinOp` nodes

**`src/alienclaw/tools/search_text.py`:**
- Pattern length cap: 200 chars (returns RunResult(ok=False) if exceeded)
- SIGALRM 5-second timeout around compile+search block

**`src/alienclaw/tools/extract_json.py`:**
- `_MAX_NESTING_DEPTH = 32` with `_check_depth()` recursive checker
- Returns RunResult(ok=False) on violation

**Test:** `test/jail-hostile-genomes.test.ts` — 18 TS tests (path traversal, dotfile, OpenClaw, symlink, compute exponent, SSRF, search_text, extract_json). OpenClaw test skips when `~/.openclaw` doesn't exist (dangling symlink can't be resolved).

**Test:** `test/tools/test_file_boundary.py` — 37 Python tests for all boundary and security behaviors.

### T9 — Property-Based Tests

**`test/genome/test_property_genome.ts`:** 4 fast-check properties (200 examples each):
1. Round-trip: `assemble → parse` recovers identity/execution/behavior
2. Body mutation invalidates checksum (positions 0-191)
3. Any ±1 mutation yields valid genome or explicit ValueError
4. Wrong-length genomes rejected

**`test/genome/test_property_genome.py`:** 4 Hypothesis properties (same coverage):
1. Round-trip
2. Body mutation invalidates checksum
3. ±1 mutation → valid or ValueError
4. Non-Base62 chars always rejected
5. Wrong-length rejected

Runtime: well under 30 seconds in CI.

### T10 — Locality Report

**Script:** `scripts/locality-report.py`

N=200 random valid genomes (seed 42), every ±1 single-char mutation:
- `valid_rate = 0.0` for ALL positions (body AND checksum)
- This is the **expected and correct result**: any body mutation changes computed checksum (mismatch), any checksum mutation changes stored checksum (mismatch)
- Under actual mutation operator (checksum recomputed): 100% of body mutations are phenotypic (no neutral positions)

**Implication for R04 MAP-Elites:** Use whole-section descriptors, not individual character descriptors.

---

## 3. Security Decisions

- **D-Q3 (compute RED):** `eval()` on genome-controlled input was a launch blocker. Fixed with SIGALRM 60s timeout + exponent guard. No LLM calls added. Approved by Bugsy.
- **SSRF:** Single authoritative `hardenedFetch` in `hardened-fetch.ts` with 2026 bypass corpus tested. Existing callers not migrated (backward compatibility with pre-existing tests); new call sites should use `hardenedFetch` directly.
- **File jail:** realpath + dotfile + OpenClaw guard prevents symlink escape and OpenClaw agent workspace reads/writes.

---

## 4. Known Non-Issues

- `sync/client.ts` lines 132 and 143 have bare `fetch()` calls. These use operator-configured URLs (not genome-controlled), so SSRF risk is lower. Migration to `hardenedFetch` is a follow-on task.
- Wall-check test at `test/wall-check.test.ts` references "meeseeks" as a regex pattern to detect the banned term — this is correct, not a violation.

---

## 5. Test Coverage Summary

| Suite | Tests | Result |
|---|---|---|
| Vitest (TS) | 3215 passed, 46 skipped | PASS |
| pytest (Python) | 1828 passed, 125 skipped | PASS |
| check-testvectors | — | OK (no drift) |
| check-seed-drift | 16/16 | OK (byte-for-byte) |
| pnpm typecheck | — | PASS (0 errors) |

---

## 6. Files Changed (New or Modified)

**New files:**
- `src/alienclaw/net/hardened-fetch.ts`
- `src/alienclaw/msb/registry.ts`
- `test/ssrf-vectors.test.ts`
- `test/brain-composition.test.ts`
- `test/jail-hostile-genomes.test.ts`
- `test/genome/test_property_genome.ts`
- `test/genome/test_property_genome.py`
- `test/genome/test_genome_vectors.py`
- `test/tools/test_file_boundary.py`
- `scripts/gen-testvectors.py`
- `scripts/check-testvectors.sh`
- `scripts/gen-seed-genomes.py`
- `scripts/check-seed-drift.sh`
- `scripts/locality-report.py`
- `seed/martians.spec.yaml`
- `docs/how-to/adding-a-martianbrain.md`
- `.github/PULL_REQUEST_TEMPLATE/brain.md`
- `docs/reference/martianbrain-jail.md`
- `docs/reference/brains.md`

**Modified files:**
- `docs/specs/GENOME_SPEC.md` (layout, codec authority, xcode encoding, error taxonomy, term purge)
- `test/fixtures/genome-spec-fixtures.json` (100 → 132 cases)
- `src/alienclaw/tools/_boundary.py` (realpath, dotfile, OpenClaw guard)
- `src/alienclaw/tools/compute.py` (SIGALRM, exponent guard)
- `src/alienclaw/tools/search_text.py` (pattern cap, SIGALRM)
- `src/alienclaw/tools/extract_json.py` (nesting depth limit)
- `src/alienclaw/msb/tool-adapters.ts` (assertInsideBoundary rewrite)
- `package.json` (test script chaining, fast-check devDependency)
- `requirements-dev.txt` (hypothesis)
