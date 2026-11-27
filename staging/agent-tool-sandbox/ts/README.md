# @v3x/hardened-fetch (TypeScript, staging)

An SSRF-hardened `fetch` for Node 18+. It has no runtime dependencies (only
`node:dns/promises` and the global `fetch`).

This is a **staged copy** of AlienClaw's `src/alienclaw/net/hardened-fetch.ts`.
The code here is the in-tree code minus the AlienClaw leaderboard wrapper.
`PROVENANCE.json` records the source commit and blob. The package is
`private` and versioned `0.0.0-dev`. Nothing has been published.

## API

```ts
import { hardenedFetch, isBlockedHost, validateResolvedAddresses } from '@v3x/hardened-fetch';

const body: string = await hardenedFetch('https://example.com/data.json', {
  timeoutMs: 10_000,
  maxBytes: 256 * 1024,
});
```

| Export | Kind | What it does |
|---|---|---|
| `hardenedFetch(url, policy)` | `Promise<string>` | Validates the policy, validates the URL, resolves DNS and rejects if any answer is blocked, fetches with `redirect: 'manual'`, re-validates every redirect hop, caps the size, and decodes the body as UTF-8, all under one deadline. Throws `TypeError` for an invalid policy and `Error` on any other rejection. |
| `isBlockedHost(hostname)` | `boolean` | Classifies a **`new URL(...).hostname`** string: IP literal (bracketed or bare IPv6, dotted-quad IPv4) or the tokens `localhost`, `ip6-localhost`, `ip6-loopback`. Returns `false` for ordinary DNS names, which are left to the post-DNS check. |
| `validateResolvedAddresses(addrs)` | `void` / throws | Checks a `dns.lookup(host, { all: true })` answer. Throws if any address is blocked, if the family is not 4 or 6, if a family-4 address does not parse, or if the list is empty. |
| `FetchPolicy`, `ResolvedAddress` | types | See below. |
| `DEFAULT_PROTOCOLS` | `['https', 'http']` | The protocols allowed when `policy.protocols` is unset. |
| `MAX_REDIRECTS` | `5` | The redirect cap when `policy.maxRedirects` is unset. |

**Input contract for `isBlockedHost`:** pass it the WHATWG-canonical hostname.
The URL parser turns `0177.0.0.1`, `2130706433`, `0x7f.1`, `127.1`,
`127.0.0.1.` and full-width digits into `127.0.0.1`, and it compresses IPv6
literals. `isBlockedHost('0177.0.0.1')` on the raw string returns `false`.
`hardenedFetch` always canonicalises first.

## Policy (`FetchPolicy`)

| Field | Required | Valid values | Meaning |
|---|---|---|---|
| `timeoutMs` | yes | integer, 1 to 2,147,483,647 | One wall-clock deadline for the whole call: DNS, connect, headers and the full body read, redirects included. A single `AbortController` is passed to every `fetch()`, and every await (lookup, fetch, each body read) also races the deadline, so a slow-drip body aborts at `timeoutMs`. The ceiling is the largest delay Node's `setTimeout` honours (above it Node fires after 1 ms). |
| `maxBytes` | yes | integer, 0 to 268,435,456 (256 MiB) | The body size cap. The body is streamed, and the read is cancelled as soon as the running total exceeds the cap. The ceiling exists because the body is buffered and decoded into one string. |
| `protocols` | no | array of strings | The protocols allowed, written without the colon. Default `['https', 'http']`. It is checked on every hop, so `['https']` also stops an https-to-http downgrade redirect. |
| `allowedHosts` | no | a `Set` | An exact `URL.hostname` allowlist, checked on every hop. The match is exact (`api.example.com.` with a trailing dot does not match `api.example.com`). The block list and the DNS check still run for hosts on the list. |
| `maxRedirects` | no | integer, 0 to 20 | The number of hops to follow. Default 5 (`MAX_REDIRECTS`). `0` refuses the first redirect. The ceiling is the WHATWG Fetch standard's own redirect limit. |

**The policy is validated before any DNS or network I/O, and it fails closed.** A value outside the table above
throws `TypeError: Invalid FetchPolicy: <field> must be ... (got <value>)`. Only `undefined` counts as "omitted" for
the optional fields; `null`, `NaN`, numeric strings such as `"1024"` and unit strings such as `"1kb"` are errors. Before
this check, a policy built from JSON, environment variables or untyped JS could silently lose its limits:
`maxBytes: NaN` (or `undefined`, or `"1kb"`) accepted a 10 MiB body, and `maxRedirects: NaN` followed redirects
until the time budget ran out.

## What the code checks

The policy is checked once (`Invalid FetchPolicy`, a `TypeError`), and the deadline starts. Then these steps run for
each hop, in this order, all under that one deadline (`Fetch timeout: exceeded <timeoutMs>ms budget`):

1. `new URL(url)`. A parse failure gives `Invalid URL`.
2. Protocol allowlist (`Protocol rejected`).
3. `isBlockedHost(hostname)` on the literal (`SSRF rejected: hostname ... is blocked`).
   This happens before any DNS lookup.
