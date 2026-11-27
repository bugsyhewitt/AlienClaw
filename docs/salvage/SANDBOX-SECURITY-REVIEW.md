# Agent-tool sandbox: independent security review (2026-11-26)

## Scope and method

The review covered the committed staging copies at `HEAD` (`f5d321e3`), read with `git show HEAD:<path>` and run from a `git archive` snapshot. The working tree, which a fixer agent is editing, was not used.

- TypeScript: `staging/agent-tool-sandbox/ts/src/hardened-fetch.ts` with its tests, README and PROVENANCE.
- Python: `staging/agent-tool-sandbox/python/src/agent_tool_sandbox/{ssrf_guard,boundary}.py` with their tests and README. The in-tree callers `src/alienclaw/tools/{http_get,url_fetch,file_read,file_write}.py` were read for usage context.

How the checks were run:

- **Reading the code** for parser differentials, fail-open paths and API footguns.
- **Probes with no network.** Every probe ran under `unshare -rn`, a network namespace that has only loopback. Real libc and real HTTP clients were used, DNS was mocked only for the name being validated, and 127.0.0.1 listeners were started and stopped inside the namespace.
- **Python versions.** The classification check ran on CPython 3.10.22, 3.11.17, 3.12.13, 3.13.16 and 3.14.9.
- **HTTP clients.** Python: urllib, requests 2.34.2 / urllib3 2.8.0, httpx 0.28.1 and aiohttp/yarl 1.25.1. TypeScript: Node 24.18 global `fetch` (undici).

The probe scripts are in `/tmp/claude-1000/-home-xil-dev-alienclaw/8583d279-be75-4906-9885-a0f66a34619d/scratchpad/secreview/`. They are throwaway files and will not be kept.

The staging READMEs are unusually candid, and most residual gaps are already listed under "Not covered". The findings below are what they miss, plus documented items whose impact is understated.

## Findings

| ID | Sev | Lang | Title | Status |
|---|---|---|---|---|
| SR-01 | **Critical** | Py | `assert_safe_fetch_url` + `requests` gives full SSRF via a backslash in the authority (no DNS control needed; cloud-metadata credentials reachable) | NEW |
| SR-02 | High | Py | The guard is a client-agnostic validator, but its redirect and host guarantees hold only with urllib + `build_no_redirect_opener` | NEW |
| SR-03 | High | Py | Checked host ≠ connected host (urllib). Confirmed, and there is a **third vector** (multi-colon port split) and more decode cases | CONFIRMED-KNOWN (+new vector) |
| SR-04 | High | TS+Py | DNS rebinding: no IP pinning | CONFIRMED-KNOWN |
| SR-05 | Medium | TS | `FetchPolicy` is not validated: `maxBytes` NaN/undefined/string **removes the size cap**, and `maxRedirects: NaN` gives unbounded hops | NEW |
| SR-06 | Medium | Py | Dot-directory writes (`.git/config`, `.git/hooks/*`, `.vscode/tasks.json`) are accepted, which means code execution on the host | DOCUMENTED, impact understated |
| SR-07 | Medium | TS | Body read not covered by the timeout (slow-drip) | CONFIRMED-KNOWN |
| SR-08 | Medium | Py | `.env/` trailing-slash bypass; file_read TOCTOU | CONFIRMED-KNOWN (not re-probed) |
| SR-09 | Low | TS | IPv6-literal URLs are passed to `dns.lookup` with brackets, so every one fails and a junk DNS query leaks | NEW |
| SR-10 | Low | Py | `deny_roots` footguns: relative roots resolve against the CWD and become silent no-ops; one-shot iterables are exhausted after the first call | NEW |
| SR-11 | Low | TS | `timeoutMs` ≥ 2^31 is clamped by Node to a 1 ms timer, so every fetch aborts (fails closed) | NEW |
| SR-12 | Low | TS | NAT64 / 6to4 / Teredo / fec0 gaps | CONFIRMED-KNOWN |
| SR-13 | Info | Py | README examples: `timeout=10` is per socket operation (slow-drip again), getaddrinfo is unbounded, and `write_text` writes through hard links | NEW |
| SR-14 | Info | TS | No port policy, and the TS README does not say so (the Python README does) | NEW |
| SR-15 | Info | Py | Address classification is stable across 3.10.22 to 3.14.9 | Verified (refutes a version-drift worry for current patch releases) |

