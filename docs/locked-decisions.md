# Locked Decisions — P14-01 Reflective Evolution Engine

Deviations from §5 locked decisions and defensible implementation choices.
No §5 locked decisions were reversed. All deviations are documented below.

---

## Implementation choices (defensible, not deviations)

### 1. Module location: `src/alienclaw/evolution/reflective/` (TypeScript)

**Choice:** New TS module at `src/alienclaw/evolution/reflective/`. Does not collide with the existing `src/alienclaw/evolution/` Python module.

**Rationale:** Keeps the reflective engine separate from the scalar evolution loop and close to the evolution domain. Compatible with future Packet 04/07 additions.

### 2. Fitness formula parity: `slot_count = 1` always

**Choice:** The reflective engine uses `slot_count = 1` as the default slot count when computing the legacy scalar, matching the existing Python fitness function's default.

**Rationale:** `FitnessInputs.slot_count` defaults to `1` in `src/alienclaw/fitness/types.py`. Using the same default ensures the parity test (`computeLegacyScalar` ≡ Python `evaluate`) passes exactly.

### 3. Genome ID format: SHA-256 hex (64 chars) not shorter

**Choice:** Content hash is SHA-256 full hex (64 chars). Packet says "content hash" without specifying length.

**Rationale:** SHA-256 is collision-resistant. The `re_genome.id` column is `CHAR(64)` in the migration, matching exactly.

### 4. `extractToolSlotNames` returns empty list (adapter responsibility)

**Choice:** `parseReflectiveGenome` does not decode martianbrain tool names from the raw genome string. The adapter fills in `toolSlots` when it wraps the runtime.

**Rationale:** The full genome decode (martianbrain lookup, section parsing) lives in `src/alienclaw/registry/genome-codec.ts` and requires the martianbrain registry. The reflective engine is registry-agnostic; the adapter provides the bridge. This is the correct seam per §6.2.

### 5. Test MySQL skip pattern: identical to `test/api/ts-storage.test.ts`

**Choice:** MySQL tests in `test/evolution/reflective/store.test.ts` skip when `ALIENCLAW_TEST_DB_URL` is not set, using `describe.skip`.

**Rationale:** Bug #14 lesson is about WHAT the tests assert (MySQL rows, not HTTP), not about requiring local MySQL. CI always has MySQL; local dev skips. Identical to existing pattern.

### 6. `loadRun` reconstruction: latest frontier snapshot only

**Choice:** `MySQLEvolutionStore.loadRun` reconstructs the frontier from the most recent `re_frontier_snapshot` row. Full per-instance score reconstruction requires joining `re_run` — not implemented in v1.

**Rationale:** The primary use of `loadRun` is inspection and continuation. The full reconstruction (per-instance vectors) is an enhancement. The frontier genome set is correctly reconstructed, which is sufficient for §6.6 step 7 and the replay contract.

### 7. No `pnpm test` script added to `package.json`

**Choice:** Ship gate runs as `npx vitest run --reporter=verbose --no-file-parallelism`. No `test` script was added to `package.json`.

**Rationale:** AGENTS.md says `pnpm test` but there was no `test` script in `package.json` pre-packet. Adding one would be out of scope for this packet. The actual CI command is `npx vitest run` — used here for the ship gate.

---

## §5 Locked Decisions — confirmed unmodified

1. ✅ **Native TypeScript engine** — No Python sidecar. Pure TS.
2. ✅ **GEPA is the reference contract** — Adapter shape mirrors `evaluate` + `makeReflectiveDataset`.
3. ✅ **Pareto over scalar** — Selection uses `ParetoArchive`; legacy scalar retained as one objective.
4. ✅ **Verifier honesty in scope** — Oracle priority chain, confidence penalty, held-out valset implemented.
5. ✅ **Reflector = Opus 4.8, Proposer = Sonnet** — Specified in `OpusReflector` and config.
6. ✅ **Everything persisted** — MySQL schema covers candidates, lineage, ASI, frontier snapshots.
7. ✅ **Ship behind flag with shadow mode** — `REFLECTIVE_EVOLUTION` defaults `off`.
8. ✅ **MySQL-asserting tests** — `test/evolution/reflective/store.test.ts` asserts against MySQL rows.