4. `allowedHosts`, if set (`Host not in allowlist`).
5. `dns.promises.lookup(hostname, { all: true })`. A failure gives `DNS resolution failed`.
   Every address goes through `validateResolvedAddresses`, so a single blocked answer rejects the request.
6. `fetch(url, { redirect: 'manual', signal })`. A 3xx response needs a `Location` header, which is resolved
   against the current URL; the hop counter goes down and the loop returns to step 1. Any other non-2xx response
   throws `HTTP <status> from <host>`.
7. Streamed body with the size cap. Each chunk read races the deadline, so the body read is covered too.

### Block list

IPv4 (from the literal and from DNS answers):

| Range | Why |
|---|---|
| `0.0.0.0/8` | "this" network (0.0.0.0 reaches localhost on many stacks) |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | RFC 1918 |
| `127.0.0.0/8` | loopback |
| `169.254.0.0/16` | link-local, including the AWS/GCP/Azure metadata address 169.254.169.254 |
| `100.64.0.0/10` | RFC 6598 CGNAT (includes Alibaba Cloud metadata at 100.100.100.200) |
| `192.0.0.0/24` | IETF protocol assignments |
| `198.18.0.0/15` | benchmarking |
| `224.0.0.0/4` | multicast |
| `240.0.0.0/4` | reserved, including 255.255.255.255 |

IPv6:

| Range | Why |
|---|---|
| `::`, `::1`, and anything whose first 96 bits are zero | unspecified, loopback, IPv4-compatible (`::a.b.c.d`) |
| `::ffff:0:0/96` and `::ffff:0:0:0/96` | **all** IPv4-mapped and IPv4-translated (RFC 6145/6052) addresses, whatever IPv4 they embed |
| `fe80::/10` | link-local |
| `fc00::/7` | ULA, including the AWS IMDS IPv6 address `fd00:ec2::254` |
| `64:ff9b::/96` when the embedded IPv4 (the last 32 bits) is in the IPv4 table | RFC 6052 NAT64 well-known prefix. On a NAT64 host `64:ff9b::a00:1` reaches `10.0.0.1` and `64:ff9b::a9fe:a9fe` reaches the metadata address. A public embedded IPv4 (`64:ff9b::808:808`) stays allowed, so DNS64 answers for IPv4-only sites keep working on IPv6-only networks. |
| `64:ff9b:1::/48`, all of it | RFC 8215 local-use NAT64 prefix. IANA lists it as not globally reachable, and the operator chooses the embedding length inside it, so the embedded IPv4 cannot be located reliably. |
| `ff00::/8` | multicast |
| anything that does not parse as IPv6 | fails closed |

Zone IDs (`%eth0`) are removed before the IPv6 check.

## Threat model

### Covered

- Literal internal targets in any encoding the WHATWG URL parser accepts: decimal, octal, hex and short-form IPv4,
  trailing dots, IDNA/full-width digits, bracketed IPv6 in any compression, and IPv4-mapped IPv6 in both dotted and
  hex form.
- Userinfo tricks (`http://evil.com@169.254.169.254/`, `http://169.254.169.254#@evil.com/`). The check
  uses the host the URL parser extracts.
- Public hostnames whose DNS answer includes any blocked address, including a mixed public/private answer.
- Redirect chains: every hop goes through the protocol, literal, allowlist and DNS checks again, and the number of hops is capped.
- Non-HTTP schemes (`file:`, `gopher:`, `ftp:`, `data:`, ...).
- Oversized responses (streamed cap) and slow servers at every stage: one deadline covers DNS, connect, headers and
  the full body read, so a server that drips the body slowly is cut off at `timeoutMs`.
- Malformed policies (`NaN`, `undefined`, strings, out-of-range values): they throw before any I/O instead of
  removing a limit.
- NAT64 addresses (`64:ff9b::/96` with a blocked embedded IPv4, and all of `64:ff9b:1::/48`).

### Not covered

- **DNS rebinding (TOCTOU).** Validation calls `dns.lookup()`, then `fetch()` gets the
  *hostname* URL and resolves it again through its own lookup. A hostile authoritative server with a short TTL can
  answer with a public address first and a private one second. The connection is not pinned to the validated
  address. The in-tree source comment says resolver-inconsistency attacks are "impossible"; that claim is wrong, and the
  staged comment has been corrected. To close the window, connect to the validated IP yourself (for example with an undici
  `Agent` whose `connect.lookup` returns only the addresses you validated, keeping SNI and the Host header set to the name).