Count: 1 Critical, 3 High, 4 Medium, 4 Low, 3 Info. 8 are NEW, 1 is DOCUMENTED with its impact understated, 5 are CONFIRMED-KNOWN and 1 is a verification.

---

### SR-01: Critical, Python, NEW: backslash authority differential with `requests`

`assert_safe_fetch_url` checks `urlparse(url).hostname`. `urlparse` does not treat `\` as a delimiter, so it takes userinfo up to the last `@`. urllib3, which `requests` uses, follows WHATWG and ends the authority at `\`. It also removes `..` dot segments, so the attacker controls the whole request path.

**Repro.** Run offline under `unshare -rn`. Only `public.example` is mocked, as 93.184.216.34. The listener is a real 127.0.0.1 server.
```
url     : http://127.0.0.1:41467\@public.example/../latest/meta-data/iam/security-credentials/
guard   : ACCEPT
requests: 200 INTERNAL-SECRET | listener saw: ('127.0.0.1', '/latest/meta-data/iam/security-credentials/')
```
- **Real-world form:** `http://169.254.169.254\@example.com/../latest/meta-data/iam/security-credentials/`. Any publicly resolvable name works after the `@`.
- **Other inputs the guard accepted and requests connected to internally:** `http://10.0.0.1:6379\@google.com/`, `http://localhost\@public.example/`, `http://0\@public.example/`, `http://u:p@127.0.0.1\@public.example/`, and the same with `https://`.
- **Expected:** the guard rejects the URL, or the client connects to the host that was checked.
- **httpx and aiohttp:** a fuzz of about 36k authority strings found no bypass that works without DNS control. httpx agrees with the guard, and aiohttp raises on `\`.
- **urllib:** not affected by this vector. That includes the README example and AlienClaw in-tree.

**Impact.** The obvious consumer of a published "decides whether a URL may be fetched" API is `requests`. With requests, the guard gives no protection: cloud-metadata credentials, internal admin services and any internal `ip:port` are reachable.

**Fix.**
1. Reject any URL that contains `\`.
2. Reject userinfo: any `@` in the netloc.
3. Reject `%` in the host.
4. Reject more than one `:` outside brackets.
5. Reject any netloc character outside `[A-Za-z0-9.\-:\[\]]` after IDNA.
6. Return a re-serialised canonical URL (`scheme://idna_host[:port]/path?query`) instead of `raw_url`.

Add a differential test that feeds every accepted URL to urllib, urllib3, httpx and yarl and asserts that each one parses the same host the guard checked. The real fix is SR-04: a fetch helper that connects to the validated IP.

### SR-02: High, Python, NEW: the guarantees silently depend on the urllib opener

The README "Covered" list includes **redirects**, but only `build_no_redirect_opener()` provides that. `assert_safe_fetch_url` returns a string, and nothing in the API ties it to that opener. What that means for other clients:

- `requests.get(safe_url)` follows up to 30 redirects with no re-validation, because `allow_redirects=True` is its default for GET. aiohttp also follows redirects by default. A 302 to `http://169.254.169.254/...` is therefore a trivial bypass.
- requests and httpx honour `HTTP(S)_PROXY` (`trust_env=True`), the same issue as the documented urllib proxy note.

**Fix.** Ship the fetch as well: a `safe_fetch(url, *, timeout, max_bytes, max_redirects)` that pins the IP, re-validates each hop, and builds its opener with `ProxyHandler({})`. Alternatively, state in bold at the top of the README that only urllib with `build_no_redirect_opener()` is supported, and add tests that encode that restriction.

### SR-03: High, Python, CONFIRMED-KNOWN with a new vector: checked host ≠ urllib connect host

This was confirmed against the real urllib and http.client:
- `http://evil@x.attacker.tld/` is checked as `x.attacker.tld` but connected as `evil@x.attacker.tld`.
- `http://a%2ex.attacker.tld/` is connected as `a.x.attacker.tld`.

There are more decode cases: `%2f` and `%23` decode to `127.0.0.1/.attacker.tld` and `127.0.0.1#.attacker.tld`.

**New, third vector.** urlparse splits the port at the **first** `:`, but `http.client._get_hostport` splits at the **last** one:
```
http://a.attacker.tld:b.attacker.tld:80/   guard checks 'a.attacker.tld' -> ACCEPT
                                           urllib connects 'a.attacker.tld:b.attacker.tld' port 80
```
The connected name sits inside the attacker's zone (its TLD label is `tld`), so the attacker's nameserver can answer with an internal address.

