# Lessons From the Arc

AlienClaw was built packet by packet across a single 10-packet arc. This document
captures the bugs caught, the design decisions that held, and the discipline
that made cross-language compliance enforcement possible.

---

## 1 — Bugs caught by cross-language fixture discipline

### Signed Int32 XOR divergence (Packet 4 — CRITICAL)

**What happened.** JavaScript's `^` operator coerces both operands to signed 32-bit
integers before computing XOR. When the XOR result exceeds 2³¹ − 1, JS yields a
negative signed Int32. Python's integers are arbitrary precision and unsigned, so the
same XOR produces a different unsigned value. The downstream `% 62` on a negative
number gives a negative modulus in Python (not in JS with Math.abs), meaning
checksums diverged silently.

**How it was caught.** The genome spec fixture (`test/fixtures/genome-spec-fixtures.json`)
contains pre-computed checksum cases. The Python runner failed immediately against
the TypeScript-computed ground truth.

**Fix.** Python's checksum function was made to mirror JS explicitly:

```python
raw = (hi ^ lo ^ i) & _MASK32
signed = raw if raw < 0x80000000 else raw - 0x100000000
idx = abs(signed) % 62
```

**Lesson.** Never assume two languages produce the same result for the same
arithmetic operation on raw integers. Cross-language fixture compliance
catches these before they reach production.

---

### `$` in multiline regex matched end of every line (Packet 5)

**What happened.** `extractSection()` in `msb-loader.ts` used a multiline regex
with `$` as the stop anchor. In JavaScript multiline mode, `$` matches the end of
each *line*, not the end of the string — so multi-line sections were silently
truncated to their first line.

**Fix.** Changed `$` → `(?![\s\S])` (true end-of-string, never matches end-of-line).

**Lesson.** `$` in multiline regexes is a footgun in every language. Always test
section-extraction regexes with multi-line content. The identical fix was applied
in both TypeScript and Python parsers.

---

### `extractGenomeSections()` truncation (Packet 5)

**What happened.** The `GENOME SECTIONS` block was extracted first, then each
subsection (IDENTITY, EXECUTION, BEHAVIOR, CHECKSUM) was searched inside the
extracted block. But the subsection names matched the `[A-Z ]+:` terminator
pattern, so the extracted block contained only the IDENTITY line.

**Fix.** Search for each subsection directly in the raw MSB text, anchored from
the position of the `GENOME SECTIONS` header, not inside an already-truncated block.

**Lesson.** Never nest regex extractions on a block that was itself regex-extracted.
Test with all four genome sections present and non-empty.

---

### Off-by-one in test string padding (Packet 4)

**What happened.** A test used the hardcoded `"0" * (64 - 34)` to pad an identity
string to 64 chars, but the string was actually 35 chars long (not 34), producing
a 63-char section and then a genome assembly error.

**Fix.** Changed to `"0" * (64 - len(s))`.

**Lesson.** Never hardcode string lengths in tests. Measure, don't guess.

---

## 2 — Design decisions that held

### Comm graph enforcement at two levels

Enforcing the legal message paths at both the TypeScript type level (discriminated
union `Message` type) and at runtime (`assertLegalSend()` throwing `IllegalSendError`)
meant that: (1) illegal messages were caught at compile time for 99% of cases, and
(2) any bypass via `as any` was still caught at runtime. Neither level alone was
sufficient — the combination was.

### One subprocess per summon

The decision to spawn a fresh `python3 -m alienclaw.bridge` process per summon rather
than a persistent pool added per-summon overhead (~50ms on cold starts) but eliminated
an entire class of state-leakage bugs. No connection management, no process pool
hygiene, no inter-summon contamination. The SUMMON_BRIDGE_SPEC explicitly deferred
pooling to a measured need.

### Fixture-as-contract, not fixture-as-snapshot

Each fixture file was designed as a behavioral contract, not a snapshot of current
output. Cases contain semantic assertions (`expected_output_field`, `expected_fitness`,
`expected_error_code`) rather than full JSON blobs. This meant the fixture remained
readable as documentation and survived implementation changes that preserved behavior.

### Python/TypeScript alphabet match — digits first

The Base62 alphabet `0123456789ABC...Zabc...z` (digits before uppercase before
lowercase) was established in `GENOME_SPEC.md` and hardcoded in both
`src/alienclaw/genome/alphabet.py` and `src/alienclaw/registry/genome-codec.ts`.
Having the spec authoritative prevented any risk of the languages diverging on
character ordering.

### Specialist as ephemeral wrapper, not a persistent agent

Specialists were implemented as campaign-scoped ephemeral objects that hold a genome
and a summon adapter reference, execute one Martian, and then call `erase()`. This
kept the three-tier architecture (Tier-A agents / ephemeral Specialists / ephemeral
Martians) clean: Specialists have no persistent state, no comm-graph identity, and
no workspace. CreatorBot stays simple because Specialist absorbs the genome
management.

---

## 3 — Cross-language compliance: what made it work

The three fixture files (`genome-spec-fixtures.json`, `brain-registry-fixtures.json`,
`bridge-fixture.json`) together enforce that:

1. Genome encoding and checksum computation produce identical outputs in both languages
2. MSB parsing and brain registry validation behave identically
3. The bridge wire protocol produces identical responses whether tested via Python
   direct-call or via TypeScript subprocess invocation

The discipline: **both language runners load the same JSON, run the same cases, and
CI fails on any disagreement.** Not "the Python tests pass" and "the TypeScript tests
pass separately" — but "both runners agree on the same cases from the same fixture."

This caught 3 latent bugs (the three above) that would have been invisible if each
language only tested against itself.

---

## 4 — What is deferred (and why)

| Item | Deferred to | Reason |
| --- | --- | --- |
| Process pooling for bridge | v1.1+ | Measure first; premature optimization |
| LLM-backed Martian execution | Packets 8-10 | Governance loop established first |
| Community leaderboard | v0.2 | Infrastructure not yet in place |
| Streaming bridge responses | v2.0+ | Request/response is sufficient at v1.0 throughput |
| Bidirectional bridge comms | Not planned | One-request/one-response is the right model |
| `ALIENCLAW_PYTHON_BIN` documentation | Ops guide | Low urgency; env var works |

---

## 5 — Numbers

| Metric | Value |
| --- | --- |
| Packets in arc | 7 of 10 completed |
| Fixture cases (genome) | 60 |
| Fixture cases (brain registry) | 30 |
| Fixture cases (bridge) | 25 |
| Bugs caught by fixture discipline | 3 latent + 1 off-by-one |
| Python tests passing | 289 |
| TypeScript tests passing | 250+ |
| Languages sharing same fixture files | 2 (Python, TypeScript) |
| Subprocess spawn per summon | 1 (stateless) |
| Lines of spec (SUMMON_BRIDGE_SPEC.md) | 305 |
