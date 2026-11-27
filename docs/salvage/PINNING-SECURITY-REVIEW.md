# Agent-tool sandbox: second-pass review of connection pinning (2026-11-26)

## Scope

This review covers the DNS-rebinding fix (connection pinning) added to the staged agent-tool sandbox, and re-judges whether the package is fit to publish. It follows the first review, `docs/salvage/SANDBOX-SECURITY-REVIEW.md` (REVIEW-1, at `f5d321e3`).

Code reviewed is the committed staging copy at `111e43b4`. It was extracted with `git archive` and never read from the working tree.
- Python: `staging/agent-tool-sandbox/python/src/agent_tool_sandbox/{pinning,ssrf_guard,boundary}.py`, `tests/test_pinning.py`, `README.md`.
- TypeScript: `staging/agent-tool-sandbox/ts/src/{hardened-fetch,pinned-request}.ts`, `test/pinning.test.ts`, `README.md`.

HEAD moved to `85eca013` during the review. The pinning sources (`pinning.py`, `ssrf_guard.py`, `pinned-request.ts`, `hardened-fetch.ts`) are byte-identical at both commits, checked by md5. Only the staged `boundary.py`, some tests and the new `vectors/` changed. The findings therefore hold at `85eca013`.

Out of scope: AlienClaw's own in-tree tools (`src/alienclaw/net/hardened-fetch.ts`, `src/alienclaw/tools/*`). They are still unpinned, as both READMEs say. AlienClaw itself therefore stays exposed to rebinding (REVIEW-1 SR-04) until the pinned code is ported back.

## Method

Everything ran offline. Throwaway probes are in `/tmp/claude-1000/-home-xil-dev-alienclaw/8583d279-be75-4906-9885-a0f66a34619d/scratchpad/pinreview/` and will not be kept.

- **Network namespace (`ns.sh`).** Probes ran under `unshare -rnm`, which leaves loopback as the only interface.
  - The "public" addresses `93.184.216.34`, `93.184.216.35` and `2606:2800:220:1::1` were added to `lo`, so real listeners could stand in for public servers.
  - `/etc/hosts`, `/etc/nsswitch.conf` (`hosts: files`) and `/etc/resolv.conf` (`nameserver 127.0.0.1`) were bind-mounted. Real libc `getaddrinfo` therefore answered from a fake hosts file and could not reach any DNS server.
  - A `dummy` interface was used to blackhole a public /24.
- **Rebinding harness.** The validation lookup gets the genuine "public" answer. Every later, connect-time lookup answers loopback:
  - Node: the callback `dns.lookup` is patched, with `syncBuiltinESMExports`.
  - Python: the second and later calls to `socket.getaddrinfo` are patched.
  - A **control** confirms the harness is live: plain `http.get`, global `fetch` and the unpinned `assert_safe_fetch_url` + `build_no_redirect_opener` composition all land on the loopback listener.
- **Runtimes.** Node 24.18.0. CPython 3.10.22, 3.11.17, 3.13.16 and 3.14.9 (3.12 was not available locally). requests 2.34.2 / urllib3 2.8.0, httpx 0.28.1, yarl 1.25.1, aiohttp.
- **Suites.** Both committed suites were run from the snapshot inside the namespace:
  - Python: **563 passed** on 3.14.
  - TypeScript: **296 passed**, 7 files.

  The commit messages claim these counts, and the runs reproduce them.

## Findings

| ID | Sev | Lang | Title | Status |
|---|---|---|---|---|
| PR-01 | Low | Py | The `Host` override refusal is bypassed by whitespace in the header name (`"Host "`, `"Host\t"`), which puts a second Host line on the wire | NEW |
| PR-02 | Low | Py | No overall deadline: the connect timeout is multiplied by an attacker-chosen number of A records (12 records × `timeout=2` = 24 s) | NEW (impact of a documented limit) |
| PR-03 | Low | Py+TS | Refusal messages leak the internal address a name resolves to, which turns the guard into an internal-DNS oracle | NEW |
| PR-04 | Info | TS | `NODE_TLS_REJECT_UNAUTHORIZED=0` turns certificate verification off for the pinned transport. The Python twin deliberately resists the equivalent global | NEW |
| PR-05 | Info | TS | `http://host:0/` dials port 80 (443 for https) while sending `Host: host:0` | NEW |
| PR-06 | Info | TS | The in-tree fix `d18c5c5d` (an SSRF refusal that settles after the deadline is reported as "Fetch timeout") is not mirrored into the staged copy | NEW (staging drift) |
| PR-07 | Info | TS | `engines: node >=18`, but the pinning behaviour depends on the Node version and was verified only on Node 24 | NEW |

