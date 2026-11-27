# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html): MAJOR.MINOR moves in lockstep
across both languages and equals the policy and corpus version, PATCH is per language
(tags `py-vX.Y.Z` and `ts-vX.Y.Z`). Each release has **Policy**, **Python** and
**TypeScript** sections, and entries within them use Keep a Changelog's verbs.

## [Unreleased]

Nothing has been released yet. This section describes the code as first imported: Python
`<<PYPI_NAME>>` (import `<<PY_IMPORT_NAME>>`) and TypeScript `<<NPM_NAME>>`.

### Policy

- Added `policy/blocklist.v1.json` (schema 1), the one table both guards are generated from:
  59 entries (17 IPv4, 38 IPv6, 4 names; 49 block, 8 exempt, 2 embedded-IPv4 decode), each
  with a rationale and references and one `applies` column per language.
- Added the two generators (`policy/gen_python.py`, stdlib only; `policy/gen-ts.mjs`, no
  dependencies) and drift tests in both suites. Every block decision comes from the table;
  Python no longer consults `ipaddress.is_*`, so verdicts do not depend on the interpreter's
  patch release.
- The table ships with `profile: "per-language"`, which records each language's current
  behaviour. Setting `"strictest-wins"` makes both enforce the union of the block entries;
  on the shared corpus that moves 32 verdicts from allow to block (25 TypeScript, 7 Python)
  and leaves 18 differences, all URL-parser rules. The v1 default is not decided yet. See
  `docs/parity.md`.
- Both languages block CGNAT `100.64.0.0/10`, the Azure WireServer address
  `168.63.129.16`, 6to4 `2002::/16`, Teredo `2001::/32` and site-local `fec0::/10` whole,
  refuse port 0, and refuse `localhost`, `*.localhost`, `ip6-localhost` and `ip6-loopback`
  (with or without trailing dots) before any DNS lookup.

### Python

- Added `assert_safe_fetch_url(raw_url) -> str`. It returns a canonical URL (fetch that, not
  the input) and refuses: a non-`http(s)` scheme; backslashes, whitespace and control
  characters; userinfo, `%` in the host and a second `:` in the authority; a port outside
  1-65535; a host that `urllib` would split differently; loopback names; names that do not
  resolve; and any blocked address among the DNS answers (IPv4-mapped answers are checked as
  IPv4). Non-ASCII paths, queries and fragments are percent-encoded as UTF-8 first.
- Added connection pinning against DNS rebinding: `resolve_and_validate(url) -> PinnedTarget`
  resolves once; `build_pinned_opener(target)`, `pinned_urlopen(url, ...)` and
  `PinnedHTTPConnection` / `PinnedHTTPSConnection` connect only to the validated addresses,
  with `Host`, SNI and certificate verification on the original name. Environment proxies
  are not used, a caller-set `Host` that names another host is refused, tunnels are refused,
  and header names that are not HTTP tokens are refused.
- Added one total deadline: `pinned_urlopen(timeout=...)` bounds DNS (in a worker thread, at
  most 16 at once), every connect attempt, TLS, sending, the response head and every body
  read. `DeadlineExceededError` is both a `TimeoutError` and a `urllib.error.URLError`;
  openers and connections take `deadline=`.
- Added opt-in redirects, `pinned_urlopen(follow_redirects=N)` (default `0`, which refuses
  every redirect): each hop is validated and pinned again, https to http is refused,
  `Authorization`, `Cookie`, `Proxy-Authorization` and `Host` are dropped across origins,
  only 301/302/303/307/308 are followed, more than one `Location` is refused, and a
  non-ASCII `Location` is read as UTF-8.
- Added the filesystem jail: `assert_inside_boundary(path, boundary, *, deny_roots=())`
  (realpath containment, a final dotfile component however it is spelled, a symlink to a
  dotfile, caller-supplied deny roots) and `assert_no_symlink(path, *, operation=...)` for
  read and write paths. A path component that cannot be inspected fails closed.
- Kept `build_no_redirect_opener()`, which refuses redirects but does not pin.
- Security: refusal messages never name an address learned from DNS, read the same for "is
  internal" and "does not resolve", and redact userinfo, query and fragment from any URL
  they quote. `SsrfBlockedError.detail`, `.blocked_address` and `.hostname` carry the full
  reason for logs.
- Requires Python 3.11 or later; no runtime dependencies.

### TypeScript

- Added `hardenedFetch(url, policy) -> Promise<string>`: policy validation that fails
  closed (`TypeError: Invalid FetchPolicy`), WHATWG URL canonicalisation, a protocol
  allowlist, a port check, a pre-DNS literal and loopback-name check (`isBlockedHost`), an
  optional exact host allowlist, one resolution (or a caller `resolve` hook) validated by
  `validateResolvedAddresses`, a streamed size cap on the decoded body, and one deadline
  from DNS through the last body byte.
- Added connection pinning: a `node:http` / `node:https` transport whose `lookup` answers
  only from the validated addresses (including the `{ all: true }` form), with `Host`, SNI
  and certificate checks on the name. Certificates are always verified
  (`NODE_TLS_REJECT_UNAUTHORIZED=0` is ignored), each request gets a fresh agent, and proxy
  environment variables are ignored.
- Added redirect handling: only 301/302/303/307/308 are followed (default cap 5, `0` to 20),
  each hop needs exactly one `Location`, is validated and pinned again, and the unread
  redirect body is cancelled.
- Added the filesystem jail (`assertInsideBoundary`, `assertNoSymlink`, `readFileJailed`
  with `O_NOFOLLOW` and a required `maxBytes`, `writeFileJailed` with an atomic rename),
  with `BoundaryError` and a stable `code`. It runs the same filesystem corpus as Python.
  POSIX only: Windows throws `UNSUPPORTED_PLATFORM`.
- Security: a refused DNS answer is not named in the message (`AddressRejection` carries it
  in non-enumerable properties), and URLs in messages are redacted.
- ESM with `.d.ts` in `dist/`; requires Node.js 22 or later; no runtime dependencies.

### Shared corpus

- Added `vectors/ssrf-vectors.json` (296 vectors), `vectors/redirect-vectors.json` (81
  vectors on loopback listeners) and `vectors/fs-vectors.json` (129 vectors), each with both
  languages' recorded verdicts, asserted by both test suites.
- The languages differ on 50 SSRF vectors (`vectors/DIFFERENCES.md`), on 11 redirect
  behaviours plus documented API-surface differences (`vectors/REDIRECT-DIFFERENCES.md`),
  and on one filesystem reason (`.env\0`: TypeScript reports the NUL byte, Python the
  dotfile).

### Known gaps before 0.1.0

- The v1 block-list default (`per-language` or `strictest-wins`) and the redirect default
  (Python refuses all redirects, TypeScript follows up to 5 and allows https to http) are
  open decisions.
- Dot-directories in the middle of a path (`.git/config`) are allowed by both jails.
- No independent human security review has been done yet.
- Secrets in URL paths are not redacted, and refusal timing still differs between a fast
  NXDOMAIN and a resolved name.
- macOS has not been through CI yet; Windows is untested and the filesystem jail is
  unsupported there.

[Unreleased]: <<REPO_URL>>/commits/main
