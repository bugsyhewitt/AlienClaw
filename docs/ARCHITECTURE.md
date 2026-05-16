# AlienClaw Architecture — Correction & Canonical Reference

**Status:** Authoritative as of this document's creation. Supersedes any conflicting interpretation in prior packets, prior LESSONS_FROM_THE_ARC entries, or prior conversation.

**Purpose:** A multi-day, multi-packet conversation produced significant misalignment between what the project's architecture *is* and what existing packets *built*. This document captures the correct architecture and identifies which existing artifacts need rename, restructure, or removal. Future packets reference this document as ground truth.

---

## 1. The architecture, stated plainly

AlienClaw has three layers. From top to bottom:

**Governance layer.** Three permanent agents — BossBot, AdvisorBot, CreatorBot — that handle reasoning, planning, critique, and orchestration. These are LLM-backed (eventually; currently stubbed). They live in `src/alienclaw/governance/`.

**Specialist layer.** Ephemeral subagents that CreatorBot spawns per campaign. Specialists are currently LLM-backed (or eventually will be). Each Specialist scopes a single campaign: figure out which Martians to summon, in what order, for what purpose, evaluate results, decide success/failure. **Far future:** Specialists get 512-character genomes for their own evolution; not v1 work.

**Martian layer.** Deterministic tool-call executors. **A Martian is a composition of up to 4 tools, parameterized by a 256-character Base62 genome.** Selection pressure on Martian genomes drives evolution toward Martians that complete the same work with fewer tool calls. **No LLM in the Martian layer, ever.** This is the project's core research contribution: secure, deterministic, evolvable tool-call optimization.

The thesis: less compute is better compute. Selection rewards efficient genomes. The community network propagates evolved genomes globally. The Martian layer is where the research happens; the governance and Specialist layers are the wrapping that makes it usable.

---

## 2. What a Martian actually is

A **Martian** is a *task type*, expressed as a composition of up to 4 tools selected from a registry of canonical tools. The composition and the tools' parameters are encoded in a single 256-character Base62 genome.

### 2.1 Genome structure

Every Martian genome is exactly 256 Base62 characters, divided into **four 64-character tool slots**:

```
[Slot 1: 64 chars] [Slot 2: 64 chars] [Slot 3: 64 chars] [Slot 4: 64 chars]
```

Each slot encodes one tool plus that tool's parameters. Slots can be empty (no tool occupies that slot). A Martian with two tools fills slots 1 and 2; slots 3 and 4 are empty.

### 2.2 Slot internal structure

Each 64-character slot has this layout:

```
Byte 0      : Tool ID (which tool occupies this slot, or 0 = empty)
Bytes 1-62  : Tool parameters, encoded as 31 Xcodes (see §3)
Byte 63     : Slot checksum (FNV-1a of bytes 0-62, mapped to Base62)
```

The tool ID byte references a registry of canonical tools. Currently the canonical tools are: compute, extract_json, file_read, file_write, http_get, search_text, url_fetch, web_search. New tools added to the registry get new IDs; existing IDs never change once assigned. Reserved value 0 means empty slot.

### 2.3 What a Martian "does"

