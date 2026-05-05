---
spec: GENOME_SPEC
version: "1.0"
status: locked
last-updated: 2026-05-05
---

# Genome Specification

## Purpose and scope

The genome is a 256-character Base62 string that defines a Martian's behavioral
configuration. It encodes the Martian's identity (taxonomy within the registry), its
execution policy (retry count, backoff timing, flow type, performance mode), and its
behavioral contract (escalation policy, output contract type). The genome does NOT
select which tools a Martian uses — tool selection is handled separately in the `.ms`
file's `[TOOLS]` section. The genome configures HOW the Martian executes those tools
and WHAT HAPPENS when things go wrong.

The genome is the unit of evolution. CreatorBot mutates and crosses over genomes.
Fitter genomes survive selection. The community network propagates top-performing
genomes globally. Static tool logic (martianbrain files) is the substrate that
genomes flow into at runtime — brains don't evolve, genomes do.

This spec is the single source of truth. Packet 4 implements the Genome class against
this document. Any discrepancy between this document and an implementation is a bug
in the implementation.

---

## Encoding

The Base62 alphabet is exactly 62 characters in this order:

```
0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz
```

Position 0 = `0`, position 9 = `9`, position 10 = `A`, position 35 = `Z`,
position 36 = `a`, position 61 = `z`.

Properties of this alphabet:

- **Filename-safe**: no `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`
- **URL-safe**: no `+`, `/`, `=` (standard Base64 hazards absent)
- **Shell-safe**: no `$`, `` ` ``, `'`, `"`, spaces, or metacharacters
- **Case-sensitive**: `A` ≠ `a`

Evidence: `src/alienclaw/registry/genome-codec.ts:18` defines
`BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'`.

Encoding is NOT Base64. Any genome containing `+`, `/`, or `=` is invalid.

---

## Length

A valid genome is **exactly 256 characters**. No more, no fewer.

- A genome of 255 characters MUST be rejected.
- A genome of 257 characters MUST be rejected.
- A genome of 256 characters containing any non-Base62 character MUST be rejected.
- Length check MUST happen before character validation (fail fast on wrong length).

Evidence: `src/alienclaw/registry/genome-codec.ts:20` defines `GENOME_LENGTH = 256`.

---

## Section structure

The 256 characters are divided into four sections of exactly 64 characters each:

| Section | Name | Chars | Purpose |
| --- | --- | --- | --- |
| 0 | IDENTITY | `genome[0:64]` | Martian taxonomy: ID, generation, namespace, family |
| 1 | EXECUTION | `genome[64:128]` | Runtime policy: retry count, backoff, flow, performance |
| 2 | BEHAVIOR | `genome[128:192]` | Failure contract: escalation mode, output contract type |
| 3 | CHECKSUM | `genome[192:256]` | Integrity: FNV-1a-inspired hash of sections 0-2 |

Section boundaries are positional. There are no delimiters within the genome string.
Evidence: `src/alienclaw/registry/genome-codec.ts:21-22` defines `SECTION_SIZE = 64`,
`SECTION_COUNT = 4`. `src/alienclaw/registry/seed-installer.ts:44-61` documents the
per-section layout in comments.

---

## Per-section encoding

### Section 0 — IDENTITY (chars 0–63)

Encodes the Martian's taxonomy and provenance. Mutable by CreatorBot only.

| Chars | Field | Format | Example |
| --- | --- | --- | --- |
| 0–7 | Martian ID tag | 8 Base62 chars | `WEB00001` |
| 8–9 | Generation marker | `G` + digit | `G1` |
| 10–19 | Origin namespace | 10 Base62 chars | `AlienClaw1` |
| 20–63 | Tool family label + padding | ASCII label then `0`-padded | `WebSearchFamily000...` |

**Padding**: unused tail characters in the label are filled with `0` (the Base62
character `0`, ASCII 48). The pad64() convention always ensures exactly 64 chars.
Evidence: `src/alienclaw/registry/seed-installer.ts:63-66` defines the `pad64(s)`
helper that appends `'0'.repeat(64 - s.length)`.

The ID tag (chars 0-7) MUST be unique within the local registry. The ID tag is a
stable identifier — it MUST NOT change when the genome is mutated or crossed over.
Only CreatorBot may write a new ID tag when it mints a new Martian.

### Section 1 — EXECUTION (chars 64–127)

Encodes the Martian's runtime execution policy. Mutable by evolution.

| Chars | Field | Decode | Range |
| --- | --- | --- | --- |
| 64 (local [0]) | Max retry attempts | `(charCode - 48) mod 5 + 1` | 1–5 |
| 65 (local [1]) | Backoff interval ms | `(charCode - 48) mod 10 × 500` | 0–4500ms |
| 66–127 (local [2–63]) | Flow label + performance label + padding | ASCII label then `0`-padded | — |

