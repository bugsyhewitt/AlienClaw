# How to Add a MartianBrain

A MartianBrain (`.msb` file) is the static tool substrate that genomes flow into.
Every new brain must pass this checklist before being merged. The checklist is also
enforced by `test/brain-composition.test.ts` — if a registry entry is missing a
required field, the CI suite fails.

---

## Admission Checklist

### 1. Annotation class (required)

Declare which annotation class your brain belongs to. Pick the **most restrictive**
class that still allows the brain to do its job:

| Class | What it may do |
|---|---|
| `read-only` | Read local state only. No writes, no network. |
| `additive-in-jail` | Write only to the jail's output directory. No network. |
| `open-world` | Make outbound network requests (SSRF-guarded via hardened-fetch). |

**Destructive operations are never admitted.** A brain that can delete arbitrary
files or modify governance data (goals.json, SOUL.md, AGENTS.md) will be rejected.

### 2. LLM-free source review (canon 2)

Every brain must be **LLM-free**: no model call, direct or transitive, during
Martian execution. This is canon 2 — non-negotiable.

Checklist items:
- [ ] The brain's tool implementation (`src/alienclaw/tools/<name>.py`) makes no
  call to any LLM API (Anthropic, OpenAI, or any other).
- [ ] No transitive dependency of the brain calls an LLM.
- [ ] The `.msb` file's `CAPABILITIES` section does not imply LLM use.

### 3. Deterministic fixtures (required for `open-world`, strongly recommended for all)

Conformance fixtures must be deterministic: given the same inputs, the tool produces
the same outputs. Network brains must provide fixtures with stubbed responses.

- [ ] Create a fixture file or extend `test/fixtures/genome-spec-fixtures.json`.
- [ ] The fixture is asserted by both TS and Python runners.
- [ ] For `open-world` brains: fixtures stub DNS and HTTP (no real network in CI).

### 4. Jail review

Every brain must have its containment reviewed before merge.

- [ ] File paths resolved with `realpath` and validated against the workspace boundary.
- [ ] Dotfiles denied (filenames starting with `.`).
- [ ] Writes denied to `~/.openclaw/**` (OpenClaw agent workspaces).
- [ ] Symlinks on write paths are denied.
- [ ] `compute`-style brains: AST allowlist reviewed; no `eval` on unvalidated input.
- [ ] `search_text`-style brains: regex length cap and timeout in place.
- [ ] `extract_json`-style brains: input size cap and nesting depth limit in place.

### 5. SSRF path (required for `open-world`)

Any brain that makes network requests MUST use the unified hardened fetch at
`src/alienclaw/net/hardened-fetch.ts`. Custom fetch implementations are not admitted.

- [ ] All network calls go through `hardenedFetch` from `../net/hardened-fetch.js`.
- [ ] A caller policy (`FetchPolicy`) is declared and documented in the brain's source.
- [ ] SSRF test vectors covering the 2026 bypass corpus are added to `test/ssrf-vectors.test.ts`.

### 6. Cost class (required)

Declare the brain's cost class in the registry entry:

| Class | Description |
|---|---|
| `free` | Pure in-memory operation; negligible cost. |
| `local` | Local CPU/disk I/O; no network. |
| `network` | Outbound HTTP request; costs bandwidth and latency. |
| `heavy` | Expensive local computation (e.g., ML inference, large FFT). |

### 7. Conformance tests (required)

- [ ] At least 5 valid-input cases covering expected output shape.
- [ ] At least 3 failure cases (wrong input type, oversized input, boundary exceeded).
- [ ] Both TS and Python runners assert the fixtures identically.
- [ ] Tests are deterministic: no `Math.random()`, no real network, no real clock.

### 8. Registry entry (required)

Add a new entry to `src/alienclaw/msb/registry.ts`. The id MUST be the next available
integer (never reuse an old id). Copy the shape of an existing entry exactly.

- [ ] `id`: next sequential integer (currently next free id is 8).
- [ ] `name`: matches the `TOOL:` line in the `.msb` file exactly.
- [ ] `version`: matches the `VERSION:` line in the `.msb` file.
- [ ] `in` and `out`: declared types from the value-type lattice.
- [ ] `annotation_class`, `cost_class`, `fixtures`: filled in.
- [ ] No existing ids renumbered.

### 9. Documentation (required)

- [ ] `CAPABILITIES`, `LIMITATIONS`, `FAILURE MODES`, `BEST PRACTICES`,
  `EXECUTION ORDER`, and `OUTPUT CONTRACT` sections filled in the `.msb` file.
- [ ] An entry in `docs/reference/brains.md` (regenerate from the registry script).
- [ ] At least one worked example in the `.msb` file's `EXECUTION ORDER` section.

---

## PR Requirements

Use the brain PR template at `.github/PULL_REQUEST_TEMPLATE/brain.md`. Every box
on that template must be checked before the PR is ready for review.

---

## Enforcement

The test `test/brain-composition.test.ts::BrainRegistry — required fields` will
fail CI if any of the following required fields are missing from a registry entry:

- `id`, `name`, `version`, `in`, `out`, `annotation_class`, `cost_class`, `fixtures`

No merge is permitted while this test is red.