Count: 0 Critical, 0 High, 0 Medium, 3 Low, 4 Info. All 7 are NEW.

**No pinning bypass was found in either language.** The checks that came back clean are listed under "Attacks that failed" below.

### PR-01: Low, Python, NEW: whitespace in the header name bypasses the Host check

`_assert_host_header` compares `name.lower() == "host"` exactly. http.client accepts header names that match `[^:\s][^:\r\n]*`, so `"Host "` and `"Host\t"` are legal names. urllib's `has_header('Host')` is false for them, so urllib also adds the real `Host`, and both lines are sent.

**Repro.** Run under `ns.sh` with a listener on `93.184.216.34:8080` that prints the raw request head:
```
pinned_urlopen('http://public.example:8080/h', headers={'Host ': 'internal.vhost'})  -> OK
wire: GET /h HTTP/1.1 | Host: public.example:8080 | User-Agent: ... | Host : internal.vhost
```
The `'Host\t'` name gives the same result on 3.10, 3.11, 3.13 and 3.14. `X-Forwarded-Host`, `Forwarded`, `X-Original-URL` and `X-Rewrite-URL` also pass unchecked.

**Impact.** The README promises that a caller-set Host naming another vhost is refused, and that promise is false. This matters when an agent can supply request headers.
- Node `http` and aiohttp answer the bypass with 400, and Python `http.server` ignores the extra line.
- A lenient front end that strips header names, or one that routes on `X-Forwarded-Host`, would steer the request to another vhost behind the pinned public IP.

**Fix.**
1. Reject any header name that is not an RFC 9110 token (`^[!#$%&'*+.^_\`|~0-9A-Za-z-]+$`).
2. Compare `name.strip().lower()`.
3. Either refuse the routing headers listed above or name them in "Not covered".
4. Add the two spellings to `test_host_header_override_is_refused`.

### PR-02: Low, Python, NEW (impact understated): no total deadline

`_dial` tries every pinned address, each with the full `timeout`. Nothing bounds the total, and the attacker's DNS chooses how many addresses there are.

**Repro.** Run under `ns.sh`. `many.example` has 12 A records in `45.33.32.0/24`, and that range is routed to a dummy interface that drops every packet:
```
pinned_urlopen('http://many.example/', timeout=2)                -> URLError timed out after 24.0 s
hardenedFetch('http://many.example/', { timeoutMs: 3000, ... })  -> "Fetch timeout" after 3.0 s
```
With the default `timeout=30.0`, 12 records hold one call for 6 minutes, and 30 records for 15 minutes.

**Impact.** One URL can tie up an agent worker for a long time. stdlib `socket.create_connection` behaves the same way, so this is not a regression. The README frames it as "a dual-stack host whose first address hangs", which understates it: the attacker picks the count. Slow-drip bodies are likewise unbounded, because `timeout` applies per read (REVIEW-1 SR-13).

**Fix.** Add a `deadline=` parameter (total seconds) that bounds DNS, every connect attempt and the reads. Each attempt then gets `min(timeout, remaining)`. Cap the number of addresses tried, for example at 2 per family.

### PR-03: Low, Python + TS, NEW: refusal messages are an internal-DNS oracle

The refusal text names the resolved address, and "unresolvable" is worded differently from "blocked".

**Repro.**
```
Py: pinned_urlopen('http://localhost:8080/')       -> SsrfBlockedError: Refusing blocked IP 127.0.0.1 (resolved from 'localhost')
Py: pinned_urlopen('http://nonexistent.example/')  -> Refusing unresolvable hostname 'nonexistent.example'
TS: hardenedFetch(...)                              -> SSRF rejected: resolved address <ip> is in a blocked range
```

**Impact.** In an agent tool, the error text goes back into the model's context. A prompt-injected page can make the agent probe `http://db.corp/`, `http://vault.corp/` and similar names, and then exfiltrate the internal addresses through a later fetch that is allowed. That maps the internal network with no connection ever reaching it.

**Fix.** Use a generic message by default, such as `Refusing URL: destination not allowed`. Put the detail (address, reason) on exception attributes, or behind a `verbose_errors=True` option for logs.

### PR-04: Info, TS, NEW: a process-wide TLS opt-out disables verification

`pinnedRequest` does not pass `rejectUnauthorized: true`, so Node falls back to its process-wide default.

**Repro.** Run under `ns.sh` with the probe CA in `NODE_EXTRA_CA_CERTS`. `hop2.example` serves a certificate for `other.example`:
```
(unset)                         https://hop2.example:8443/ -> TypeError fetch failed, ERR_TLS_CERT_ALTNAME_INVALID
NODE_TLS_REJECT_UNAUTHORIZED=0  https://hop2.example:8443/ -> OK "HOP2(cert=other.example)"
```

