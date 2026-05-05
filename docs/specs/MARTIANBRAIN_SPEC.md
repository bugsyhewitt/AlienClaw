---
spec: MARTIANBRAIN_SPEC
version: "1.0"
status: locked
last-updated: 2026-05-05
---

# Martianbrain Specification

## Purpose and scope

A martianbrain (`.msb`) file is a static, human-readable tool description that
interprets a Martian's decoded genome configuration into runtime behavior. One brain
file exists per tool. Brain files do NOT evolve — they are the stable substrate that
genomes flow into at runtime. The genome configures; the brain executes.

The relationship between genomes and brains:

```
Martian genome → decode() → MartianConfig (retry, backoff, escalation, output contract)
           ↓
    .msb brain file → interprets genome sections → drives tool execution
```

The genome defines HOW the Martian behaves (retry policy, escalation mode, performance
target). The brain defines WHAT the tool does and HOW those genome parameters are
applied to tool-specific behavior.

This spec covers the `.msb` file format, the brain registry, the genome-section
interpretation per brain, and the set of brains that Packet 5 will author. It does
NOT cover executable tool implementations — implementations are written in Packet 5.

---

## File format

Martianbrain files are plain text (not YAML, not JSON, not Markdown with YAML
frontmatter). The format uses labeled sections in ALL-CAPS terminated by a colon.
Sections appear in this canonical order:

```
TOOL: <canonical_tool_name>
VERSION: <major.minor>

CAPABILITIES:
<prose — what the tool can do>

LIMITATIONS:
<prose — what the tool cannot do, constraints>

FAILURE MODES:
<prose — specific failure conditions and recommended responses>

BEST PRACTICES:
<prose — guidance for Specialists and evolution agents on effective use>

EXECUTION ORDER:
<numbered steps — the deterministic sequence the tool follows>

OUTPUT CONTRACT:
<JSON schema or prose describing the output structure>

GENOME SECTIONS:
<per-section interpretation — see below>

VARIABLES:
<list of named inputs the tool accepts at runtime>
```

Evidence: `seed/msb/web_search.msb`, `seed/msb/file_read.msb`,
`seed/msb/url_fetch.msb`, `seed/msb/file_write.msb` are the canonical reference
implementations of this format. New brains MUST follow this format exactly.

### Mandatory sections

All sections listed above are MANDATORY. A brain file missing any section MUST be
rejected by the brain loader at registry startup.

### TOOL field

The canonical tool name. MUST match the tool name declared in the `.ms` file's
`[TOOLS]` section. MUST be lowercase with underscores (snake_case). Examples:
`web_search`, `file_read`, `http_get`, `compute`.

### VERSION field

`<major>.<minor>` format. Minor bumps (1.0 → 1.1) are backwards-compatible behavior
refinements. Major bumps (1.0 → 2.0) are breaking changes and MUST use a new brain
file name (see Versioning below).

### GENOME SECTIONS block

The most critical section. It defines how this brain interprets each of the three
mutable genome sections (IDENTITY, EXECUTION, BEHAVIOR) for THIS SPECIFIC TOOL.

Format (one entry per genome section, each on its own line):

```
GENOME SECTIONS:
IDENTITY: Chars 0-7 = <field name> (<example value>). Chars 8-9 = <field> (<example>). ...
EXECUTION: Char 0 = <field name> (<decode rule>). Char 1 = <field> (<decode rule>). ...
BEHAVIOR: Char 0 = <field name> (<values>). Chars 1-63 = <field> (<examples>).
CHECKSUM: FNV-1a-inspired 64-char Base62 hash of sections 0-2 (chars 0-191). Computed by assembleGenome(). Never hand-written.
```

Each brain MAY use only a subset of the available chars within a section. Unused chars
MUST be `0`-padded (the zero character, ASCII 48) and MUST round-trip unchanged.

Example from `seed/msb/web_search.msb`:

```
GENOME SECTIONS:
IDENTITY: Chars 0-7 = Martian ID tag (WEB00001). Chars 8-9 = generation marker (G1). Chars 10-19 = origin namespace (AlienClaw1). Chars 20-63 = tool family label (WebSearchFamily) + zero padding.
EXECUTION: Char 0 = retry attempt encoding (charCode-48 mod 5 + 1 = maxAttempts). Char 1 = backoff encoding ((charCode-48) mod 10 * 500ms). Chars 2-63 = flow label (Sequential) + performance mode (PerfBalanced) + zero padding.
BEHAVIOR: Char 0 = escalation mode ('E' = EscalateStd/failForward false, 'F' = failForward true). Chars 1-63 = escalation label + output contract type (OutputJSONArray) + zero padding.
CHECKSUM: FNV-1a-inspired 64-char Base62 hash of sections 0-2 (chars 0-191). Computed by assembleGenome(). Never hand-written.
```

### VARIABLES section

Named runtime inputs provided by the Specialist (or the execution context) at the
time the Martian is summoned. These are NOT encoded in the genome — they are
call-time parameters. Examples: `task`, `query`, `path`, `url`, `context`.

---

## Brain registry

