# OSS Library Extraction Plan: agent-tool sandbox (SSRF guard + filesystem jail)

**Date:** 2026-11-26 (overnight salvage pass)
**Status:** PLAN ONLY. Nothing has been created, registered, published or sent. Repo creation,
package-name registration, the license, the security contact and the public identity are
Bugsy's decisions (see §8).
**Inputs read:** committed code at `HEAD` = `f5d321e3` of `overnight/2026-11-26`:
`staging/agent-tool-sandbox/python/` (from `fc3762e1`) and `staging/agent-tool-sandbox/ts/`
(from `f5d321e3`): README, PROVENANCE.json, pyproject/package.json, src, test names.
`SALVAGE.md` §2, `LICENSE`. A parallel agent is fixing three Python bugs tonight. Its edits
were **not** in the tree when this was read (working tree clean for that path), so this plan
describes the committed code and treats those fixes as gate G1.

---

## 1. Goal, non-goals, users, and how it compares

### Goal

A small, zero-runtime-dependency library in **TypeScript and Python** that gives an LLM-agent
builder deterministic guards for the two tool types that get abused most:

1. **Outbound HTTP** (an agent's `fetch_url` / `http_get` tool): it refuses internal,
   metadata, loopback and special-purpose destinations, and it checks every redirect hop.
   It also caps size and time.
2. **File access** (an agent's `read_file` / `write_file` tool): it keeps every path inside a
   root the caller picks, refuses traversal, symlink escape, denied sub-trees and dotfiles,
   and refuses symlinks on write.

What sets it apart is that **both languages make the same decision for the same input**. One
versioned block-list and one shared test-vector corpus are the contract, and CI enforces it.

### Non-goals (say these in the README)

- It is **not a sandbox in the OS sense**: no process isolation, no seccomp, containers or
  namespaces. The name invites that misreading, so the first README line must say "guards, not
  a sandbox" (see §2 for a name alternative).
- No prompt-injection detection, no content filtering, no LLM in the loop.
- Not an egress proxy and not a WAF. It protects the process that calls it, nothing else.
- Not a general tool-policy engine (rate limits, approvals, argument rules). That is a
  different product (for example `toolfence` on PyPI) and it complements this one.
- No Windows support for the filesystem jail in v0.1 (drive letters, junctions and ADS are
  untested). The SSRF half should work on Windows, but it is not in the CI matrix.
- No auth, cookies, sessions or retries. It is a guarded transport, not an HTTP client
  framework.

### Target users

- **Agent builders** who wire a fetch or file tool into LangChain/LangGraph, LlamaIndex, the
  OpenAI Agents SDK, Pydantic AI, smolagents, the Vercel AI SDK or Mastra.
- **MCP server authors.** Fetch and filesystem servers are the canonical SSRF and traversal
  surface, and the June 2026 IETF draft on MCP security says to validate the resolved IP
  *at connection time* (sources in §9).
- **Authors of pentest tools** that embed an LLM (the Pho3nix shape). Their agent must not be
  turned against the operator's own network.
- **Security reviewers** who want a public, versioned SSRF/traversal vector corpus to test
  any guard against. This audience is the consulting funnel.

### Comparables (checked 2026-11-26; their claims are taken from their own READMEs and were not verified)

| Library | Lang | State | Connect-time check / DNS pinning | Notes |
|---|---|---|---|---|
| `request-filtering-agent` | Node | MIT, active since 2019, 3.3.1 released 2026-11-21 | **Yes.** It checks the address the socket actually connects to | An `http(s).Agent`, so it fits node `http`, axios and got. It allows IPv6 only inside `2000::/3` (ipaddr.js `unicast`). It has a long track record. |
| `ssrf-guard` (npm) | Node ≥24, Workers | MIT, 1.0.0, created 2026-05-24 | **Yes.** It pins the validated IPs through an undici `Agent` | Re-validates redirects and blocks `localhost`, `*.localhost` and `.local`. **Closest TS competitor, and ahead of us on pinning.** |
| `ssrf-agent-guard` | Node | MIT, 0.1.14, 2026-02 | Claims rebinding detection | Agent wrapper with a cloud-metadata list and block/report modes. |
| `ssrf-req-filter`, `ssrf-agent` | Node | last released 2024 / 2021 | agent-based | Stale. |
| `ssrfguard` (PyPI) | Python ≥3.10 | Apache-2.0, 0.4.1, 2026-10-25 | **Yes.** "Connects to the address it validated" | httpx and requests adapters, zero dependencies. **Closest Python competitor, and ahead of us on pinning and ergonomics.** |
| `safehttpx` | Python | Gradio/HF, 0.2.0, 2026-09 | Rebinding mitigation (async GET) | Validates against public DNS. GET only. |
| `advocate` | Python | Apache-2.0, last release 2020 | Yes (requests adapter) | Unmaintained. |
| `toolfence` (PyPI) | Python | 0.1.0, 2026-03 | n/a | A deterministic rule engine for agent tool calls. It complements this library and does not compete with it. |
| Safe Fetch MCP server; Rust `agnt-tools`, `webtools-fetch` | MCP / Rust | 2026 | Yes | These show the agent-specific niche is filling up. |
| Filesystem jail | — | — | — | No widely used, agent-oriented, dual-language path jail turned up. The alternatives are OS-level (Linux `openat2(RESOLVE_BENEATH)`, Node `--permission`, Deno permissions, containers) or ad-hoc root-dir checks inside each framework. |

**Where this beats them:**

- **Two languages, one policy.** None of the comparables ships TS *and* Python with a parity
  contract and a shared corpus. This matters to teams with a Python agent backend and a
  TS/MCP edge.
- **The SSRF guard and the file jail come in one agent-oriented package.** The write jail's
  symlink check on the target and every ancestor, plus caller-supplied deny roots, is the
  differentiator SALVAGE.md named.
- **Candid threat models.** Both staged READMEs have long "Not covered" sections, and the
  known gaps are pinned as failing-on-purpose tests. That is unusual, and it is exactly the
  credibility signal a consulting funnel needs.
- **Wide IPv6 coverage in TS.** It blocks all IPv4-mapped *and* RFC 6145/6052-translated forms,
  normalises every obfuscated IPv4 literal through WHATWG `URL`, and has property tests
  (fast-check, Hypothesis).

**Where it does not (honest):**

- **No DNS pinning today, in either language.** Until gate G2 lands, this library is *weaker*
  on rebinding than `request-filtering-agent`, npm `ssrf-guard`, PyPI `ssrfguard`, `safehttpx`
  and even the unmaintained `advocate`. A "hardened fetch" that loses to free alternatives on
  the headline attack has no story. **Pinning is not optional for a public v0.1.**
- **The Python side is a check plus an opener, not a client.** `ssrfguard` already gives
  drop-in httpx/requests clients. We should not try to out-ergonomics it in v0.1. We should win
  on parity, the file jail and the corpus.
- **The TS side has no filesystem jail at all.** The staged TS package is fetch-only, so
  "dual-language sandbox" is currently true only of the SSRF half.
- **Zero users and no production history.** SALVAGE.md's "battle-tested against
  jail-hostile-genomes" means AlienClaw's own hostile test suite. **Do not reuse that phrase in
  public.**
- **The file jail is check-then-use** (a TOCTOU window). Descriptor-based opening
  (`openat`/`O_NOFOLLOW`) or OS mechanisms beat it for adversaries who can race the filesystem.

---

## 2. Package naming

### One repo or two: **one monorepo (recommended)**

The core asset is the shared policy table and vector corpus. A block-list bug almost always
affects both languages, so they should share one advisory stream, one SECURITY.md and one
CHANGELOG. The cost is two release pipelines in one repo, handled with per-language tags
(see §5). Two repos would split the corpus or force a third repo for it.

### Availability as checked (2026-11-26, about 23:50–23:57 UTC; read-only GETs; **NOTHING IS RESERVED**)

Method: `GET https://registry.npmjs.org/<name>` and `GET https://pypi.org/pypi/<name>/json`
(404 means no such package). For the npm scope: `GET /-/v1/search?text=scope:v3x` (0 results)
and `GET /-/org/v3x/package` (404). The same endpoint returned 200 for a known org and for a
known user, so the 404 suggests no npm user or org named `v3x` exists today. Anyone can claim
any of these names before Bugsy does.

| Name | npm | PyPI | Comment |
|---|---|---|---|
| `@v3x/agent-tool-sandbox` | **free** (scope unclaimed) | n/a | **Recommended TS name.** Needs the npm org `v3x` created first. |
| `agent-tool-sandbox` | free (unscoped) | **free** | **Recommended PyPI name**, and it matches the staged dist name. The unscoped npm name is also free, so there is no confusing look-alike. |
| `@v3x/hardened-fetch` | free | n/a | The staged TS name. Unscoped `hardened-fetch` **is taken** on npm (an unrelated timeout/throttle wrapper, 2.0.0), so search results would collide. |
| `v3x-agent-tool-sandbox` | free | free | PyPI fallback if the unprefixed name is lost. |
| `ssrf-guard` | **taken** (pinning competitor) | 404, but **very likely refused** | SALVAGE.md suggested PyPI `ssrf-guard`. PyPI rejects names "too similar" to an existing project once separators are stripped, and `ssrfguard` exists. Not verifiable without an upload attempt. **Drop this name.** |
| `@v3x/agent-tool-guard` / `agent-tool-guard` | scoped free / **unscoped taken** | free | A more honest name ("guard", not "sandbox"). The taken unscoped npm name is a confusion risk. |
| `toolfence`, `agent-sandbox`, `agentjail`, `toolguard` | taken | taken | Avoid. |
| GitHub org `v3x` | — | — | **Taken** by an unrelated individual account (since 2010). |
| GitHub org `v3x-tech` | — | — | **Free** (404). Today V3X repos live under the `bugsyhewitt` user, and the user belongs to no orgs. |

**Recommendation:** repo `agent-tool-sandbox` (under a new `v3x-tech` org, or under
`bugsyhewitt`; Bugsy decides), npm `@v3x/agent-tool-sandbox` with subpath exports
`./fetch` and `./fs`, and PyPI `agent-tool-sandbox` (import `agent_tool_sandbox`). The
names match across languages, and every one was free at check time. Keep `hardenedFetch` as
the TS function name for continuity. If Bugsy prefers honesty over continuity, use
`agent-tool-guard` (PyPI) and `@v3x/agent-tool-guard` and accept the taken unscoped npm
look-alike.

On reserving names early: creating the npm org `v3x` is harmless and protects the scope.
On PyPI, do not push an empty placeholder, which goes against the spirit of PEP 541. Either
publish a real `0.1.0rc1` once G1–G7 pass, or accept the small squatting risk until then.

---

## 3. Public API, threat model, block-list parity

### 3.1 Staged API today (committed)

**Python** (`agent_tool_sandbox`, v`0.0.0.dev0`, `requires-python >=3.11` since the packaging pass, no dependencies):

```python
SsrfBlockedError(ValueError)
assert_safe_fetch_url(raw_url: str) -> str           # scheme + getaddrinfo + block check; returns URL unchanged
build_no_redirect_opener() -> urllib.request.OpenerDirector   # 301/302/303/307/308 raise SsrfBlockedError
assert_inside_boundary(path_str, boundary: Path, *, deny_roots=()) -> Path  # realpath jail; final-component dotfile rule
assert_no_symlink(path: Path) -> None                 # target and every ancestor up to "/"
```

The boundary functions raise a plain `ValueError` (there is no dedicated type). There is no
size or time control: those are the caller's job.

**TypeScript** (`@v3x/hardened-fetch`, `0.0.0-dev`, `private`, engines `node >=18`, no
dependencies):

```ts
hardenedFetch(url: string, policy: FetchPolicy): Promise<string>  // validate → dns.lookup(all) → fetch(redirect:'manual') → per-hop revalidate → size cap → UTF-8 decode
isBlockedHost(hostname: string): boolean          // WHATWG-canonical hostname only
validateResolvedAddresses(addrs: ResolvedAddress[]): void  // throws on any blocked / unknown family / empty
interface FetchPolicy { timeoutMs; maxBytes; protocols?; allowedHosts?: Set<string>; maxRedirects? }
DEFAULT_PROTOCOLS = ['https','http'];  MAX_REDIRECTS = 5
```

Errors are plain `Error` objects with message prefixes. `exports` points at `.ts` sources,
so **this cannot be consumed from npm as-is** (see G14).

### 3.2 Proposed v0.1 API (symmetric; names indicative)

Shared concepts, kept identical in both languages:

- **`Policy`**: `schemes` (default `https`, `http`), `allowedHosts` (an exact set),
  `allowCidrs` (an opt-in escape hatch, for example for a Tailscale CGNAT range or a test
  fixture), `denyCidrs` (extra), `denyHostSuffixes`, `maxRedirects` (default 5; 0 means
  refuse), `allowDowngrade` (default **false**), `maxBytes`, `timeoutMs` (a **total** budget
  covering DNS, connect, headers *and* body), `nat64` (`'block'` default, or `'decode'`), and
  `policyVersion` (read-only, for example `"1"`).
- **Errors**: one base class per language (`SandboxError`, a subclass of `ValueError` in
  Python so existing `except ValueError` keeps working). Each error has a stable `code`:
  `SCHEME_BLOCKED`, `HOST_BLOCKED`, `ADDRESS_BLOCKED`, `DNS_FAILED`, `USERINFO_REJECTED`,
  `REDIRECT_BLOCKED`, `TOO_MANY_REDIRECTS`, `DOWNGRADE_BLOCKED`, `TOO_LARGE`, `TIMEOUT`,
  `PATH_OUTSIDE`, `DOTFILE`, `SYMLINK`, `DENIED_ROOT`. Messages are written to be safe to
  hand back to an LLM and **never echo credentials** (the TS `Invalid URL: <url>` currently
  echoes userinfo).

| Capability | TypeScript (`@v3x/agent-tool-sandbox`) | Python (`agent_tool_sandbox`) |
|---|---|---|
| Classify an IP | `isBlockedAddress(ip): boolean` (new; table-driven) and `isBlockedHost(hostname)` (kept) | `is_blocked_address(ip) -> bool` (new; table-driven, **not** `ipaddress.is_*` flags) |
| Check a URL, no I/O beyond DNS | `checkUrl(url, policy) → Promise<ValidatedTarget{url, host, port, addresses}>` | `check_url(url, policy) -> ValidatedTarget` and `assert_safe_fetch_url` (kept for compatibility; deprecated) |
| Guarded fetch with pinning | `hardenedFetch(url, policy) → Promise<string>` (kept) and `safeFetch(url, policy) → Promise<SafeResponse{status, headers, body: Uint8Array, url}>` (new; binary-safe) | `safe_get(url, policy) -> SafeResponse` (new; stdlib `http.client` with a pinned socket); `build_no_redirect_opener` deprecated |
| Bring your own client | v0.2: `createGuardedDispatcher(policy)` for undici/global `fetch`, with `undici` as an optional peer dependency | v0.2: `agent_tool_sandbox.httpx` transport and a `requests` adapter (optional extras) |
| File jail | `resolveInside(path, root, opts)`, `assertNoSymlink(path, {root})` (new TS port) | `assert_inside_boundary` (kept, dotfile rule fixed), `assert_no_symlink(path, *, root=None)` (walk stops at `root`, which fixes the macOS `/tmp` problem) |
| Safer file open (v0.2) | `openInside(path, root, flags)` built on `O_NOFOLLOW` per component | `open_inside(path, root, mode)` built on `os.open(..., dir_fd=, O_NOFOLLOW)` walking |

### 3.3 Unified threat model

**Adversary.** The adversary controls the *arguments* an LLM passes to a tool: through prompt
injection in fetched content, a hostile document, or a hostile user. In practice they can
choose any URL string or path string. They may also control a DNS zone (short TTLs, mixed
answers) and an HTTP server (redirects, slow-drip bodies, oversized bodies). They **cannot** run
code on the host. They may be able to create files inside the workspace through the agent's
own write tool. They can create symlinks only if some other tool, such as a shell, allows it.

**Assets.** Cloud metadata credentials (169.254.169.254, `fd00:ec2::254`, Alibaba
100.100.100.200), internal services and admin ports on loopback and RFC 1918, tailnet and
CGNAT peers, and host files (`.env`, SSH keys, the agent's own config and governance files).

| # | Threat | Control | TS today | Py today | v0.1 target |
|---|---|---|---|---|---|
| T1 | Non-HTTP scheme (`file:`, `gopher:`, `data:`) | scheme allowlist | ✅ | ✅ | ✅ both |
| T2 | Internal IP literal in any spelling (`127.1`, `0x7f.1`, `2130706433`, IDNA digits, bracketed IPv6) | canonicalise, then table | ✅ (WHATWG pre-check) | ✅ (through `getaddrinfo`; no pre-check) | ✅ both, plus corpus |
| T3 | Public name that resolves to internal (any answer) | check every A/AAAA answer | ✅ | ✅ | ✅ both |
| T4 | **DNS rebinding** (TOCTOU between check and connect) | pin the connect to the validated IP | ❌ | ❌ | ✅ both (G2) |
| T5 | **Checked host ≠ connected host** (userinfo, `%2e` in host) | parse once, reject userinfo and `%` in host, connect to the validated IP | ✅ (WHATWG host) | ❌ (strict xfail) | ✅ both (G1) |
| T6 | Redirect to internal, downgrade, or redirect loop | per-hop full re-check, cap, no downgrade by default | ✅ re-check / ❌ downgrade allowed | refuses all 3xx | aligned (G5) |
| T7 | Oversized body | streamed cap | ✅ | ❌ (caller) | ✅ both |
| T8 | Slow-drip body or slow DNS | a total deadline that includes DNS and the body | ❌ (headers only) | ❌ (caller; socket timeouts are per operation) | ✅ both (G4) |
| T9 | IPv6 transition prefixes that embed private IPv4 (NAT64, 6to4, Teredo) | table | ❌ | ✅ (observed on 3.14) | ✅ both (G3) |
| T10 | Environment proxy (`HTTP(S)_PROXY`, `NODE_USE_ENV_PROXY`) resolves the name instead | ignore env proxies by default; explicit opt-in | ❌ | ❌ (`build_opener` adds `ProxyHandler`) | ✅ both |
| T11 | `..` / absolute / sibling-prefix (`ws-evil/`) | realpath + `root + sep` prefix | ✅ (Python only) | ✅ | ✅ both (TS port) |
| T12 | Symlink escape | realpath before compare; no-symlink rule on write | — | ✅ write / ❌ **read** | ✅ both (G1) |
| T13 | Dotfile access (`.env`, `.env/`, `.git/config`, symlink to a dotfile) | check every component of the resolved relative path | — | ❌ (`.env/` bypass; basename only) | ✅ both (G1) |
| T14 | Denied sub-trees inside the root | `denyRoots` after realpath | — | ✅ (case-sensitive) | ✅, plus case-fold on case-insensitive volumes |
| T15 | Filesystem TOCTOU (symlink swapped in after the check) | descriptor walking with `O_NOFOLLOW` | — | ❌ | **documented in v0.1**; `open_inside` in v0.2 |
| T16 | Hard links to outside files | none possible at path level | — | ❌ | documented non-goal |

### 3.4 Block-list parity: today vs the v1 target

"Py" is the **staged** Python at HEAD, which already includes AlienClaw PR #630's CGNAT block.
The AlienClaw in-tree Python still *allows* CGNAT. Python decisions come from `ipaddress`
tables, which change between patch releases (3.12.4, 3.13); the values below were observed on
3.14 per the staged TS README.

**Target policy rule: the strictest decision wins, from one explicit table.**
`policy/blocklist.v1.json` lists CIDRs, hostname rules and a reason plus RFC reference per
row, and it is the single source. Both languages embed a generated copy, and CI fails if a
generated copy drifts from the JSON. Python uses `ipaddress` **only to parse**, never for
`is_private`/`is_reserved` decisions, which removes the interpreter-version drift. Anything
looser than the default is an explicit `allowCidrs` the caller writes.

| Range / input | TS | Py | **v1 default** | Why |
|---|---|---|---|---|
| `0.0.0.0/8`, `10/8`, `127/8`, `169.254/16`, `172.16/12`, `192.168/16` | block | block | **block** | — |
| `100.64.0.0/10` CGNAT (includes Alibaba metadata) | block | block (in-tree AlienClaw: allow) | **block** | Tailscale users need `allowCidrs` (Bugsy's own rigs are 100.x) |
| `192.0.0.0/24` (including `.9`, `.10`) | block whole /24 | block except `.9`, `.10` | **block whole /24** | strictest; no agent use |
| `192.0.2/24`, `198.51.100/24`, `203.0.113/24` TEST-NETs | allow | block | **block** | documentation ranges |
| `198.18.0.0/15` benchmarking | block | block | **block** | — |
| `192.88.99.0/24` (deprecated 6to4 anycast) | allow | allow (not in stdlib tables; verify) | **block** | RFC 7526 |
| `224/4` multicast, `240/4` reserved incl. broadcast | block | block | **block** | — |
| `::`, `::1`, `::/96` IPv4-compatible | block | block | **block** | — |
| `::ffff:0:0/96` mapped, `::ffff:0:0:0/96` translated | block **all** | unwraps, then checks the embedded v4 | **block all** | strictest; no legitimate agent use for a mapped literal |
| `64:ff9b::/96`, `64:ff9b:1::/48` NAT64 | **allow** (gap) | block | **block**; `nat64:'decode'` opt-in checks the embedded v4 | IPv6-only plus DNS64 deployments need the opt-in |
| `2002::/16` 6to4, `2001::/23` incl. Teredo `2001::/32` | allow | block | **block** | they embed IPv4; deprecated |
| `2001:db8::/32`, `3fff::/20` documentation | allow | block | **block** | — |
| `100::/64` discard | allow | block | **block** | — |
| `fc00::/7` ULA (incl. `fd00:ec2::254`), `fe80::/10`, `ff00::/8` | block | block | **block** | — |
| `fec0::/10` site-local, other space outside `2000::/3` (e.g. `::1:ffff:0:0`, `4000::/3`) | allow | block | **block** | v6 rule: **allow only inside `2000::/3`**, minus the rows above (same approach as `request-filtering-agent`) |
| `localhost`, `ip6-localhost`, `ip6-loopback` | block pre-DNS | DNS only | **block pre-DNS** | — |
| `localhost.`, `*.localhost` | DNS only | DNS only | **block pre-DNS** | RFC 6761 |
| `*.local`, `*.internal`, `metadata.google.internal` | DNS only | DNS only | **block pre-DNS** (overridable) | defence in depth |
| Userinfo in URL (`user@host`) | allowed (host correct) | allowed (**mismatch bug**) | **reject** (`USERINFO_REJECTED`) | agent tools never need it; also stops credential leaks |
| Percent-encoded host | WHATWG decodes | mismatch bug | **reject** | — |
| Unparseable resolver entry | rejects | skips (rejects only if none parse) | **reject whole answer** | fail closed |
| Redirects | follow, re-check each hop | refuse all | see G5 | behavioural |

### 3.5 Shared vector corpus (the parity contract)

```
vectors/v1/
  SCHEMA.md        field definitions; how to add a vector; the version-bump rule
  ip.json          {ip, expect: "block"|"allow", rule_id}            ~ every table row edge (first/last/±1)
  url.json         {url, expect, code, note}                          obfuscated literals, IDNA, userinfo, %-hosts, schemes
  dns.json         {host, answers:[...], expect, code}                mixed answers, empty, unknown family, mapped answers
  redirect.json    {chain:[{status, location}], policy, expect, code} downgrade, loop, cap, relative, to-internal
  fetch.json       {scenario: slow-drip|oversize|exact-cap, expect, code}
  fs.json          {tree:[...], op: read|write, path, opts, expect, code}  traversal, symlinks, dotfiles, deny roots
```

- Both test suites load the same files: `python/tests/test_vectors.py` and
  `ts/test/vectors.test.ts`. A CI job runs both against the **same commit** of `vectors/`.
- Property tests in each language (Hypothesis, fast-check) cross-check random IPv4/IPv6 values
  against the CIDR table, so the corpus does not have to enumerate everything.
- Seed the corpus from tonight's tests: about 76 TS vector cases in `ssrf-vectors.test.ts`
  and `cgnat.test.ts` (more once the parametrised loops expand), the Python parity corpus in `test_parity_in_tree.py`, the
  fake-resolver records in `conftest.py`, and the pinned KNOWN GAPS. The KNOWN GAPS become
  vectors whose expectation flips when G1–G4 land.
- The `test_parity_in_tree.py` and `parity-in-tree.test.ts` suites import AlienClaw paths.
  **Delete them** from the public repo; corpus parity replaces them.
- Versioning: the corpus version equals the policy version equals the library MAJOR.MINOR
  (§5). Adding a vector that only documents existing behaviour is a patch. Changing an
  expectation is a minor bump with a CHANGELOG "Policy" entry.
- The corpus is published as its own artifact (a JSON tarball on each GitHub release) so
  other guard authors can test against it. That doubles as funnel content (§7).

---

## 4. Pre-publication gates: all must be true before v0.1.0

| Gate | Condition | Evidence required |
|---|---|---|
| **G1** Three Python bugs fixed | (a) The **dotfile basename bypass** is fixed: the rule checks every component of the path *relative to the root after realpath*, so `.env/`, `sub/.env`, a symlink to a dotfile and `.git/config` are all rejected by default. Dot-directories can be allowed through an option. (b) **Checked host = connected host**: userinfo and `%` in the host are rejected, and the connect goes to the validated IP (G2). (c) **The read path uses the symlink guard**: the read helper applies the same no-symlink rule as write, or uses `O_NOFOLLOW`. | The strict xfails (`test_rejects_dotfile_with_trailing_slash`, `test_connect_host_matches_checked_host`) turn into passing regression tests, plus new read-path symlink tests. The same three fixes are ported to the TS fs module. **Note:** the same three bugs live in AlienClaw's in-tree `src/alienclaw/tools/` and would travel to Pho3nix (SALVAGE.md §3/§5). Fix them there or do not copy them. As of 23:58 UTC the parallel agent's work in progress was visible but uncommitted: modified staged tests, new `test_connect_host.py` and `test_dotfile_and_read_gate.py`, and new in-tree `test/tools/test_*` regression files. Confirm what lands. |
| **G2** DNS pinning | **Implement it (recommended), do not just document it.** Resolve once, validate every answer, connect to a validated IP, and keep the Host header and SNI set to the name. TS: `node:http`/`node:https` with a custom `lookup` that resolves, validates and returns the vetted address(es), handling the `all: true` callback form that `autoSelectFamily` uses. That keeps zero dependencies. An undici dispatcher waits for v0.2. Python: an `http.client.HTTP(S)Connection` subclass whose `connect()` opens a socket to the vetted IP and wraps it with `server_hostname=host`. Every redirect hop goes back through the same path. **If Bugsy chooses non-goal instead:** do not ship `hardenedFetch` or `safe_get`; ship only classifiers and `check_url`, with a top-of-README warning box and no "safe"/"hardened" naming. | Rebinding vector: the fake resolver returns public first and private second, and the connect must still go to the first address. The test asserts the socket target. |
| **G3** Block-list parity policy | `policy/blocklist.v1.json` with strictest-wins defaults (§3.4), generated into both languages, with no `ipaddress.is_*` decisions. NAT64 is blocked by default. | Codegen diff check in CI; the §3.4 table reproduced in `docs/parity.md` from the JSON. |
| **G4** Body-read timeout | One total deadline covers DNS, connect, TLS, headers and body in both languages. TS keeps the abort signal armed through the body read and races `dns.lookup` against the deadline. Python checks a monotonic deadline inside the read loop, because per-operation socket timeouts do not stop a slow drip. | `fetch.json` slow-drip vector (a byte every *t* < socket timeout) ends with `TIMEOUT` in both. |
| **G5** Redirect policy aligned | Recommended default: **follow**, with full per-hop re-validation including pinning, a cap of 5, **no https→http downgrade**, `Authorization`/`Cookie` stripped on cross-origin hops, and redirect bodies cancelled or drained. `maxRedirects: 0` gives the current Python "refuse all" behaviour. | `redirect.json` passes identically in both. |
| **G6** Shared vector corpus | §3.5 in place, and both suites run it in CI. The parity-in-tree suites are removed. | A CI job with both languages on the same `vectors/` commit. |
| **G7** Remaining TS gaps closed | `localhost.` and `*.localhost` blocked pre-DNS; credentials redacted from errors; redirect bodies cancelled; env proxies ignored unless opted in (both languages). | Corpus vectors and unit tests. |
| **G8** Independent security review | Someone other than the author and the AI agents that wrote the code reviews both fetch paths, the fs jail, the policy table and the corpus coverage. Findings are fixed or written into the README's "Not covered". | A written review note in `docs/reviews/`. See §8 for options. |
| **G9** CI | Python: ruff, mypy `--strict` (or pyright strict), pytest plus Hypothesis on **3.11–3.14 (+3.15)**, Linux and macOS. TS: `tsc --strict`, eslint or biome, vitest plus fast-check on **Node 22 / 24 / 26**. Network-free unit tests (keep the fake resolver and spied fetch). A corpus job, a codegen-drift job, a wall-check job (G12), and a packaging smoke test (install the built wheel / `npm pack` tarball into a clean env and import). Actions pinned by SHA; `permissions: contents: read`. | Green required checks on `main`; branch protection on. |
| **G10** SECURITY.md and disclosure | A dedicated contact (not a personal address; for example a `security@` alias on a V3X domain), GitHub private vulnerability reporting enabled, a supported-versions table, a 90-day coordinated-disclosure default, and modest response targets (see §5). | The file exists, and the alias receives a test mail (sent by Bugsy). |
| **G11** License confirmed | Bugsy picks the license (§6). LICENSE file, SPDX expression in `pyproject.toml` (PEP 639) and `package.json`, and a NOTICE file if Apache-2.0. Confirm no third-party snippet was copied into the IPv6 parser or the boundary code. | A license line in both manifests; a short provenance statement. |
| **G12** No AlienClaw-specific names or paths | At HEAD, `git grep -i` for `alienclaw\|openclaw\|PKT-\|leaderboard\|genome\|martian\|PR #\|packet\|/home/\|~/dev` finds **67 matching lines in 13 staged files**: PROVENANCE files, READMEs, parity tests, `PKT-1079/1236` comments in `hardened-fetch.ts`, `package.json` description, and test names. All of them go, and a CI wall-check keeps them out. `PROVENANCE.json` stays **private** in AlienClaw. | The wall-check job is green on the import commit. |
| **G13** Provenance and history | A **fresh repo with one clean import commit**; AlienClaw history is not carried. Reasons: AlienClaw history carries hosting-provider strings (14 commit messages and 29 tracked files at HEAD mention the hosting provider, including deployment PRDs and API hostnames), several author identities including personal email addresses, and internal packet IDs. The import commit is signed and authored with the public identity Bugsy picks (a GitHub noreply address is recommended). Run a secret scanner (gitleaks or trufflehog) over the import tree before the first push. | A single-commit history, a clean scan report, and the provenance mapping (source commit/blob) kept in AlienClaw `docs/salvage/` only. |
| **G14** Packaging builds (added by this plan) | TS emits ESM JS plus `.d.ts` to `dist/` (staged `exports` point at `.ts`, which npm consumers cannot use). Add its own devDependencies and lockfile, because the staged tests borrow AlienClaw's root `vitest`, `typescript` and `fast-check`. Python: build sdist and wheel, check contents (no tests with internal paths), set `requires-python >=3.11` (3.10 reached end of life in Oct 2026 per PEP 619). Set TS `engines` to `>=22` (Node 18 and 20 are end of life). | `npm pack --dry-run` and `python -m build` with the file lists reviewed; TestPyPI dry run. |
| **G15** TS fs jail (added by this plan) | Either port the jail to TS for v0.1 (recommended; it is needed for the "dual-language" claim), or ship TS fetch-only and say so plainly. | `fs.json` vectors pass in both languages, or a README scope note. |

### 4.1 Gate status after the overnight run (2026-11-26, about 20:30 ET)

| Gate | Status | Evidence / what is left |
|---|---|---|
| G1 | **Mostly met** | `.env/`, `.env/./` and symlink-to-dotfile are rejected; checked host = connected host (percent-encoding, backslash, multi-colon and userinfo are refused, and the returned canonical URL is the one requested); the read path has the symlink gate and `O_NOFOLLOW`; uninspectable paths fail closed. Fixed both in-tree (`c4527f06`, `29a0746d`) and staged. **Open:** `.git/config` is still allowed, matching the existing rule. Whether dot-directories are denied by default is Bugsy's call. |
| G2 | **Met (staged)** | Python `agent_tool_sandbox.pinning` (`31d58950`) and the TS pinned transport (`111e43b4`). Second review: 0 C/H/M (`PINNING-SECURITY-REVIEW.md`); its Low PR-01 is fixed (`35685b7c`). In-tree tools are still unpinned. |
| G3 | **Mechanism met; defaults are Bugsy's call** | `policy/blocklist.v1.json` (59 entries) generates both languages' tables, with byte-identical drift tests and no `ipaddress.is_*` decisions (`03a1636a`). Zero behavior change: all 296 vectors and roughly 2.5M differential checks agree. Clear-cut gaps are closed; Python vs TS stands at 50 differences. Setting `profile: "strictest-wins"` would move 32 verdicts, all allow → block, and leave 18 differences, all URL-parsing groups. |
| G4 | **Met (staged)** | TS: one deadline covers DNS through the body. Python: `pinned_urlopen(timeout=…)` is one total budget, with bounded DNS, every connect, TLS and every body read (`349ba7c1`). Open: the recon tools build their own opener without `deadline=`. |
| G5 | **Partial (decision left)** | `vectors/redirect-vectors.json` holds 81 vectors on real loopback chains (`44c4210c`). Three bugs it found are fixed: Python's non-ASCII Location crash, TS following non-redirect 3xx (including 305), and duplicate Location headers (`e638fac7`). 11 behavior differences remain, all policy, in `REDIRECT-DIFFERENCES.md`. The main ones: TS follows https→http, port policy, backslash and space in relative Locations, Python's refuse-all default. |
| G6 | **Partial** | 296 SSRF vectors and 105 filesystem vectors, asserted by both languages. The TS side runs in AlienClaw CI through root vitest; the Python side runs locally (`staging/ci-staging.patch` adds it to CI). The parity-in-tree suites stay while the code lives in AlienClaw. |
| G7 | **Mostly met** | Both languages ignore env proxies, block `localhost.`/`*.localhost` pre-DNS, and redact credentials, query and fragment from URLs in errors. TS cancels redirect bodies and forces `rejectUnauthorized`. Open: secrets in URL paths, and NXDOMAIN-vs-internal timing. |
| G8 | **Not met as defined** | Two AI security reviews are done (`SANDBOX-SECURITY-REVIEW.md`, `PINNING-SECURITY-REVIEW.md`). The gate asks for a reviewer who is neither the author nor an AI agent. |
| G9–G11, G13 | **Not started** | Repo-level work for after Bugsy picks the home, names and license. |
| G12 | **Tooling ready** | `tools/wall_check.py` reports 17 AlienClaw-specific lines in 4 publishable files (37 in 11 with tests). They are cleared in the import commit. |
| G14 | **Dry runs pass** | TS: `tsconfig.build.json` → `dist/` (ESM + `.d.ts`); `npm pack --dry-run` lists only README, package.json and dist; the tarball smoke-imports on Node 22/24. Python: an offline setuptools wheel (5 modules + metadata) installs with `--no-index` and imports on 3.11/3.14. Open: LICENSE file (G11), TestPyPI dry run. |
| G15 | **Met (staged)** | The TS `fs-jail.ts` port (`d772a7fa`) runs the shared 105-vector filesystem corpus; one difference (the `.env\0` reason) is declared. POSIX only. |

---

## 5. Repo layout, CI, release, support

### Layout

```
agent-tool-sandbox/
  README.md               one-screen pitch, "guards, not a sandbox", quickstart ×2, Not-covered banner
  LICENSE  NOTICE?        per §6
  SECURITY.md  CHANGELOG.md  CONTRIBUTING.md
  policy/blocklist.v1.json            single source of truth (CIDRs, host rules, rule_id, reason, RFC)
  vectors/v1/*.json + SCHEMA.md       shared corpus (§3.5)
  scripts/gen_blocklist.py            emits python/src/.../_blocklist.py and ts/src/blocklist.gen.ts
  python/
    pyproject.toml  src/agent_tool_sandbox/{__init__,policy,_blocklist,ssrf,transport,boundary,errors}.py
    tests/  (unit tests, test_vectors.py, conftest.py fake resolver)
  ts/
    package.json  tsconfig.json  src/{index,policy,blocklist.gen,ssrf,transport,fs,errors}.ts
    test/   (unit tests, vectors.test.ts)
  examples/{python-langchain,python-openai-agents,python-pydantic-ai,mcp-python,mcp-ts,vercel-ai-sdk}/
  docs/{threat-model.md,parity.md,design-pinning.md,reviews/}
  .github/workflows/{ci.yml,release-python.yml,release-ts.yml,scorecard.yml}  .github/dependabot.yml
```

### CI (required checks)

`py-lint` (ruff, mypy), `py-test` (3.11–3.14 [+3.15] × ubuntu/macos), `ts-lint` (biome or
eslint, tsc), `ts-test` (Node 22/24/26 × ubuntu/macos), `vectors` (both languages, same
commit), `codegen-drift`, `wall-check`, `package-smoke`, `actionlint`. Examples run in a
separate, **non-required** job (framework dependencies are heavy and churn). Tests that need a
real listening socket bind `127.0.0.1` and use `allowCidrs: ['127.0.0.1/32']` explicitly, so the
escape hatch is itself under test. Also OpenSSF Scorecard and Dependabot for Actions and dev
dependencies.

### Versioning and release

- **SemVer**, starting at `0.1.0`. **MAJOR.MINOR moves in lockstep across both languages and
  equals the policy and corpus version.** PATCH is per language. Making the default stricter is
  a minor bump (it can break callers), flagged in a CHANGELOG "Policy" section. Making it looser
  is a minor bump plus a security note. A fix that brings one language into line with the corpus
  is a patch.
- **CHANGELOG.md** in Keep a Changelog format, with Policy / Python / TypeScript subsections
  per release.
- **Tags** `py-vX.Y.Z` and `ts-vX.Y.Z`, signed. Release workflows trigger on the matching tag
  prefix.
- **Publishing without long-lived tokens.** PyPI Trusted Publishing (OIDC) through
  `pypa/gh-action-pypi-publish`, which also produces PEP 740 attestations. npm trusted
  publishing (OIDC) with `--provenance`. GitHub release assets (wheel, sdist, npm tarball,
  corpus tarball) with `actions/attest-build-provenance` (SLSA provenance). 2FA enforced on
  the npm org and the PyPI account. Release environments need manual approval from Bugsy.
- **Release checklist:** CHANGELOG entry, version bump in both manifests, green CI, TestPyPI
  and `npm publish --dry-run`, tag, approve the workflow, verify the attestations
  (`gh attestation verify`, `npm audit signatures`), then post.

### Support policy (keep it modest; this is one maintainer)

- Runtimes: Python versions still supported upstream (3.11+ at launch); Node LTS lines (22,
  24, 26 at launch). Support for a runtime ends with its upstream end-of-life, in the next
  minor.
- OS: Linux and macOS tested; Windows untested (the fs jail is unsupported there).
- Security fixes: latest minor only while in 0.x. Acknowledge reports within 7 days, best
  effort. For critical issues aim for a fix or mitigation within 30 days. Advisories go
  through GitHub Security Advisories and request CVEs where it applies.
- Deprecations: warn for one minor, then remove (`assert_safe_fetch_url` and
  `build_no_redirect_opener` are the first candidates, kept as wrappers in 0.1).

---

## 6. Licensing (Bugsy's decision)

| Option | For | Against |
|---|---|---|
| **MIT as-is** | Already on the code (`LICENSE`: "Copyright (c) 2026 Bugsy Hewitt"); simplest; universally accepted; GPLv2-compatible; npm `ssrf-guard` and `request-filtering-agent` use it. | No express patent grant. Contribution terms are implicit, so accepting outside PRs without a CLA is a little less clean. |
| **Apache-2.0** | Explicit patent license plus patent retaliation. Section 5 makes incoming contributions licensed by default, which is useful for a solo maintainer taking PRs. Corporate OSS reviews prefer it. PyPI `ssrfguard` and `advocate` use it. | NOTICE-file handling; longer; incompatible with GPLv2-only projects (rare on npm and PyPI). |
| **`MIT OR Apache-2.0`** (dual) | Users pick: they get the patent grant and contribution clause if they want them, or MIT's simplicity and GPLv2 compatibility. Well understood (Rust-ecosystem convention). npm and PyPI both accept the SPDX expression. | Two license files; slightly more to explain. |

**Recommendation: `MIT OR Apache-2.0`.** The patent risk for IP-range and path checks is
realistically negligible, so this is mostly about corporate legal comfort and clean
contribution terms, which help the funnel's target buyers. **Second choice: keep MIT as-is.**
It is completely acceptable, and it is the zero-effort option. Either way, confirm the
copyright line and that Bugsy is comfortable being the holder of code largely written by AI
coding agents under his direction. That does not block an open-source license, but it is worth
a conscious yes. (This is not legal advice.)

---

## 7. Go-to-market notes (consulting funnel)

**Positioning line:** "The two guards every agent tool needs: same decisions in TypeScript and
Python, with a public test corpus. Guards, not a sandbox." Do not claim "the only" anything.
`ssrfguard` and npm `ssrf-guard` exist; name them in a fair comparison table.

**Launch post outline, "Your agent's fetch tool is an SSRF cannon":**

1. The three-line SSRF guard, and why line three is the vulnerability (re-resolution and rebinding).
2. Twelve spellings of 127.0.0.1, and why you canonicalise before you classify.
3. IPv6 traps: mapped, translated, NAT64, 6to4/Teredo; "allow only inside `2000::/3`".
4. Redirects, downgrades, slow-drip bodies, proxies in the environment.
5. File tools: `../`, symlinks, `.env/`, deny roots, and why check-then-use is not enough (TOCTOU).
6. Keeping two languages honest: one policy JSON, one vector corpus, codegen and CI.
7. The honest "not covered" list.
8. Call to action: the library, the corpus ("test your own guard"), and a one-line offer of an
   agent tool-surface security review (link to a v3x.tech page Bugsy controls).

**Follow-up posts:** "Building a cross-language security test corpus"; "Pinning DNS in Node
without undici" (the `lookup` hook); later, a case study from Pho3nix **only if** it adopts the
library and the post reveals nothing about hunting infrastructure.

**Examples (in `examples/`, each about 30 lines, run in the non-required CI job):** a LangChain
/ LangGraph `@tool` fetch and read; an OpenAI Agents SDK `function_tool`; a Pydantic AI tool;
an MCP server in Python (FastMCP) and in TS (`@modelcontextprotocol/sdk`) exposing
`fetch_url` and `read_file`; a Vercel AI SDK `tool()`. Each example shows the error `code`
being returned to the model as a tool result, not raised into the agent loop.

**Measures:** weekly downloads, stars, corpus downloads, issues from real users, and inbound
review inquiries, which is the metric that matters. **Outreach** (offering the corpus to other
guard maintainers, CFPs, community posts) is Bugsy's call and is not done here.

---

## 8. Effort estimate and morning decisions

### Effort (engineer-days; agent-assisted coding may compress phases 1–4 and 7; review and decisions do not compress)

| Phase | Work | Estimate |
|---|---|---|
| 0 | Morning decisions (below) | 0.5 h (Bugsy) |
| 1 | G1: verify tonight's three Python fixes, regression tests, port the fixes to the AlienClaw/Pho3nix copies (or a ticket) | 0.5–1 d |
| 2 | G3 + G6: policy JSON, codegen, corpus seeded from existing tests, both runners | 1.5–2.5 d |
| 3 | G2 + G4 + G5 + G7: pinned transports in both languages, total deadline, redirect alignment, error codes and redaction | 3–5 d |
| 4 | G15: TS fs jail port plus `fs.json` | 1–1.5 d |
| 5 | G9–G14: fresh repo, CI, packaging builds, wall-check, SECURITY.md, LICENSE, CHANGELOG, secret scan | 1–1.5 d |
| 6 | G8: independent review plus fixes | 1–2 d of reviewer time, 1–2 d of fixes; **1–3 weeks calendar** |
| 7 | README, docs, examples, launch post | 2–3 d |
| 8 | Release v0.1.0: trusted-publishing setup, dry runs, tag | 0.5 d |
| | **Total** | **about 12–19 engineer-days; about 3–5 weeks calendar**, mostly gated by the review |

### Morning decision checklist for Bugsy

- [ ] **Go / no-go** on extracting this as a public library at all.
- [ ] **Repo home:** a new GitHub org `v3x-tech` (free at check time, not reserved) or the `bugsyhewitt` user; repo name `agent-tool-sandbox`.
- [ ] **One monorepo** (recommended) or two repos.
- [ ] **Names:** npm `@v3x/agent-tool-sandbox` (requires creating the npm org `v3x`) or keep `@v3x/hardened-fetch`; PyPI `agent-tool-sandbox` or the fallback `v3x-agent-tool-sandbox`; or the more honest `agent-tool-guard` pair. Also whether to create the npm org now to protect the scope.
- [ ] **License:** `MIT OR Apache-2.0` (recommended), MIT as-is, or Apache-2.0. Confirm the copyright line.
- [ ] **DNS pinning:** implement for v0.1 (recommended) or declare a non-goal (then ship classifiers only).
- [ ] **Redirect default:** follow with per-hop re-check and no downgrade (recommended), or refuse all 3xx.
- [ ] **Block-list policy:** strictest-wins (recommended); NAT64 blocked by default with a `decode` opt-in; CGNAT blocked by default (tailnet users opt in through `allowCidrs`).
- [ ] **TS fs jail in v0.1** (recommended) or TS fetch-only at launch.
- [ ] **Runtime floors:** Python ≥3.11 and Node ≥22 (recommended; the staged ≥3.10 and ≥18 are past end of life).
- [ ] **Security contact** address, and enabling GitHub private vulnerability reporting.
- [ ] **Independent reviewer:** who (a trusted peer, a paid 1–2 day review, or a public RC call) and the budget.
- [ ] **Public identity** for commits and package metadata (name plus noreply email), and 2FA on npm and PyPI.
- [ ] **Keep `PROVENANCE.json` private** in AlienClaw (recommended).
- [ ] **Fix the same three bugs** in AlienClaw's in-tree tools and in any Pho3nix copy.
- [ ] **Funnel target:** the v3x.tech page for the call to action, and where the launch post is hosted.

---

## 9. Sources (read-only lookups, 2026-11-26)

- Registry endpoints: `https://registry.npmjs.org/<name>`, `https://registry.npmjs.org/-/v1/search?text=scope:v3x`,
  `https://registry.npmjs.org/-/org/<name>/package`, `https://pypi.org/pypi/<name>/json`, `https://api.github.com/users/<name>`.
- [IETF Internet-Draft: MCP Security Considerations (June 2026)](https://datatracker.ietf.org/doc/html/draft-mohiuddin-mcp-security-considerations-00): validate the resolved IP at connection time.
- [Safe Fetch MCP Server](https://mcpservers.org/servers/sanoy24/safe-fetch-mcp-server); Rust [agnt-tools ssrf.rs](https://docs.rs/agnt-tools/0.3.1/src/agnt_tools/ssrf.rs.html), [webtools-fetch guard.rs](https://docs.rs/webtools-fetch/0.1.13/src/webfetch/guard.rs.html).
- [MCP fetch SSRF protection checklist (DEV Community)](https://dev.to/supertrained/mcp-fetch-ssrf-protection-checklist-1aai).
- Comparable repos (from registry metadata): [azu/request-filtering-agent](https://github.com/azu/request-filtering-agent),
  [jonathanong/ssrf-guard](https://github.com/jonathanong/ssrf-guard), [swapniluneva/ssrf-agent-guard](https://github.com/swapniluneva/ssrf-agent-guard),
  [y-mehta/ssrf-req-filter](https://github.com/y-mehta/ssrf-req-filter), [kmoneil/ssrfguard](https://github.com/kmoneil/ssrfguard),
  [gradio-app/safehttpx](https://github.com/gradio-app/safehttpx), [JordanMilne/Advocate](https://github.com/JordanMilne/Advocate).
