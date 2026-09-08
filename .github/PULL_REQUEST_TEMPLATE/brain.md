# New MartianBrain PR Checklist

Before requesting review, check every box. Any unchecked box is a blocker.

See `docs/how-to/adding-a-martianbrain.md` for full guidance on each item.

---

## Brain identity

- [ ] Brain name (`TOOL:` line in `.msb`) is unique and does not shadow an existing brain.
- [ ] `VERSION:` in the `.msb` file is set to `1.0` (or incremented if updating an existing brain).
- [ ] Registry entry added to `src/alienclaw/msb/registry.ts` with the next sequential id.

## Annotation class

- [ ] `annotation_class` declared in the registry entry.
- [ ] Class is the **most restrictive** that allows the brain to function.
- [ ] Destructive operations have been reviewed and are not present.

## LLM-free (canon 2)

- [ ] Tool implementation makes no direct or transitive LLM API call.
- [ ] Brain has been code-reviewed by a human reviewer for LLM use.
- [ ] `.msb` CAPABILITIES section describes only deterministic behavior.

## Jail review

- [ ] File paths (if any) use `realpath`-based boundary checks.
- [ ] Dotfiles and `~/.openclaw/**` are denied.
- [ ] Symlinks on write paths are rejected.
- [ ] Input size caps are enforced in code (not just in the `.msb` spec).
- [ ] For `compute`-style brains: AST allowlist reviewed; exponent guard present.
- [ ] For `search_text`-style brains: pattern length cap and timeout present.
- [ ] For `extract_json`-style brains: nesting depth limit present.

## SSRF (open-world brains only)

- [ ] All network calls go through `hardenedFetch` from `src/alienclaw/net/hardened-fetch.ts`.
- [ ] `FetchPolicy` is declared and documented at the call site.
- [ ] New SSRF test vectors added to `test/ssrf-vectors.test.ts`.

## Cost class

- [ ] `cost_class` declared in the registry entry.
- [ ] Cost class is justified by the brain's actual resource usage.

## Conformance tests

- [ ] At least 5 valid-input fixture cases.
- [ ] At least 3 failure-mode fixture cases.
- [ ] Both TS and Python runners pass on the new fixtures.
- [ ] All tests are deterministic (no real network, no real clock).

## Documentation

- [ ] All required `.msb` sections filled in (`CAPABILITIES`, `LIMITATIONS`,
  `FAILURE MODES`, `BEST PRACTICES`, `EXECUTION ORDER`, `OUTPUT CONTRACT`).
- [ ] `docs/reference/brains.md` updated (run the generation script).
- [ ] Worked example present in the `.msb` file.

## CI

- [ ] `pnpm typecheck` passes.
- [ ] `pnpm exec vitest run` passes (all existing tests green).
- [ ] `PYTHONPATH=src pytest` passes.
- [ ] `test/brain-composition.test.ts` still green (required-fields check).
- [ ] No `Specialist` (wall term, capital S) in any new code or docs.

---

Co-authored-by: <!-- your name -->