**Impact.** The pin still holds, so this is not SSRF. Python's `_default_tls_context` deliberately ignores the equivalent global hack, so the two languages differ.

**Fix.** Set `rejectUnauthorized: true` explicitly, and document it.

### PR-05: Info, TS, NEW: port 0

WHATWG `URL` accepts `:0`, and Node's `http.request` treats port 0 as "use the default".

**Repro.** `hardenedFetch('http://public.example:0/port0')` was served by the listener on `93.184.216.34:80`, and the request carried `Host: public.example:0`. Python dials port 0, which fails.

**Fix.** Refuse port 0 in `validateUrl`.

### PR-06: Info, TS, NEW: staging drift from `d18c5c5d`

The in-tree `hardened-fetch.ts` now maps only the deadline's own abort reason to "Fetch timeout". The staged copy still runs `if (signal.aborted) throw timeoutError()` (unchanged at `85eca013`). An SSRF refusal that settles after the deadline is therefore reported as a timeout, which hides the attack signal.

**Fix.** Mirror `d18c5c5d` into the staged copy, including its tests. The drift checker should report it.

### PR-07: Info, TS, NEW: engine range

The package says `node >=18`. The pinning relies on behaviour that differs between Node majors: the `lookup({ all: true })` call that `autoSelectFamily` makes (Node 20+), `NODE_USE_ENV_PROXY` and `--use-env-proxy` handling, and `headersDistinct` (18.3+). Node 18 is end-of-life.

**Fix.** Raise the range to `>=20`, and run `test/pinning.test.ts` on every supported major in CI.

## Attacks that failed

Each of these was tried and the protection held:

- **Real rebinding, TS.** Validation saw `93.184.216.34` and the connect-time resolver answered `::1`/`127.0.0.1`. hardenedFetch reached `PUBLIC4`, and the patched `dns.lookup` was called 0 times. The controls (`http.get`, global `fetch`) reached `INTERNAL6`.
- **Real rebinding, Python** (3.10, 3.11, 3.13, 3.14). The control `build_no_redirect_opener` reached `INTERNAL4` after 2 resolver calls. `pinned_urlopen` reached `PUBLIC4` after 1 call.
- **Happy Eyeballs (TS).** With `autoSelectFamily` on (the default) and off, a dual-stack name reached `PUBLIC6`. Python dials in resolver order, v6 first.
- **Proxies (TS).** `HTTP_PROXY`, `NODE_USE_ENV_PROXY=1` and `--use-env-proxy` were all set. The controls hit the trap proxy twice; hardenedFetch hit it 0 times and went direct to `PUBLIC4`.
- **Redirects (TS).** Every hop is re-resolved and re-pinned: `public.example` → `hop2.example` reached `HOP2`. Redirects to `127.0.0.1`, `localhost`, `LOCALHOST`, `[::1]`, `[::ffff:127.0.0.1]`, `2130706433`, `0` and `localhost.` were all refused.
- **TLS, both languages.** SNI carries the name, and the certificate is checked against the name: a mismatched certificate fails. TS HTTPS rebinding also reached `PUBLIC4` with `sni=public.example`.
- **Python opener scoping.** Other hosts, `public.example.` (trailing dot) and IP literals are refused. An absolute-form request through `Request.set_proxy()` is refused by the Host check. No file, ftp or data handler is installed.
- **`resolve` hook answers (TS).** 285 spellings of internal addresses were tried: expanded, zero-padded, upper case, v4-suffix and zone-ID forms of loopback, link-local, ULA, IMDSv6, mapped, translated and NAT64 addresses, plus non-canonical IPv4. None passed both `net.isIP` and the classifier.
- **Decompression bombs on the new transport** (`maxBytes` = 1 MiB). Each stopped at the cap within about 20 ms, with an RSS increase of 3 to 20 MiB:

  | Bomb | Size on the wire |
  |---|---|
  | 1 GiB gzip | 1.0 MB |
  | 1 GiB brotli | 1.6 KB |
  | 1 GiB deflate | 1.0 MB |
  | 3-layer nested gzip | 263 B |

  At the 256 MiB ceiling, peak RSS was 354 MiB.
- **Parser differential (REVIEW-1 SR-01 and SR-03 fix verification).** REVIEW-1's 36k-authority fuzz was re-run. The guard accepted 1,156 URLs. urllib, requests/urllib3, httpx and yarl disagreed on none of them, whether fed the raw URL or the canonical one. Every REVIEW-1 vector in `py_urls.py` is now refused.
- **Limits and deadline on the real transport (REVIEW-1 SR-05, SR-07, SR-11).**
  - `maxBytes` set to NaN, `undefined`, `"1kb"` or 2^53, `maxRedirects: NaN` and `timeoutMs: 2^31` all throw `TypeError` before any I/O.
  - A slow-drip body and slow headers both abort at the deadline, 1.5 s.