When a Martian is summoned, the bridge:
1. Validates the genome (length, alphabet, all four slot checksums).
2. For each non-empty slot, in order: identifies the tool by ID, reads the tool's .msb brain file to find its PARAMETER_SCHEMA, decodes the Xcodes in bytes 1-62 according to the schema, executes the tool with the decoded parameters and the inputs available at that point.
3. Outputs from each tool are available as inputs to subsequent tools (slot 1's output → slot 2's input → slot 3's input, etc., with .msb declarations specifying how outputs map to inputs).
4. Final output is what the last non-empty slot produced.
5. Fitness is computed across the full execution using the canonical Option C-prime formula (adopted in Packet 28):

   ```
   fitness = correctness × 1 / (1 + 0.1 × max(0, tool_calls - slot_count))
   ```

   The first `slot_count` tool calls are free (one per slot is the minimum). Each excess call applies a gentle multiplicative penalty (α = 0.1, Bayesian-optimized in Packet 27). A perfectly-orchestrating composition of any slot count achieves fitness = correctness, eliminating the structural 1/k ceiling of the prior formula (`correctness × 1/tool_calls`) which Packet 26 proved capped k-slot compositions at 1/k.

The Martian's genome **is** its behavior. Same genome, same inputs → same outputs, same fitness. Always.

### 2.4 Martian types

A **Martian type** is a registered, named composition pattern. Examples:

- `search_then_extract` — slot 1 = search_text, slot 2 = extract_json, slots 3-4 = empty
- `fetch_then_parse` — slot 1 = http_get, slot 2 = extract_json, slots 3-4 = empty
- `compute_then_validate` — slot 1 = compute, slot 2 = extract_json, slots 3-4 = empty

The Martian *type* declares which tools occupy which slots. The genome's parameters within those slots evolve. So there's a population of `search_then_extract` genomes, all with search_text in slot 1 and extract_json in slot 2, but with varying parameters that selection pressure tunes.

The first 8 Martian types are an architectural decision; eventually the registry grows to dozens or hundreds. Adding a Martian type is a content change (declaring a new composition), not a code change.

---

## 3. Xcode encoding

The fundamental unit of parameter encoding is the **Xcode** — a pair of two adjacent Base62 characters representing one parameter.

### 3.1 Xcode definition

- Each Xcode is exactly 2 Base62 characters
- Encodes a numeric value in range [0, 3843] (62² - 1 = 3843)
- One Xcode encodes exactly **one parameter** (no multi-parameter packing, no mode-boundary cliffs)

Within a 64-character tool slot:
- Byte 0 = tool ID
- Bytes 1-62 = 31 Xcodes (62 chars / 2 chars per Xcode)
- Byte 63 = slot checksum

So each tool slot can encode **up to 31 distinct parameters** for the tool. Most tools use 5-10 parameters; the remaining Xcodes are reserved/unused. .msb files declare which Xcodes are in use and what they mean.

### 3.2 Why one Xcode per parameter (no multi-mode packing)

An earlier design considered packing multiple discrete modes into a single Xcode (e.g., Xcode 0-1280 = mode A, 1281-2560 = mode B, 2561-3843 = mode C). **Rejected.** Reason: mode-boundary cliffs cause evolutionary instability. A small mutation near a boundary produces a sudden behavioral jump, breaks fitness gradient, makes selection's job harder.

The corrected rule: **each Xcode encodes one continuous parameter.** If a tool needs multiple discrete behavioral modes, those become separate Xcodes (one Xcode per mode parameter). If a parameter is *genuinely* discrete (no natural ordering), strongly prefer to make it a tool-level constant in the .msb declaration rather than an evolvable Xcode — discrete-without-ordering parameters don't benefit from genome evolution and waste a slot.

### 3.3 Parameter range mapping

The .msb file declares the natural range for each parameter (e.g., `max_results: 1-50`). The Xcode value (0-3843) is mapped to the natural range linearly:

```
parameter_value = floor(xcode_value * (range_max - range_min + 1) / 3844) + range_min
```

A `max_results` parameter with range 1-50 and Xcode value 0 decodes to 1; Xcode value 3843 decodes to 50; Xcode value 1922 decodes to 25. The mapping is monotonic — Xcode neighborhoods correspond to parameter neighborhoods, which is what makes step-based mutation work.

---

## 4. The .msb (Martian Standard Brain) file format

Each canonical tool has exactly one .msb file in `seed/msb/`. The .msb is the tool's **specification** — what it does, what parameters it accepts, how each parameter is encoded in genome bytes, what direction beneficial mutations point in.

### 4.1 .msb sections

Every .msb file has these sections, in order:

1. **HEADER** — tool name, version, tool ID, brief description
2. **CAPABILITY** — prose description of what the tool does
3. **INPUTS** — what inputs the tool consumes (from prior slot outputs or campaign-level inputs)
4. **OUTPUTS** — what outputs the tool produces
5. **PARAMETER_SCHEMA** — declarations for every Xcode the tool uses (see §4.2)
6. **CORRECTNESS_HEURISTIC** — how the tool computes its correctness score
7. **TOOL_CALLS_ACCOUNTING** — how the tool counts its tool_calls

### 4.2 PARAMETER_SCHEMA entries

Each entry in PARAMETER_SCHEMA describes one Xcode. Format:

```yaml
- xcode_index: 0          # which Xcode within the slot (0-30)
  name: max_attempts      # parameter name
  description: "Number of retry attempts on transient failure"
  range: [1, 5]           # natural value range, inclusive
  default: 1              # value used if Xcode decodes ambiguously (e.g., empty slot)
  direction: lower        # mutation bias: lower | higher | none
```

`direction: lower` means "lower values are environmentally preferred; mutations bias toward decreasing." `direction: higher` is the mirror. `direction: none` for parameters with no natural environmental gradient.

The mutation operator (§5) reads PARAMETER_SCHEMA at mutation time to decide how to bias each Xcode's mutation step.

### 4.3 Tool-level constants

Parameters that are NOT evolvable (e.g., a tool's choice of underlying library, a fixed retry strategy) are declared in the CAPABILITY or HEADER sections, not PARAMETER_SCHEMA. .msb authors should resist the temptation to put non-evolvable choices into PARAMETER_SCHEMA — it wastes Xcodes and confuses the evolution layer.

---

## 5. Mutation: step-based, directional

The previous mutation operator (Packet 4) was a **random-walk** mutation: pick a byte, replace it with a random different Base62 character. This produces large unpredictable jumps in parameter values, breaks fitness gradient, and wastes generations on exploration that selection can't filter usefully.

The corrected operator is **step-based with directional bias**.

### 5.1 Step-based mutation

Mutations operate on **Xcodes**, not bytes. When a mutation lands on an Xcode currently at value V, the new value V' is sampled from a step distribution:

| Step magnitude | Probability |
|---|---|
| ±1 | 60% |
| ±2 | 25% |
| ±3 | 10% |
| ±4 | 5% |

Direction (whether the step is + or −) depends on the parameter's PARAMETER_SCHEMA `direction` declaration:

- `direction: lower`: 70% probability negative, 30% probability positive
- `direction: higher`: 30% probability negative, 70% probability positive
- `direction: none`: 50/50

Boundary handling: **clamp**. If V is at the floor of the parameter's range and the step would go below, clamp at floor. Same for ceiling. Wrapping is rejected — wrap creates a discontinuity (3843 → 0 in one step) that's exactly the cliff we're trying to avoid.

### 5.2 Mutation rate

Per-genome mutation probability stays at 1/256 per character (matching the locked GENOME_SPEC.md). But mutations no longer operate per-character — they operate per-Xcode. The actual rate becomes 1/256 * 2 = ~0.78% per Xcode per generation, since each Xcode is 2 chars. This is a near-equivalent rate to what's there now; the change is in *how* mutations apply, not *how often*.

### 5.3 Crossover

Crossover stays slot-aligned: when two genomes crossover, the cut points are at slot boundaries (positions 64, 128, 192). This keeps tool slots intact and avoids producing children with corrupted slot structure. Within-slot crossover (cutting in the middle of a slot's Xcodes) is rejected — it breaks the slot's checksum and produces invalid children.

### 5.4 Migration from current operator

The current Packet 4 mutation operator and the population layer it feeds need a coordinated update:
- Replace per-character random-walk with per-Xcode step-based directional
- Read `direction` declarations from .msb files at mutation time
- Update fixture cases to reflect new mutation behavior
- Re-run sensitivity audit (Packet 8.5 infrastructure) and evolution experiments to confirm directed evolution still works under the new operator

This is non-trivial work. Packet 15 in the next-packet queue addresses it.

---

## 6. The two parallel versions

AlienClaw exists as **two parallel implementations**, one for Hermes and one for OpenClaw. They are functionally identical: same Martians, same tools, same .msb files, same genome mechanism, same leaderboard, same community network. They differ only in how the **three governance agents (BossBot, AdvisorBot, CreatorBot)** integrate with their host agent framework.

This is not a stack. It's not "Hermes installs first, then OpenClaw, then AlienClaw on top." It's two independent installations:

- **AlienClaw for Hermes** — three governance agents speak Hermes' agent protocol; everything below the governance layer is shared
- **AlienClaw for OpenClaw** — three governance agents speak OpenClaw's agent protocol; everything below the governance layer is shared

When a feature lands in one version, it lands in the other. The shared substrate (Specialists, Martians, tools, genome, evolution, diagnostics, API) is one codebase. The governance shim is two codebases — one per host framework.

### 6.1 What this means for the existing repo

The current repo has been restructured in Packet 14 to support two versions:

```
src/alienclaw/
  governance/
    hermes/        # Hermes-specific BossBot/AdvisorBot/CreatorBot (future)
    openclaw/      # OpenClaw-specific BossBot/AdvisorBot/CreatorBot (future)
    common/        # comm graph, message types, all current framework-agnostic code
  specialists/     # one shared implementation
  martians/        # one shared implementation (NEW — see §7)
  tools/           # canonical tool registry (renamed from bridge/runners/)
  genome/          # unchanged
  brains/          # unchanged
  fitness/         # unchanged
  evolution/       # unchanged
  diagnostics/     # unchanged
  api/             # unchanged
  bridge/          # unchanged (wires Specialists ↔ Martians)
```

Either version installs the same shared substrate; the difference is which governance/ subdirectory is active. Build/install scripts pick one. The `common/` subdirectory holds anything used by both versions (the comm graph, message types, logger).

---

## 7. What the existing code needs to become

The existing code is mostly correct in *implementation* and incorrect in *naming and structure*. Most code is salvageable — the change is conceptual and structural, not a rewrite.

### 7.1 Things renamed in Packet 14

| Old | New | Notes |
|---|---|---|
| `src/alienclaw/bridge/runners/` (8 files: compute.py, http_get.py, etc.) | `src/alienclaw/tools/` | These are tools, not Martians. Each file is one canonical tool. |
| `RUNNER_REGISTRY` | `TOOL_REGISTRY` | The dict mapping tool name → tool function. |
| `src/alienclaw/governance/*.ts` | `src/alienclaw/governance/common/*.ts` | All current governance code is framework-agnostic, goes in common/. |

### 7.2 Things still misnamed

| Current | Correct | Notes |
|---|---|---|
| Phrasing "Martian type = compute" | "Tool = compute" | The 8 things called "Martians" throughout the arc are actually tools. |
| `martian_type` parameter in API and bridge | `tool_id` (when referring to a single tool) or `martian_type` (when referring to a composition — these now exist) | Both terms are valid post-correction; the meaning changes. Packet 16 resolves. |

### 7.3 Things missing today

| Concept | Status | Notes |
|---|---|---|
| Martian as first-class type | Doesn't exist in code | A class/struct holding 4 tool slots, dispatching the 4-tool execution. Packet 16 builds this. |
| Martian registry | Doesn't exist | A registry of named Martian types (search_then_extract, fetch_then_parse, etc.). Packet 16 builds this. |
| .martian files | Don't exist | Each Martian type gets a .martian file declaring which tools fill which slots. Packet 16 introduces this format. |
| Xcode encoding | Doesn't exist | Today the genome decodes as bytes, not Xcode pairs. Packet 15 introduces Xcode-aware decoding. |
| Step-based directional mutation | Doesn't exist | Today the operator is random-walk. Packet 15 replaces it. |
| .msb PARAMETER_SCHEMA `direction` field | Doesn't exist | Schema entries today have name, range, default; need to add direction. Packet 15 adds it. |

### 7.4 Things in the existing code that are correct as-is

- The genome layer (Packet 4): 256-char Base62, FNV-1a checksum, mutation/crossover operators (modulo §5's redesign of mutation behavior).
- The .msb parser (Packet 5): parses the existing sections; will need extension for `direction` field but the parser architecture stays.
- The bridge (Packet 7): subprocess-based JSON-over-stdio wire format. Still correct.
- The fitness function (Packet 28 revision): `correctness × 1/(1 + 0.1 × max(0, tool_calls - slot_count))`. Applied at the Martian (composition) level. Replaces the Packet 7 formula `correctness × 1/tool_calls` which had a structural 1/k ceiling for k-slot compositions (proven in Packet 26; revised in Packet 28 based on Packet 27 scaling research).
- The evolution layer (Packet 8): population storage, tournament selection, generational step. Still correct, with mutation operator updated.
- The diagnostics module (Packet 8.5): instrumentation, paired-comparison audit, stub server. Still correct, used for Martian-level audits going forward.
- The API server (Packet 10): all 6 endpoints. Submissions reference Martian types; the validation needs to extend (decode all 4 slots, not just 1), but the structure is right.
- The Specialist 5-file workspace (Packet 11): SOUL/CAMPAIGN/TOOLS/MEMORY/HEARTBEAT. Still right; TOOLS now declares allowed Martian types instead of allowed tools.

---

## 8. Open questions deferred for later

The following are real questions but deferred — they don't block the architecture correction or the next several packets:

- **Tool output → input mapping inside a Martian.** When slot 1's tool produces output, how does slot 2's tool know which fields of that output to consume as inputs? .msb files need to declare this; the syntax for cross-slot data flow needs design.
- **Partial-Martian execution.** What happens when slot 2 fails? Does the Martian fail entirely (slots 3-4 not executed), retry slot 2, skip to slot 3? Probably "fail entirely" for v1.0; revisit if the data shows it matters.
- **Martian-level parameter conflicts.** If slot 1's tool wants a long timeout and slot 2's tool wants a short one, do they conflict, or are timeouts always per-tool? Per-tool, but worth documenting.
- **Genome migration when a tool's PARAMETER_SCHEMA changes.** If we add a new Xcode to compute.msb, what happens to existing genomes that didn't account for it? Probably "the new Xcode reads its default value" — but the policy should be explicit.

These get answered when they bite. Don't try to solve them speculatively.

---

## 9. The next-packet queue

**Packet 15 — Xcode encoding + step-based directional mutation.** Replaces the byte-level random-walk mutation operator with Xcode-level step-based directional. Updates all 8 .msb files' PARAMETER_SCHEMA entries with `direction` fields. Updates the genome decoder to operate on Xcodes. Re-runs the sensitivity audit; expects sensitivity to improve because mutations no longer waste generations on huge jumps. ~10 hours.

**Packet 16 — Martian as first-class type + registry + first 8 compositions.** Introduces `src/alienclaw/martians/`, the Martian class, the registry, the `.martian` file format. Defines the first 8 Martian types as concrete compositions of canonical tools. Updates the bridge to summon by Martian type (decoding all 4 slots) rather than by tool. Updates the API server to accept Martian-level submissions. ~12 hours.

**Packet 17 — Specialist simplification.** Revisits the Specialist multi-summon machinery from Packets 11 and 13. Removes redundancy with native Martian composition. Keeps useful pieces (workspace files, budget enforcement, MEMORY-driven decisions across multiple *Martian-type* summons). Documents what Specialists do today vs. what they'll do post-LLM-backing. ~8 hours.

**Packet 18 — Martian-level sensitivity audit + directed evolution.** Re-runs the Packet 8.5/8.6/8.7 audit and evolution experiments at the Martian level (compositions, not single tools). Confirms directed evolution works on real Martians. Updates LESSONS_FROM_THE_ARC with the post-correction findings. ~10 hours.

**Packet 19 — Pre-launch hygiene revision.** Re-checks the Packet 12 hygiene work (rate limiter, audit log, web_search backend) against the corrected architecture. Most should still apply; some may need adjustment. ~4 hours.

---

## 10. How to use this document

This document is the canonical reference for AlienClaw's architecture as of post-correction. When future packets reference "the architecture," they reference this document. When existing code conflicts with this document, this document wins (and the conflict gets resolved in the next applicable packet, not silently ignored).

If the architecture changes again — and at this stage of a research project, it might — this document gets a versioned update (`ARCHITECTURE_v2.md`) rather than being edited in place. v1 stays as the historical record. Packets reference whichever version was current when they were written.

---

*Architecture correction document. Committed at Packet 14.*