**Retry decode example**: char value `'3'` (ASCII 51) → `(51 - 48) mod 5 + 1 = 4` attempts.

**Backoff decode example**: char value `'R'` (ASCII 82) → `(82 - 48) mod 10 × 500 = 2000ms`.

Known flow labels: `Sequential` (execute tools in sequence), `Parallel` (where
supported by the tool runtime). Known performance labels: `PerfBalanced`,
`PerfFast`, `PerfSafe`. Unknown labels MUST be treated as `PerfBalanced` (safe
default).

Evidence: `src/alienclaw/registry/seed-installer.ts:53-56` documents the execution
layout. Seed example: `'3RSequentialPerfBalanced'` padded to 64 chars.

### Section 2 — BEHAVIOR (chars 128–191)

Encodes the Martian's failure and output contract. Mutable by evolution.

| Chars | Field | Decode | Values |
| --- | --- | --- | --- |
| 128 (local [0]) | Escalation mode | Single char | `'E'` = standard escalation (failForward=false), `'F'` = fail-forward (failForward=true) |
| 129–191 (local [1–63]) | Escalation label + output contract type + padding | ASCII label then `0`-padded | — |

**Escalation mode**:

- `'E'` (EscalateStd): on failure after max retries, escalate to the Specialist that summoned the Martian. `failForward = false`.
- `'F'` (FailForward): on failure after max retries, continue with a placeholder result and report the failure in the fitness log. `failForward = true`.

Any char other than `'E'` or `'F'` in position 128 MUST default to `'E'` (safer behavior).

Known output contract types: `OutputJSONArray`, `OutputFileContent`, `OutputWriteConfirm`,
`OutputHTMLText`, `OutputText`, `OutputBool`. The output contract type SHOULD match the
tool's declared output schema in its martianbrain file.

Evidence: `src/alienclaw/registry/seed-installer.ts:58-60` documents the behavior
layout. `src/alienclaw/registry/genome-codec.ts:24-29` defines `SECTION` constants.

### Section 3 — CHECKSUM (chars 192–255)

A 64-character Base62 checksum computed from sections 0–2 (chars 0–191). It is the
integrity seal of the genome. It MUST NOT be hand-written. It MUST be recomputed
whenever sections 0–2 change (mutation, crossover, or assembly).

**Algorithm** (FNV-1a-inspired rolling hash, mapped to Base62):

```
a = 0x811c9dc5
b = 0xc59d1c81
for each char c at index i in genome[0:192]:
    a = (a XOR charCode(c)) * 0x01000193  (unsigned 32-bit)
    b = (b XOR (charCode(c) >>> 4)) * 0x01000193  (unsigned 32-bit)

digits = ""
hi = a, lo = b
for i in 0..63:
    idx = (hi XOR lo XOR i) mod 62
    digits += BASE62_ALPHABET[abs(idx)]
    hi = (hi * 31 + lo + i) mod 2^32
    lo = (lo * 37 + hi) mod 2^32

checksum = digits  (64 chars)
```

Evidence: `src/alienclaw/registry/genome-codec.ts:60-87` implements `computeChecksum()`.

A genome whose stored checksum does not match the recomputed checksum MUST be rejected
as invalid.

---

## Decode procedure

Given a 256-character genome string, the decode procedure produces a `MartianConfig`:

```pseudocode
function decode(genome: string) → MartianConfig:
    if len(genome) != 256: raise InvalidGenomeError("length")
    if any char not in BASE62_ALPHABET: raise InvalidGenomeError("alphabet")

    sections = {
        IDENTITY:  genome[0:64],
        EXECUTION: genome[64:128],
        BEHAVIOR:  genome[128:192],
        CHECKSUM:  genome[192:256],
    }

    expected_checksum = computeChecksum(genome[0:192])
    if sections.CHECKSUM != expected_checksum:
        raise InvalidGenomeError("checksum mismatch")

    id_tag      = sections.IDENTITY[0:8]
    generation  = sections.IDENTITY[8:10]
    namespace   = sections.IDENTITY[10:20]
    family      = sections.IDENTITY[20:64].rstrip('0')

    retry_char  = sections.EXECUTION[0]
    retry_count = (ord(retry_char) - 48) % 5 + 1

    backoff_char = sections.EXECUTION[1]
    backoff_ms   = (ord(backoff_char) - 48) % 10 * 500

    flow_and_perf = sections.EXECUTION[2:64].rstrip('0')
    # Implementations split on known label boundaries

    escalation_char = sections.BEHAVIOR[0]
    fail_forward    = (escalation_char == 'F')
    if escalation_char not in ('E', 'F'):
        fail_forward = False  # safe default

    contract_label = sections.BEHAVIOR[1:64].rstrip('0')

    return MartianConfig(
        id_tag        = id_tag,
        generation    = generation,
        namespace     = namespace,
        family        = family,
        retry_count   = retry_count,
        backoff_ms    = backoff_ms,
        fail_forward  = fail_forward,
        output_contract = contract_label,
    )
```