- **`getaddrinfo` cannot be cancelled.** The lookup is raced against the deadline, so the call still fails at
  `timeoutMs`, but a lookup that is still running is abandoned and finishes in the background (on libuv's threadpool).
- **The other IPv6 transition prefixes that embed IPv4 are not blocked:** 6to4 `2002::/16` and Teredo `2001::/32`.
  (NAT64 is blocked; see the block list.)
- **Other IPv6 ranges that are not blocked:** deprecated site-local `fec0::/10`, the documentation prefix `2001:db8::/32`,
  discard `100::/64`, and the rest of the IETF-reserved space outside `2000::/3`.
- **IPv4 documentation ranges** (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) and other special-purpose ranges such as
  `192.88.99.0/24` are not blocked.
- **`localhost.` and `*.localhost`** are not caught by the literal check. They are blocked only if DNS resolves them to
  loopback, which is the normal case.
- **Proxies.** If Node's global `fetch` is configured to use an HTTP proxy (for example `NODE_USE_ENV_PROXY`), the proxy
  resolves the name, and the local DNS check no longer describes the real destination.
- **Downgrade.** The default `protocols` allows an https-to-http redirect. Set `protocols: ['https']` to forbid it.
- **Credential leakage in errors.** `Invalid URL: <url>` repeats the input, userinfo included.
- **Redirect bodies are not drained or cancelled** before the next hop.

`test/hardened-fetch.test.ts` pins the testable gaps above under "KNOWN GAPS (pinned)". Fixing one should flip its test on purpose.
The NAT64 and body-read gaps were fixed on 2026-11-26: their pinned tests were flipped into "fixed gaps (formerly
pinned)", and `test/hardening.test.ts` holds the full regression set for those two fixes and for policy validation
(including a real undici fetch against a 127.0.0.1 slow-drip listener).

## Divergences from the in-tree source

| Area | Difference |
|---|---|
| Exports | `LEADERBOARD_POLICY` and `leaderboardFetch` (AlienClaw-specific) are removed. Every other export is identical. |
| Block list | **None.** CGNAT `100.64.0.0/10` was already blocked in-tree, so nothing was added. `test/parity-in-tree.test.ts` asserts that the decision divergence set is empty. |
| Non-behavioural | The unused `node:http` / `node:https` imports are removed, and the header comment is rewritten (consumer list dropped, rebinding claim corrected). |
| Tests | The ported vectors fix the in-tree `'[::])'` typo and replace four vacuous "obfuscated IPv4" assertions with real `new URL()` canonicalisation. The two `expect(true)` jail notes are not ported. `test/hardening.test.ts` is the in-tree `test/net/hardened-fetch-hardening.test.ts` without its `leaderboardFetch` block. |

## Differences from the Python twin (`src/alienclaw/tools/_ssrf_guard.py`)

These were found by running both block predicates over a shared address corpus on Python 3.14. Python's `ipaddress`
`is_private` / `is_reserved` tables change between Python versions, so the Python column is version-dependent.

| Address / range | TS | Python (main) | Note |
|---|---|---|---|
| `100.64.0.0/10` CGNAT | block | **allow** | Fixed by AlienClaw PR #630 (open). |
| `::ffff:<public IPv4>` | block (all mapped) | allow | Python unwraps the address and checks the embedded IPv4. |
| `192.0.0.9`, `192.0.0.10` | block (whole /24) | allow | Python treats these as globally reachable. |
| `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` | allow | block | TEST-NETs |
| `64:ff9b::/96` NAT64 with a **public** embedded IPv4 | allow | block | TS blocks the /96 only when the embedded IPv4 is blocked, so DNS64 keeps working; Python blocks all of `::/8` through `is_reserved`, which includes the whole NAT64 /96. |
| `64:ff9b::/96` NAT64 with a blocked embedded IPv4, `64:ff9b:1::/48` | block | block | |
| `2002::/16` 6to4, `2001::/23`, `2001:db8::/32` | allow | block | |
| `fec0::/10`, `feff::/16` and other non-`2000::/3` space (`100::/64`, `3fff::/20`, `4000::/3`, ...) | allow | block | Python `is_site_local` / `is_reserved` |
| `::1:ffff:0:0` | allow | block | Python `is_reserved` (`::/8`) |
| Redirects | followed, each hop re-validated | every 3xx refused | behavioural |
| Literal pre-check | yes, before DNS | no, DNS (`getaddrinfo`) only | behavioural |

## Testing

The package has no devDependencies of its own. Inside the AlienClaw repo it uses the root `vitest`, `typescript`,
`@types/node` and `fast-check` through normal parent-directory resolution.

```bash
# from the repo root
node_modules/.bin/vitest run staging/agent-tool-sandbox/ts
node_modules/.bin/tsc -p staging/agent-tool-sandbox/ts/tsconfig.json
```

The tests make no external network calls: `node:dns/promises` is replaced with `vi.mock` and `globalThis.fetch` is spied on.
The one exception is the slow-drip test in `test/hardening.test.ts`, which starts a 127.0.0.1 listener, forwards the
stubbed `fetch` to it through the real global `fetch`, and closes it afterwards.
`test/parity-in-tree.test.ts` imports the in-tree module by relative path. Delete it, or point it at a pinned copy,
when the package leaves the repo.

## License

The AlienClaw repository is MIT-licensed (`LICENSE`, Copyright (c) 2026 Bugsy Hewitt), and this staged copy is under the
same terms. The license for any eventual open-source release is the copyright holder's decision; it is not settled here.