## Status of REVIEW-1 findings

| ID | Sev | Status | Evidence |
|---|---|---|---|
| SR-01 | Critical | **FIXED** | `\`, whitespace, controls, `@`, `%` and a second `:` are refused. The URL is returned in canonical form. The differential fuzz finds 0 hits for requests (and the other clients), and `http://169.254.169.254\@…` is refused. |
| SR-02 | High | **FIXED** | `pinned_urlopen` and `build_pinned_opener` ship pinned, without a proxy and with redirects refused. The README states that requests, httpx and aiohttp are unpinned and follow redirects. Residual: no size cap and no total deadline (PR-02). |
| SR-03 | High | **FIXED** | Userinfo, `%2e`/`%2f`/`%23` and the multi-colon split are all refused. Connect-target equality is asserted for both the raw URL and the canonical one. |
| SR-04 | High | **FIXED in the staged libraries** | Real-socket rebinding probes in both languages; see "Attacks that failed". Still open for anyone who uses only `assert_safe_fetch_url`, `build_no_redirect_opener`, `isBlockedHost` or `validateResolvedAddresses`, which is documented, and for AlienClaw in-tree. |
| SR-05 | Medium | **FIXED** | `checkPolicy`; see the repro above. |
| SR-06 | Medium | **STILL OPEN** | Dot-directories are still accepted. The README now says that `.git/hooks` and similar paths can lead to code execution, and suggests `deny_roots`. |
| SR-07 | Medium | **FIXED (TS)** | One deadline covers DNS, connect, headers and the body. The Python per-read timeout is documented; see PR-02. |
| SR-08 | Medium | **FIXED** | `.env/` and `.env/./` are refused. `assert_no_symlink(..., operation="read")` exists, and the read example uses `O_NOFOLLOW`. Races on directories remain documented. |
| SR-09 | Low | **FIXED** | Brackets are stripped. `http://[2606:2800:220:1::1]:8080/` reaches `PUBLIC6`. |
| SR-10 | Low | **STILL OPEN** | Re-run of REVIEW-1's `py_fs.py`: a relative `deny_roots=['governance']` is accepted, and a generator is accepted on the second call. |
| SR-11 | Low | **FIXED** | `timeoutMs` ≤ 2,147,483,647 is enforced. |
| SR-12 | Low | **PARTLY FIXED** | NAT64 `64:ff9b::/96` (when the embedded IPv4 is blocked) and `64:ff9b:1::/48` are now blocked. 6to4, Teredo and `fec0::/10` are still allowed in TS, which is documented. |
| SR-13 | Info | **PARTLY FIXED** | The read example is fixed. The fetch example's per-operation `timeout` is documented. The write example still uses `target.write_text()`, which writes through hard links and follows a symlink swapped in after the check. |
| SR-14 | Info | **STILL OPEN** | The TS README mentions only the Fetch bad-port list. It still has no "no port policy" line; the Python README has one. |
| SR-15 | Info | n/a | This was a verification, not a defect. |

## Fit to publish?

**Yes, as a clearly labelled pre-release (0.x) SSRF library, after the two items below.** The earlier "No" is withdrawn. The reason REVIEW-1 gave for it was missing pinning and parser differentials, and both are fixed. Pinning held against every attack in this review, in both languages and on real sockets.

Blocking (small):
1. **PR-01.** A documented security guarantee (Host override refused) can be bypassed. The fix is two lines plus a test.
2. **Release decisions that the code cannot make.** The license for the OSS release is still undecided. Both packages are `private` / `0.0.0.dev0`. `test_parity_in_tree.py` and `parity-in-tree.test.ts` must be removed or retargeted when the code leaves the repo. PR-06 should be mirrored first, so the published TS matches in-tree behaviour.

Positioning condition: the pinned entry points (`pinned_urlopen`, `build_pinned_opener`, `hardenedFetch`) must stay the headline API. `assert_safe_fetch_url`, `build_no_redirect_opener`, `isBlockedHost` and `validateResolvedAddresses` used alone are URL pre-filters, and both READMEs already say they are rebindable.

Should fix before 1.0:
- SR-06: deny dot-directories by default on write paths, with an opt-out.
- PR-02: a total deadline and a cap on the number of addresses tried.
- PR-03: generic refusal messages.
- SR-10, the SR-13 write example, SR-14.
- PR-04, PR-05, PR-07.
- SR-12: block 6to4, Teredo and `fec0::/10` in TS, or keep documenting them.