Brain files live at `~/.alienclaw/registry/msb/`. This directory is populated by
`seed-installer.ts` on first run (Evidence: `src/alienclaw/registry/seed-installer.ts`)
and may be updated by CreatorBot as new brain types are authored.

The brain file for a given tool is referenced by name in the `.ms` file's `[TOOLS]`
section. Example from `MS_WEB00001`:

```
[TOOLS]
web_search      → web_search.msb
```

The runtime resolves `web_search.msb` to `~/.alienclaw/registry/msb/web_search.msb`.

**Auto-discovery**: The brain registry is built by scanning the `msb/` directory for
all `*.msb` files at startup. No manual registration step is required. Adding a new
brain file to the directory makes it available to any Martian that references it.

**Lookup at runtime**: When a Martian is summoned, the executor:

1. Reads the `.ms` file to get the tool name(s) and genome.
2. Decodes the genome (per GENOME_SPEC.md) to get MartianConfig.
3. Loads the corresponding `.msb` brain file for each tool.
4. Applies MartianConfig parameters to the brain's execution logic.
5. Runs the tool, returns output in the declared output contract format.

---

## Static-vs-evolving boundary

| Component | Evolves? | Who changes it? |
| --- | --- | --- |
| Brain file (`.msb`) | **NO** | Human authors (new versions require human review) |
| Martian genome (`.ms`) | **YES** | CreatorBot (mutation, crossover, selection) |
| Tool implementation | **NO** | Human authors (tied to brain major version) |

Brain files MUST NOT contain logic that varies based on historical state, random
seeds, or external service state. They define deterministic behavior given genome
parameters. If behavior needs to change, a new brain version (`.msb` major bump)
is required.

The genome is what makes a Martian unique and what evolves over generations. Two
Martians with the same tool set but different genomes will retry different numbers of
times, use different backoff strategies, and handle failures differently. The evolution
pressure is on finding which genome configuration achieves better fitness — not on
changing the tools themselves.

---

## Authoring rules

Brain authors MUST:

- Declare a unique `TOOL` name (no two brains may have the same tool name in the same registry)
- Use snake_case for the tool name
- Declare a `VERSION` in `<major.minor>` format
- Fill in all mandatory sections with substantive content (not placeholder text)
- Declare a `GENOME SECTIONS` block that accurately describes how this brain
  interprets the genome sections
- Declare all runtime variables in the `VARIABLES` section
- Ensure the `OUTPUT CONTRACT` exactly matches what the tool implementation returns
- Use `0`-padding for unused chars within a genome section
- Document all known failure modes in `FAILURE MODES`

Brain authors MUST NOT:

- Read state outside the runtime variables provided at invocation time
- Perform side effects beyond the tool's declared scope (e.g., a `file_read` brain
  MUST NOT write files)
- Modify the genome it received — brains are read-only consumers of genome config
- Use random seeds in the brain's logic (randomness belongs in the evolution layer,
  not in the brain)
- Hand-write a CHECKSUM section value — checksums are always computed by
  `assembleGenome()`

Brain authors SHOULD:

- Handle out-of-range decoded parameter values gracefully (clamp to declared range
  rather than crash)
- Include worked examples in the `BEST PRACTICES` section showing effective use
- Document the performance mode implications (PerfFast vs PerfBalanced vs PerfSafe)
  in terms of this specific tool's behavior

---

## Versioning

Brain version (`VERSION` field) is independent of the spec version.

- **Minor bump** (1.0 → 1.1): backwards-compatible refinement. Genomes that worked
  with 1.0 continue to work with 1.1. Same file name, same TOOL name.
- **Major bump** (1.0 → 2.0): breaking change. The brain MUST use a new file name
  (`web_search_v2.msb`) and the TOOL name MUST differ (`web_search_v2`). Old genomes
  pointing to `web_search.msb` continue to resolve to v1. New Martians minted by
  CreatorBot may point to `web_search_v2.msb`.

This versioning policy ensures old genomes never break when a brain is updated.
Evolution pressure will gradually migrate the population toward newer brain versions
as CreatorBot mints new Martians using the newer brain.

---

## Worked example — complete brain file

The following is a specification-complete brain file for the `http_get` tool (one
of the four new brains Packet 5 will author):