Evidence: `src/alienclaw/registry/genome-codec.ts:89-100` implements `parseGenome()`
which splits the string into sections; `src/alienclaw/registry/genome-codec.ts:102-127`
implements `validateGenome()` which checks length, alphabet, and checksum.

---

## Mutation operator

Mutation operates on sections 0–2 only. Section 3 (CHECKSUM) MUST be recomputed after
any mutation.

**Algorithm**:

```pseudocode
function mutate(genome: string, rate: float = 1/256) → string:
    body = list(genome[0:192])  # sections 0-2 only
    for i in 0..191:
        if random() < rate:
            body[i] = random_choice(BASE62_ALPHABET)
    new_body = "".join(body)
    new_checksum = computeChecksum(new_body)
    return new_body + new_checksum
```

**Rate**: 1/256 per character per generation (one character expected to flip on average
per genome per generation). This is the v1 default. Implementations MAY tune the rate
but MUST document any deviation from 1/256.

**Rationale**: At 1/256, on average one out of 192 mutable characters flips per
generation (the checksum 64 chars are never mutated directly). This is low enough that
evolved fitness gains are rarely destroyed by a single mutation. High enough that the
population explores meaningfully at every generation.

**Identity tag protection**: The ID tag (chars 0–7) SHOULD NOT be mutated when
mutating an existing Martian's genome. The ID tag is a stable identity across
generations. Only CreatorBot mints new ID tags when creating new Martian types.
Mutation SHOULD restrict its random substitution range to chars 8–191.

**Alphabet validity**: The substituted character MUST be drawn from BASE62_ALPHABET.
Mutation MUST preserve genome alphabet validity.

**Checksum recompute**: After any character substitution, `computeChecksum(new_body)`
MUST be called and the checksum section replaced. A mutated genome with a stale
checksum is invalid.

---

## Crossover operator

Crossover operates at section boundaries. Two parent genomes produce one child. The
child takes each of sections 0–2 from either parent A or parent B, independently.
Section 3 (CHECKSUM) is always recomputed from the child's sections 0–2.

**Algorithm**:

```pseudocode
function crossover(parent_a: string, parent_b: string) → string:
    child_sections = []
    for i in 0..2:  # sections 0, 1, 2 (not checksum)
        start = i * 64
        end   = start + 64
        if random_bool():  # 50/50
            child_sections.append(parent_a[start:end])
        else:
            child_sections.append(parent_b[start:end])
    child_body = "".join(child_sections)
    child_checksum = computeChecksum(child_body)
    return child_body + child_checksum
```

**16 possible patterns**: There are 2^3 = 8 ways to assign sections 0–2 from two
parents, and with two parent choices it's 16 distinct outcomes (though A-A-A and B-B-B
produce a clone of a parent, which is valid).

**Rationale for section-boundary crossover**: Each 64-char section encodes a coherent
behavioral unit (identity, execution policy, or behavior contract). Slicing within a
section would produce partial execution policies or partial behavior contracts —
semantically incoherent. Section-boundary crossover preserves whole-unit genetic
material. Alternative operators (uniform per-character crossover, multi-point within
sections) SHOULD be evaluated experimentally in Packet 8 but are not v1.

**ID tag after crossover**: The child inherits one parent's full IDENTITY section,
including the ID tag. This is correct behavior — the child represents a configuration
of the same Martian type (same family, same toolset) just with a different behavioral
mix. If crossover produces a genuinely new type, CreatorBot MUST mint a new ID tag by
replacing chars 0–7 before the child is written to the registry.

---

## Validation rules

A genome MUST pass ALL of the following to be accepted:

1. `len(genome) == 256`
2. All 256 characters are in `BASE62_ALPHABET` (no `+`, `/`, `=`, spaces, etc.)
3. `computeChecksum(genome[0:192]) == genome[192:256]`
4. `genome[128]` is `'E'` or `'F'` (or the implementation treats unknown as `'E'`)
5. The genome's ID tag (chars 0–7) resolves to a known Martian type in the local
   registry (enforced at runtime, not at parse time — unknown ID tags are warned but
   not rejected at the codec level)

