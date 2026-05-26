# Packet 33 — Verdict

**Status:** GREEN

## Summary

AlienClaw successfully relocated from `~/dev/v3x/alienclaw/` to `~/dev/alienclaw/` on the fresh OS. pnpm 11.3.0 installed via corepack. TypeScript typecheck (tsc --noEmit) clean. Test suite passed: 756 Python + 430 TypeScript = 1186 tests green, 159 skipped, 0 failed. Autonomy infrastructure files shipped: `run-packet.sh`, `.claude-code/packet-contract.md`, `.claude-code/locked-decisions.md`, `packets/` scaffold, and `LESSONS_FROM_THE_ARC.md` stub. Zero hardcoded `dev/v3x/alienclaw` path references found anywhere in the codebase.

## Phase results

- **Phase 1 (relocate):** PASS — `mv ~/dev/v3x/alienclaw ~/dev/alienclaw` atomic (same filesystem). HEAD intact at c9c26871. Working tree clean before and after.
- **Phase 2 (pnpm):** PASS — pnpm 11.3.0 installed via `corepack prepare pnpm@latest --activate`. No `packageManager` field in package.json; used latest.
- **Phase 3 (build+test):** PASS — No `pnpm build` script exists; `pnpm typecheck` (tsc --noEmit) exits 0, zero TypeScript errors. Tests: 756 Python passed (125 skipped), 430 TypeScript passed (34 skipped). pnpm@11 `ERR_PNPM_IGNORED_BUILDS` warning resolved by committing `pnpm-workspace.yaml` with `allowBuilds: true` for @google/genai, esbuild, protobufjs.
- **Phase 4 (31.6 design recovery):** N/A — All 9 packet-31.6-*.md files present locally. No recovery needed.
- **Phase 5 (autonomy infra):** PASS — 5 new files created: `.claude-code/packet-contract.md`, `.claude-code/locked-decisions.md`, `run-packet.sh` (executable), `packets/packet-33-reconstitute.md`, `.packet-reports/LESSONS_FROM_THE_ARC.md`.
- **Phase 6 (path fixes):** N/A — Zero hardcoded `dev/v3x/alienclaw` references found in any code, config, or doc file. Shell config also clean.
- **Phase 7 (commit+push+PR):** PASS — Branch `packet-33-reconstitute`, scoped commits, PR opened.

## Lost-31.6 status

All Packet 31.6 design notes are present and intact at `.packet-reports/packet-31.6-*.md` (9 files including `packet-31.6-bug-14.md`). Packet 34 has full input available. The two lost commits (3891895a, 7d987d36) are confirmed absent from the object store but their work is fully documented.

## Outstanding for Bugsy

- **No shell config hits** — zero `v3x/alienclaw` references in `~/.bashrc`, `~/.zshrc`, or fish config. Nothing for you to review.
- **pnpm `packageManager` field** — `package.json` has no `packageManager` field pinning a pnpm version. Consider adding `"packageManager": "pnpm@11.3.0"` to lock the version going forward (Packet 34 decision or standalone).
- **No `pnpm build` script** — package.json has `typecheck`, `setup`, `start` but no `build`. The packet spec assumed `pnpm build` would exist. `pnpm typecheck` is the functional equivalent. If you want `build` to exist, add a script alias in Packet 34 or standalone.
- **`alienclaw-STALE-2026-05-25-175038`** — noticed in `~/dev/v3x/`. It's a stale copy from before the reinstall. Safe to delete when you're ready; not touching it per the never-list.

## Bug catch this packet

**pnpm@11 `ERR_PNPM_IGNORED_BUILDS`** — pnpm 11.3.0 introduced a new security feature requiring explicit `allowBuilds` approval for packages with install scripts. Without `pnpm-workspace.yaml` configured, `pnpm install` exits 1 in strict mode. Fixed by creating `pnpm-workspace.yaml` with `allowBuilds: true` for `@google/genai`, `esbuild`, `protobufjs`. This was a hidden fresh-OS bug — it only surfaces on a clean install. Bug #12 discipline caught it.