```
TOOL: http_get
VERSION: 1.0

CAPABILITIES:
Performs an HTTP GET request to a given URL and returns the response body.
Handles redirects (up to 5 hops). Returns response body as a string.
Best for: fetching API responses, configuration files, public data endpoints,
          pinging health endpoints.

LIMITATIONS:
GET only — does not support POST, PUT, DELETE, or PATCH.
Cannot send request bodies or multipart data.
Cannot handle authentication beyond URL-embedded credentials.
Maximum response size: 5 MB.
Binary responses returned as base64-encoded string.
Does not follow redirects to different domains (security constraint).

FAILURE MODES:
HTTP 4xx: do not retry — the error is deterministic; report URL and status code.
HTTP 5xx: retry per genome EXECUTION retry count and backoff.
DNS resolution failure: retry once after backoff; report if still failing.
Timeout: retry once; if still timing out, report with ESCALATE or FAILFORWARD per genome BEHAVIOR.
SSL certificate error: do not retry, do not bypass — report FAILURE immediately.
Redirect loop: abort after 5 hops, report FAILURE.

BEST PRACTICES:
Always validate the URL format before fetching.
Use this tool for machine-readable endpoints (JSON APIs, config files) — not for HTML pages.
For HTML pages, prefer url_fetch which applies readability extraction.
Set a User-Agent header identifying the Martian to allow server-side filtering.
If the response is unexpectedly large, truncate to maxBytes and note truncation in output.

EXECUTION ORDER:
1. Validate URL starts with https:// or http:// (reject others)
2. Resolve DNS for the host
3. Issue GET request with headers: User-Agent: AlienClaw-Martian/1.0
4. Follow redirects (max 5, same-domain only)
5. Check response status code
6. If 4xx: return FAILURE with status code
7. If 5xx: retry per genome retry_count and backoff_ms, then return FAILURE or ESCALATE per fail_forward
8. If 2xx: return response body up to maxBytes
9. Wrap result in OUTPUT CONTRACT format

OUTPUT CONTRACT:
{
  "url": "string",
  "finalUrl": "string",
  "statusCode": "integer",
  "content": "string",
  "contentType": "string",
  "truncated": "boolean",
  "bytesReturned": "integer"
}

GENOME SECTIONS:
IDENTITY: Chars 0-7 = Martian ID tag (HTTPGET0). Chars 8-9 = generation marker (G1). Chars 10-19 = origin namespace (AlienClaw1). Chars 20-63 = tool family label (HTTPGetFamily000) + zero padding.
EXECUTION: Char 0 = retry attempt encoding (charCode-48 mod 5 + 1 = maxAttempts). Char 1 = backoff encoding ((charCode-48) mod 10 * 500ms). Chars 2-63 = flow label (Sequential) + performance mode (PerfBalanced or PerfFast) + zero padding.
BEHAVIOR: Char 0 = escalation mode ('E' = EscalateStd/failForward false, 'F' = failForward true). Chars 1-63 = escalation label + output contract type (OutputHTTPResponse) + zero padding.
CHECKSUM: FNV-1a-inspired 64-char Base62 hash of sections 0-2 (chars 0-191). Computed by assembleGenome(). Never hand-written.

VARIABLES:
task: The natural language task description passed to this Martian
url: The validated URL to fetch (https:// or http://)
maxBytes: Maximum response size in bytes (from context, default 5242880)
context: Additional key-value pairs from the execution context
```

---

## Initial brain set

Packet 5 will author the following eight brain files. Four already exist in
`seed/msb/` (noted below). Four are new.

| Brain file | Tool name | Status | Purpose |
| --- | --- | --- | --- |
| `web_search.msb` | `web_search` | EXISTS in seed/msb/ | Web search query → results |
| `file_read.msb` | `file_read` | EXISTS in seed/msb/ | Read file by path → content |
| `file_write.msb` | `file_write` | EXISTS in seed/msb/ | Write string to file path |
| `url_fetch.msb` | `url_fetch` | EXISTS in seed/msb/ | Fetch URL → HTML/text content |
| `http_get.msb` | `http_get` | NEW — Packet 5 authors | HTTP GET → JSON/API response |
| `compute.msb` | `compute` | NEW — Packet 5 authors | Execute deterministic computation |
| `search_text.msb` | `search_text` | NEW — Packet 5 authors | Text search within a document |
| `extract_json.msb` | `extract_json` | NEW — Packet 5 authors | Extract fields from JSON blob |

**Rationale for initial 8**: covers the core capability surface (web fetch, file I/O,
API calls, computation, text operations). Enough to run nontrivial research and
data-processing campaigns without requiring Specialists to summon Martians for missing
tool types.

---

## Defaults chosen during specification

See `packet-03-defaults.md` for the consolidated defaults list.

Key defaults in this spec:

- **Brain file format**: plain text (not YAML/JSON) — matches existing seed/msb/ files
- **Registry location**: `~/.alienclaw/registry/msb/` — matches PATHS in constants.ts
- **Brain discovery**: directory scan (not a registry manifest) — simpler, no sync overhead
- **Initial brain count**: 8 (4 existing + 4 new) — covers core tool surface
- **Major version = new file name**: prevents old genome breakage on brain updates

---

## What is NOT in this spec

- **Executable brain implementations**: actual code that runs the tools; Packet 5 authors these
- **Brain composition / multi-tool chains**: a Martian's 4-slot genome implies it
  can reference up to 4 brains, but the composition semantics (sequential? parallel?
  conditional?) are not specced at the brain level — they emerge from the EXECUTION
  section's flow label and Packet 5's runtime design
- **Brain testing framework**: how to verify a brain implementation is correct;
  Packet 5 scope
- **Community-contributed brains**: brain submission to api.alienclaw.net or a
  community registry; far-future, not v1
- **Selector index concept**: the packet-proposed "4-char tool selector" per section
  was superseded by the existing .ms [TOOLS] section approach; tool selection happens
  at the .ms file level, not within the genome
