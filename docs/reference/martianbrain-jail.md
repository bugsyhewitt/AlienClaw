# MartianBrain Jail Specification

This document states what each brain may and may not do, what enforces each
boundary in code, and what currently remains unproven.

See also: `docs/how-to/adding-a-martianbrain.md` for the admission checklist.

---

## Jail overview

The MartianBrain jail is the security boundary between a leaderboard genome and
the host machine. Genomes are externally provided and must be treated as hostile
input. The jail provides three layers of containment:

1. **Codec validation** — invalid genomes (wrong length, bad checksum, non-Base62)
   are rejected before any execution begins.
2. **Tool-level boundaries** — each brain enforces its own input limits and access
   controls (documented per-brain below).
3. **SSRF hardening** — all outbound network requests go through
   `src/alienclaw/net/hardened-fetch.ts` which resolves DNS, validates every
   returned address, and re-validates every redirect hop.

---

## Per-brain boundary table

### compute

| Item | Detail |
|---|---|
| **May do** | Evaluate arithmetic / math expressions via an AST allowlist |
| **May not do** | Access globals, import modules, make network calls, read/write files |
| **What enforces** | AST allowlist in `src/alienclaw/tools/compute.py:_eval_sandboxed()` |
| **Timeout** | 60-second SIGALRM (Unix); skipped on Windows |
| **Exponent guard** | Right operand must be a literal ≤ 100; left operand literal ≤ 10^15 |
| **Unproven** | Signal delivery on heavily loaded systems; Windows timeout |

### extract_json

| Item | Detail |
|---|---|
| **May do** | Parse JSON and extract values at declared paths |
| **May not do** | Network calls, file I/O, execute code |
| **What enforces** | 10 MB input cap (pre-parse); 32-level nesting depth check (post-parse) |
| **Timeout** | None — `json.loads` is CPython C code; assumed bounded by size cap |
| **Unproven** | Pathological JSON strings that are small but slow to parse |

### file_read

| Item | Detail |
|---|---|
| **May do** | Read files inside the workspace boundary |
| **May not do** | Read `~/.openclaw/**`, dotfiles, files outside workspace, symlink targets outside workspace |
| **What enforces** | `_boundary.py:assert_inside_boundary()` — uses `os.path.realpath()` |
| **TS side** | `tool-adapters.ts:assertInsideBoundary()` — uses `fs.realpathSync()` |
| **Unproven** | TOCTOU between realpath check and open (mitigated by read-only; no write path here) |

### file_write

| Item | Detail |
|---|---|
| **May do** | Write files inside the output subdirectory of the workspace |
| **May not do** | Write `~/.openclaw/**`, dotfiles, symlink targets, files outside output dir |
| **What enforces** | `_boundary.py:assert_inside_boundary()` + `assert_no_symlink()` |
| **TS side** | `tool-adapters.ts:assertInsideBoundary()` + symlink check (pending T8 wiring) |
| **Size cap** | Enforced by `limits.py:MAX_TOOL_IO_BYTES` (10 MB) |
| **Unproven** | TS side `assert_no_symlink` not yet wired; race between check and write |

### http_get

| Item | Detail |
|---|---|
| **May do** | HTTP GET to SSRF-validated URLs |
| **May not do** | Reach private IPs, loopback, link-local, cloud metadata (169.254.x.x) |
| **What enforces** | `hardenedFetch` in `src/alienclaw/net/hardened-fetch.ts` |
| **Redirect guard** | Each redirect hop is re-validated |
| **Unproven** | DNS rebinding after initial validation (mitigated by same-resolver construction) |

### search_text

| Item | Detail |
|---|---|
| **May do** | Search text bodies with literal, glob, or regex patterns |
| **May not do** | Execute code, make network calls, access files |
| **What enforces** | Pattern length cap: 200 chars; 5-second SIGALRM timeout (Unix) |
| **Unproven** | ReDoS via patterns within the 200-char limit; Windows timeout |

### url_fetch

| Item | Detail |
|---|---|
| **May do** | HTTPS GET to SSRF-validated URLs in the allowed-hosts list |
| **May not do** | Reach any host not in `ALLOWED_FETCH_HOSTS`; any non-HTTPS URL |
| **What enforces** | `assertSafeFetchUrl()` (belt-and-suspenders) + `hardenedFetch` (DNS pin + redirect revalidation) |
| **Unproven** | Same as http_get (DNS rebinding) |

### web_search

| Item | Detail |
|---|---|
| **May do** | Web search queries (stub pending OpenClaw v0.2 wiring) |
| **May not do** | Currently a stub — returns empty results |
| **What enforces** | Stub adapter; no real network call made |
| **Unproven** | Full network hardening once real wiring is in place |

---

## Global jail properties

- **LLM-free**: no brain makes any LLM API call during Martian execution (canon 2).
- **Deterministic fixtures**: all 8 brains have fixture-based tests in `test/fixtures/`.
- **No global state**: brains do not modify shared process state (no env mutation, no signal handlers that persist beyond the tool call).

---

## Known gaps (follow-ups)

| Gap | Follow-up packet |
|---|---|
| TS `file_write` symlink check not fully wired | P1 follow-up or P2 |
| `web_search` stub needs real SSRF hardening on wiring | P6 or P7 |
| Windows-platform timeout (no SIGALRM) | P2 or P3 |
| DNS rebinding (mitigated but not fully closed) | P6 |