A genome MUST be rejected if it fails checks 1–3. Check 4 logs a warning and applies
the safe default (`'E'`). Check 5 is a runtime concern, not a codec concern.

Evidence: `src/alienclaw/registry/genome-codec.ts:102-127` implements `validateGenome()`
enforcing checks 1–3.

---

## Serialization

- **On disk** (`.ms` file, `[GENOME]` section): raw 256-char string, UTF-8, no
  padding, no wrapper.
- **In JSON** (e.g., leaderboard API): string field named `"genome"`, value is the raw
  256-char string.
- **In memory**: plain string in whatever the implementation language's native string
  type is. No special class needed for storage — validation is a call to `validateGenome()`.
- **Line endings**: MUST NOT split the genome across lines. The genome is always a
  single contiguous 256-char string with no embedded newlines.

---

## Worked examples

### Example 1 — MS_WEB00001 (web search, generation 1)

**Section bodies** (from `src/alienclaw/registry/seed-installer.ts:88-90`):

```
IDENTITY:  WEB00001G1AlienClaw1WebSearchFamily + 0-padding → 64 chars
EXECUTION: 3RSequentialPerfBalanced + 0-padding → 64 chars
BEHAVIOR:  EscalateStdOutputJSONArray + 0-padding → 64 chars
CHECKSUM:  (64-char FNV-1a hash of the above 192 chars, computed by assembleGenome())
```

**Decoded MartianConfig**:

```
id_tag:          "WEB00001"
generation:      "G1"
namespace:       "AlienClaw1"
family:          "WebSearchFamily"
retry_count:     (ord('3') - 48) % 5 + 1 = 4
backoff_ms:      (ord('R') - 48) % 10 * 500 = 2000
fail_forward:    false  ('E' = EscalateStd)
output_contract: "OutputJSONArray"
```

### Example 2 — MS_FREAD0001 (file read, generation 1)

```
IDENTITY:  FREAD001G1AlienClaw1FileReadFamily0 + 0-padding → 64 chars
EXECUTION: 2RSequentialPerfFast + 0-padding → 64 chars
BEHAVIOR:  EscalateStdOutputFileContent + 0-padding → 64 chars
CHECKSUM:  (computed)
```

**Decoded MartianConfig**:

```
id_tag:          "FREAD001"
generation:      "G1"
namespace:       "AlienClaw1"
family:          "FileReadFamily"
retry_count:     (ord('2') - 48) % 5 + 1 = 3
backoff_ms:      (ord('R') - 48) % 10 * 500 = 2000
fail_forward:    false  ('E' = EscalateStd)
output_contract: "OutputFileContent"
```

### Example 3 — Evolved variant of MS_WEB00001 after mutation

Suppose mutation flips `genome[64]` from `'3'` (retry=4) to `'1'` (retry=2),
and flips `genome[128]` from `'E'` to `'F'` (fail-forward enabled):

**Decoded MartianConfig**:

```
id_tag:          "WEB00001"  (unchanged — chars 0-7 preserved)
generation:      "G1"
retry_count:     (ord('1') - 48) % 5 + 1 = 2   (was 4)
backoff_ms:      2000  (char 65 unchanged)
fail_forward:    true   ('F' = FailForward)     (was false)
output_contract: "OutputJSONArray"
```

This variant tries fewer times before giving up, and doesn't escalate — it logs
failure and continues. If this variant achieves equal-or-better fitness on web_search
tasks, selection will favor it (fewer retries = fewer tool calls = better efficiency).

---

## Defaults chosen during specification

See `packet-03-defaults.md` for the consolidated defaults list with rationale.

Key defaults relevant to this spec:

- **Mutation rate**: 1/256 per character per generation (one expected flip per genome)
- **ID tag protection**: chars 0–7 excluded from random mutation
- **Crossover operator**: section-boundary single-point (not uniform per-char)
- **Escalation safe default**: unknown escalation char → `'E'` (EscalateStd)

---

## What is NOT in this spec

- **Specialist genomes**: Specialists do not carry a genome in current scope
  (512-char Specialist evolution is explicitly far-future, per ROADMAP.md Future section)
- **Genome lineage tracking**: which parent(s) produced a given genome; deferred to
  leaderboard v1.x or a future evolution spec
- **Fitness function**: how fitness is computed; that is the evolution implementation
  (Packet 8)
- **Multi-point or uniform crossover variants**: deferred to Packet 8 experimental
  evaluation
- **Genome compression or encoding wrappers**: the raw 256-char string is the
  genome; no zip, no Base64 wrapper, no envelope
- **Registry data model**: how genomes are stored in the registry and retrieved by
  fitness; that is `src/alienclaw/registry/` (Packets 5-6)
