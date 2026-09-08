# MartianBrain Catalog

Generated from `src/alienclaw/msb/registry.ts` (T4, PKT-P1). Do not hand-edit.
Regenerate with: `pnpm exec tsx scripts/gen-brains-doc.ts` (or read from the registry).

MSB version: 1.0

---

## Summary

| ID | Name | Version | In | Out | Annotation Class | Cost Class |
|---|---|---|---|---|---|---|
| 0 | compute | 1.0 | text | json | read-only | local |
| 1 | extract_json | 1.0 | json | json | read-only | free |
| 2 | file_read | 1.0 | path | text | read-only | free |
| 3 | file_write | 1.0 | text | path | additive-in-jail | free |
| 4 | http_get | 1.0 | url | text | open-world | network |
| 5 | search_text | 1.0 | text | matches | read-only | local |
| 6 | url_fetch | 1.0 | url | text | open-world | network |
| 7 | web_search | 1.0 | text | json | open-world | network |

---

## Brain details

### compute (id=0)

- **Annotation class:** read-only
- **Cost class:** local
- **Input type:** text (arithmetic expression)
- **Output type:** json (`{ result, input, resultType, operation, precision, steps }`)
- **Source:** `src/alienclaw/tools/compute.py`
- **MSB spec:** `seed/msb/compute.msb`
- **Security:** AST allowlist, 60-second SIGALRM timeout, exponent guard (right ≤ 100)

### extract_json (id=1)

- **Annotation class:** read-only
- **Cost class:** free
- **Input type:** json (raw JSON string)
- **Output type:** json (`{ extracted: { path: { value, type, found } }, inputKeys }`)
- **Source:** `src/alienclaw/tools/extract_json.py`
- **MSB spec:** `seed/msb/extract_json.msb`
- **Security:** 10 MB input cap, 32-level nesting depth limit

### file_read (id=2)

- **Annotation class:** read-only
- **Cost class:** free
- **Input type:** path (relative path within workspace boundary)
- **Output type:** text (file contents)
- **Source:** `src/alienclaw/tools/file_read.py` + `src/alienclaw/msb/tool-adapters.ts`
- **MSB spec:** `seed/msb/file_read.msb`
- **Security:** realpath-based boundary check, dotfile denial, OpenClaw workspace denial

### file_write (id=3)

- **Annotation class:** additive-in-jail
- **Cost class:** free
- **Input type:** text (content to write)
- **Output type:** path (confirmed write path)
- **Source:** `src/alienclaw/tools/file_write.py` + `src/alienclaw/msb/tool-adapters.ts`
- **MSB spec:** `seed/msb/file_write.msb`
- **Security:** realpath-based boundary check, symlink denial on write, 10 MB size cap

### http_get (id=4)

- **Annotation class:** open-world
- **Cost class:** network
- **Input type:** url (validated URL)
- **Output type:** text (HTTP response body)
- **Source:** `src/alienclaw/tools/http_get.py`
- **MSB spec:** `seed/msb/http_get.msb`
- **Security:** SSRF-guarded via `_ssrf_guard.py` (Python) + hardened-fetch (TS)

### search_text (id=5)

- **Annotation class:** read-only
- **Cost class:** local
- **Input type:** text (body to search)
- **Output type:** matches (`{ pattern, flavor, totalMatches, matches: [...] }`)
- **Source:** `src/alienclaw/tools/search_text.py`
- **MSB spec:** `seed/msb/search_text.msb`
- **Security:** 200-char pattern length cap, 5-second SIGALRM timeout

### url_fetch (id=6)

- **Annotation class:** open-world
- **Cost class:** network
- **Input type:** url (validated URL)
- **Output type:** text (response content)
- **Source:** `src/alienclaw/tools/url_fetch.py` + `src/alienclaw/msb/tool-adapters.ts`
- **MSB spec:** `seed/msb/url_fetch.msb`
- **Security:** SSRF-guarded via hardened-fetch + assertSafeFetchUrl (allowlist)

### web_search (id=7)

- **Annotation class:** open-world
- **Cost class:** network
- **Input type:** text (search query)
- **Output type:** json (search results array)
- **Source:** `src/alienclaw/msb/tool-adapters.ts` (stub pending OpenClaw v0.2)
- **MSB spec:** `seed/msb/web_search.msb`
- **Security:** Stub returns empty results; full SSRF hardening deferred to wiring

---

## Reserved codon values

Codon values 8–61 are reserved for future brains. At runtime they are treated
as no-ops (the Martian skips that slot). Never assign a new brain to an existing
reserved codon — always append to the registry with the next sequential id.

---

## Append-only guarantee

Brain IDs are permanent. Once assigned, an ID must never be renumbered, removed,
or reassigned to a different brain. Mark deprecated brains with `deprecated: true`
in the registry but leave the entry in place.