A fix that only strips userinfo and unquotes the host will miss this. Use the SR-01 fix: reject `@`, `%`, `\` and any second `:`, and re-serialise.

A fuzz of the same 36k authorities found no urllib bypass that works **without** DNS control.

### SR-04: High, both, CONFIRMED-KNOWN: no IP pinning (DNS rebinding)

This is confirmed and documented. It is rated High rather than "accepted residual" because the main use case of a library like this is an attacker-chosen hostname, and registering a domain costs a few dollars.

SR-01 and SR-03 are both symptoms of the same design: the guard validates a *name* and then hands it to a client that resolves it again.

**Fix.**
- TS: an undici `Agent({ connect: { lookup } })` whose lookup returns only the already-validated addresses.
- Python: an `HTTPConnection`/`HTTPSConnection` subclass whose `connect()` dials the validated IP and keeps `server_hostname` / `Host` set to the name.

**Publishing without this is acceptable only if the package is renamed and marketed as a "URL pre-filter", not an SSRF guard.**

### SR-05: Medium, TypeScript, NEW: unvalidated `FetchPolicy` lets limits fail open

Repro: `ts_policy.mts`, run offline with fetch and DNS stubbed and a 10 MiB streamed body.
```
maxBytes: 1024            -> THROW Response exceeds 1024 bytes
maxBytes: NaN             -> OK, body bytes = 10485760
maxBytes: undefined (JS)  -> OK, body bytes = 10485760
maxBytes: "1kb" (config)  -> OK, body bytes = 10485760
maxRedirects: NaN         -> 30892 fetch calls in a 300 ms budget (cap never reached)
```
The cause is that `totalBytes > NaN` and `redirectsLeft <= 0` (with `NaN--`) are never true.

**Impact.** Policies built from JSON, environment variables or untyped JS lose the size cap with no error, which allows memory exhaustion. Redirect hops are then bounded only by the time budget.

**Fix.** Validate the policy at entry. `maxBytes` must satisfy `Number.isSafeInteger` and be ≥ 0. `timeoutMs` must be finite, > 0 and ≤ 2_147_483_647. If `maxRedirects` is set, it must be a safe integer ≥ 0. Anything else throws `TypeError`.

### SR-06: Medium, Python, documented but understated: dot-directories are writable

The README says "`.git/config` is accepted", and `test_dot_directories_are_not_rejected` pins that as normal behaviour.

On a write path, that acceptance means the agent can achieve **code execution on the host**. Writing `.git/config` with `core.fsmonitor=<cmd>` or `core.hooksPath`, or writing `.git/hooks/post-checkout`, runs code on the next `git status` by a human or by automation. `.vscode/tasks.json` and `.github/workflows/*.yml` work the same way.

**Fix.** By default, reject any path whose components *relative to the realpath'd boundary* start with `.`, with an explicit allowlist opt-out. Move the pinning test into a "KNOWN GAPS" group.

### SR-09: Low, TypeScript, NEW: bracketed IPv6 passed to `dns.lookup`

`resolveAndValidate(parsed.hostname)` passes `"[2606:4700:4700::1111]"`, brackets included. Repro under `unshare -rn` with the real `dns.lookup`:
```
dns.lookup("[2606:4700:4700::1111]") -> ENOTFOUND
hardenedFetch('http://[2606:4700:4700::1111]/') -> "DNS resolution failed ..."  (fetch never called)
```

**Impact.**
- Every IPv6-literal URL is unusable, which contradicts the README claim that "bracketed IPv6 in any compression" is handled.
- In production, getaddrinfo sends a junk query, expanded with the search domains, to the resolver.
- With a wildcard search domain, the resolver's answer for a junk name is what gets validated, not the literal. That lets the SR-12 literal ranges (NAT64 and the rest) through.

The tests mock `lookup`, so they cannot see any of this.

**Fix.** Strip the brackets. If `net.isIP(host)`, validate the literal directly and skip DNS.

### SR-10: Low, Python, NEW: `deny_roots` footguns

Repro: `py_fs.py`, with a CWD different from the boundary.
```
deny_roots=['governance'] (relative)          path governance/policy -> ACCEPT (deny root silently ignored)
deny_roots=<generator>, 2nd call, same object  path governance/policy -> ACCEPT
```
`path_str` is anchored to the boundary, but deny roots are resolved against the process CWD. A generator is consumed on the first call, so later calls deny nothing.

**Fix.** Anchor relative deny roots to the boundary, or reject them. Materialise `deny_roots` with `tuple()` once, or require a `Sequence`.

### SR-11: Low, TypeScript, NEW: timer overflow

`timeoutMs: 2**31` produces `TimeoutOverflowWarning`, and Node sets the timer to 1 ms. Every fetch then aborts with "Fetch timeout". This fails closed and is a functional bug. The SR-05 validation fixes it.

### SR-13: Info, Python, NEW: README examples

- **Read example:** `timeout=10` is per socket operation, so a slow-drip server can hold the call indefinitely. getaddrinfo (DNS) is not bounded either. Use a total deadline.
- **Write example:** `target.write_text()` writes *through* a pre-existing hard link and follows a symlink swapped in after the check. The in-tree tool uses a temporary file plus `os.replace`, which writes a new inode. The example should do the same, with `O_NOFOLLOW|O_EXCL` on the temporary file.

### SR-14: Info, TypeScript, NEW: no port policy

`http://public-host:6379/` is fetched. undici's fetch "bad ports" list blocks only some ports. The TS README should state this, as the Python README does.

### SR-15: Info, Python: classification is stable across versions

`_ip_is_blocked`, with the guard's mapped unwrap, blocks every dangerous test address on 3.10.22, 3.11.17, 3.12.13, 3.13.16 and 3.14.9. The addresses tested were NAT64 `64:ff9b::/96` and `/48`, 6to4 with an embedded private IPv4, Teredo, `::a.b.c.d`, `::ffff:0:a.b.c.d`, `fec0::/10`, `fd00:ec2::254` and the CGNAT/Alibaba metadata address.

Only `192.0.0.9` and `192.88.99.1`, both benign, are allowed. The README's version-drift warning applies only to *older patch releases*, not to current ones.

Three other things were checked and found to fail closed:
- Real CPython `getaddrinfo` truncates at NUL (`'127.0.0.1\x00junk'` → 127.0.0.1), but http.client rejects control characters, so the request never connects. The conftest emulation of this behaviour is accurate.
- A symlink loop is rejected.
- Python `realpath` on EACCES and ELOOP components cannot be used to escape.

## Fit to publish?

**No, not as a security library.** These items block publication:

1. **SR-01 (Critical):** fix the authority and serialisation, and add a cross-client differential test.
2. **SR-02:** either ship a pinned fetch helper or make "urllib + `build_no_redirect_opener` only" a hard, documented and tested contract.
3. **SR-03:** the fixer's patch must also cover the multi-colon and `%2f`/`%23` vectors. Re-run `py_urls.py` / `py_fuzz.py` against the fix.
4. **SR-04:** add IP pinning in both languages, or rename the package and position it as a pre-filter.
5. **SR-05:** policy validation. It is a small change, and an unvalidated policy is a fail-open path in a limiter.
6. **SR-08:** the `.env/` and file_read TOCTOU fixes already in progress.

Should be fixed before 1.0 but does not block a clearly labelled pre-release: SR-06 and SR-07. Everything else can follow publication.

## Test quality

- **TS: every `hardenedFetch` test mocks both `dns.lookup` and `fetch`.** The real composition is never exercised: lookup on bracketed hosts (SR-09), undici proxy and env behaviour, and real redirect and abort semantics. Add one integration test that runs in a network-free namespace against a 127.0.0.1 listener, using an injectable lookup.
- **TS: "accepts 2001:4860:4860::8888" and similar tests call only `isBlockedHost`.** They suggest that IPv6-literal URLs work, which they do not.
- **TS: no policy-validation tests** (SR-05).
- **Python: every SSRF test uses urllib.** Nothing pairs the guard with requests or httpx, so SR-01 and SR-02 go unnoticed. The strict xfail `test_connect_host_matches_checked_host` is good practice; extend it with the SR-03 multi-colon vector and with a requests/urllib3 parse.
- **Python: `test_dot_directories_are_not_rejected` pins a gap as passing behaviour.** Group it with the xfails under a KNOWN GAPS banner, as the TS suite does, so that fixing the gap does not look like a regression.
- **Good:** the network-free harnesses are sound. They use the real libc numeric parsing via `AI_NUMERICHOST`, a refuse-connect monkeypatch, an accurate emulation of NUL truncation, and strict xfails for known gaps.
