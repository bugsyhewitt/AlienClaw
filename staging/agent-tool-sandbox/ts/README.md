# @v3x/hardened-fetch (TypeScript, staging)

An SSRF-hardened HTTP GET for Node 22+ (`engines.node: ">=22"`) with **connection pinning**: the socket
connects only to the addresses that were validated. It has no runtime
dependencies (only Node built-ins: `node:dns/promises`, `node:http`,
`node:https`, `node:net`, `node:stream`, `node:zlib`).

This is a **staged copy** of AlienClaw's `src/alienclaw/net/hardened-fetch.ts`.
The code here is the in-tree code minus the AlienClaw leaderboard wrapper, plus
connection pinning, which exists **only in this staged copy** (2026-11-26): the
in-tree module still calls the global `fetch()` and is still open to DNS
rebinding. `PROVENANCE.json` records the source commit and blob. The package is
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
| `hardenedFetch(url, policy)` | `Promise<string>` | Validates the policy, validates the URL, resolves the host once and rejects if any answer is blocked, sends a GET whose socket can connect only to that validated answer, handles redirects itself and re-validates (and re-pins) every hop, caps the size, and decodes the body as UTF-8, all under one deadline. Throws `TypeError` for an invalid policy, `TypeError('fetch failed', { cause })` for a network failure (as `fetch()` did), and `Error` on any other rejection. See "Error messages" for what a message may contain. |
| `isBlockedHost(hostname)` | `boolean` | Classifies a **`new URL(...).hostname`** string: IP literal (bracketed or bare IPv6, dotted-quad IPv4), the tokens `localhost`, `ip6-localhost`, `ip6-loopback`, and every name under `.localhost` (RFC 6761), each with or without trailing dots. Returns `false` for other DNS names, which are left to the post-DNS check. |
| `validateResolvedAddresses(addrs)` | `void` / throws | Checks a `dns.lookup(host, { all: true })` answer. Throws if any address is blocked, if the family is not 4 or 6, if a family-4 address does not parse, or if the list is empty. The message does not name the address; the thrown `Error` is an `AddressRejection` (see "Error messages"). |
| `FetchPolicy`, `ResolvedAddress`, `Resolver`, `AddressRejection` | types | See below. `Resolver` is the type of the `resolve` hook. `AddressRejection` is the `Error` a refused DNS answer throws, with its `blockedAddress` and `addressFamily`. |
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
| `timeoutMs` | yes | integer, 1 to 2,147,483,647 | One wall-clock deadline for the whole call: DNS, connect, headers and the full body read, redirects included. A single `AbortController` is passed to every request (aborting it destroys the socket), and every await (lookup, request, each body read) also races the deadline, so a slow-drip body aborts at `timeoutMs`. The ceiling is the largest delay Node's `setTimeout` honours (above it Node fires after 1 ms). |
| `maxBytes` | yes | integer, 0 to 268,435,456 (256 MiB) | The body size cap. The body is streamed, and the read is cancelled as soon as the running total exceeds the cap. The ceiling exists because the body is buffered and decoded into one string. |
| `protocols` | no | array of strings | The protocols allowed, written without the colon. Default `['https', 'http']`. It is checked on every hop, so `['https']` also stops an https-to-http downgrade redirect. |
| `allowedHosts` | no | a `Set` | An exact `URL.hostname` allowlist, checked on every hop. The match is exact (`api.example.com.` with a trailing dot does not match `api.example.com`). The block list and the DNS check still run for hosts on the list. |
| `maxRedirects` | no | integer, 0 to 20 | The number of hops to follow. Default 5 (`MAX_REDIRECTS`). `0` refuses the first redirect. The ceiling is the WHATWG Fetch standard's own redirect limit. |
| `resolve` | no | a function `(hostname) => ResolvedAddress[]` or a promise of one | A custom resolver (your own DNS, or a fake one in tests). Called once per hop with the URL hostname, an IPv6 literal without its brackets. Its answer gets exactly the checks a DNS answer gets and becomes the pin. A throw, a non-array or an entry without a string `address` and numeric `family` fails the call with `DNS resolution failed for "<host>": ...`. It runs under the deadline. Default: `dns.promises.lookup(hostname, { all: true })`. |

**The policy is validated before any DNS or network I/O, and it fails closed.** A value outside the table above
throws `TypeError: Invalid FetchPolicy: <field> must be ... (got <value>)`. Only `undefined` counts as "omitted" for
the optional fields; `null`, `NaN`, numeric strings such as `"1024"` and unit strings such as `"1kb"` are errors. Before
this check, a policy built from JSON, environment variables or untyped JS could silently lose its limits:
`maxBytes: NaN` (or `undefined`, or `"1kb"`) accepted a 10 MiB body, and `maxRedirects: NaN` followed redirects
until the time budget ran out.

## What the code checks

The policy is checked once (`Invalid FetchPolicy`, a `TypeError`), and the deadline starts. Then these steps run for
each hop, in this order, all under that one deadline (`Fetch timeout: exceeded <timeoutMs>ms budget`):

1. `new URL(url)`. A parse failure gives `Invalid URL: <the input, redacted>` (this includes a port above 65535).
2. Protocol allowlist (`Protocol rejected`), then the port: an explicit port must be 1 to 65535
   (`Port rejected: 0 is not a port from 1 to 65535`). WHATWG keeps `:0`, and `node:http` reads port 0 as "use the
   default", so before 2026-11-26 `http://host:0/` was dialled on port 80.
3. `isBlockedHost(hostname)` on the literal (`SSRF rejected: hostname ... is blocked`): blocked IP literals and the
   localhost names (`localhost`, `localhost.`, `foo.localhost`, `foo.localhost.`, `ip6-localhost`, `ip6-loopback`).
   This happens before any DNS lookup, so a resolver that answers a public address for `foo.localhost` changes nothing.
4. `allowedHosts`, if set (`Host not in allowlist`).
5. One resolution: `policy.resolve(hostname)` if set, else `dns.promises.lookup(hostname, { all: true })`.
   A failure gives `DNS resolution failed`. Every address goes through `validateResolvedAddresses`, so a single
   blocked answer rejects the request (`SSRF rejected: a resolved address is in a blocked range`), and every address
   must be a canonical IP string (`net.isIP` agrees with its family), so `SSRF rejected: a resolved address is not a
   canonical IPv4 address` stops spellings such as `012.0.0.1` that the classifier and `inet_aton` would read
   differently. The validated list is the pin.
6. One GET through the pinned transport (`src/pinned-request.ts`, see "Connection pinning"). A redirect (301, 302,
   303, 307 or 308 only, as in Fetch) needs exactly one non-empty `Location` header (`Redirect with no Location
   header` / `Redirect with 2 Location headers`, the second as browsers refuse it), which is read as UTF-8 when it is
   not ASCII (as `fetch()` reads it) and resolved against the current URL; the unread redirect body is cancelled, the
   hop counter goes down and the loop returns to step 1, so the next hop resolves once and is pinned again. A Location
   that does not parse throws `TypeError: Invalid redirect Location: <the Location, redacted>`. Any other non-2xx
   response, any other 3xx included, throws `HTTP <status> from <host>`.
7. Streamed body with the size cap. Each chunk read races the deadline, so the body read is covered too.

## Connection pinning

Before 2026-11-26 the code validated a `dns.lookup()` answer and then called `fetch(url)`, which resolved the name
again when it connected. A hostile authoritative server with a short TTL could answer a public address to the check
and `127.0.0.1` (or the metadata address) to the connect. Now:

- The request is made with `node:http` / `node:https` to the **original hostname**, so the `Host` header, the TLS SNI
  (`servername`) and the certificate check (Node's default `checkServerIdentity`, against the default CA store) all
  use the name. The transport passes `rejectUnauthorized: true` to the request and to its agent, so the process-wide
  `NODE_TLS_REJECT_UNAUTHORIZED=0` opt-out does **not** turn certificate verification off for it (2026-11-26; there
  is no policy option to turn it off).
- Its `lookup` option is a pinned lookup that answers **only** from the validated list and never calls DNS. It
  supports the `{ all: true }` form that Node's `autoSelectFamily` (happy eyeballs) uses, filters by family when
  asked, and refuses any other hostname. With several validated addresses Node may try any of them; all were
  validated.
- Every redirect hop goes through the same path: one resolution, validation, a new pin.
- Each request gets a fresh `http.Agent` / `https.Agent` (`keepAlive: false`), so no pooled socket from another hop
  or call is reused, and **no proxy is ever used**: `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `NODE_USE_ENV_PROXY` and
  `http.setGlobalProxyFromEnv()` are ignored (they configure only the global agents and the global fetch). A proxy
  would resolve the name itself and void the pin.

`test/pinning.test.ts` proves it without network access. A resolver answers `203.0.113.10` first and `127.0.0.1`
afterwards; a wrapper around `net.Socket.prototype.connect` records the address Node reports in the socket's
`lookup` event (the address it is about to dial) and destroys the socket before it dials. The target is
`203.0.113.10` and the resolver ran once. A second wrapper records what the pinned lookup hands the socket and then
dials a 127.0.0.1 listener instead, which is how the Host header, SNI, certificate (a throwaway self-signed cert made
with `openssl` at test time; skipped if `openssl` is missing), redirect-hop and decoding tests get a real server.
Replacing the pin with a second resolution makes five of those tests fail.

### Differences from `fetch()`

The transport reproduces what callers of the `fetch()` version could observe, and the parity tests compare it with
the real global `fetch` against the same local server:

| Behaviour | Now | Before (`fetch()`) |
|---|---|---|
| Request headers | `host`, `accept: */*`, `accept-language: *`, `sec-fetch-mode: cors`, `user-agent: node`, `accept-encoding: gzip, deflate` (`br, gzip, deflate` over https) | same, except **`connection: keep-alive`**; now **`connection: close`** (no reuse, one TCP/TLS connection per hop) |
| Content decoding | gzip / x-gzip, deflate (zlib-wrapped or raw, chosen from the RFC 1950 header), br, zstd where `zlib` has it, stacked codings decoded last-first, more than 5 codings refused, an unknown coding passes the body through undecoded; `maxBytes` counts decoded bytes | same (undici picks raw deflate from the first byte only) |
| Bad ports (Fetch standard list: 22, 25, 6000, ...) | `TypeError: fetch failed`, cause `bad port`, no connect | same |
| URL with credentials | `TypeError: Request cannot be constructed from a URL that includes credentials: <url, redacted>` | same, but the URL repeated whole, password included |
| `NODE_TLS_REJECT_UNAUTHORIZED=0` | ignored: certificates are always verified | honoured: verification off |
| Network errors | `TypeError: fetch failed` with the Node error as `cause` | same shape; the `cause` is Node's error, not undici's |
| Body broken mid-read | `TypeError: terminated` | same |
| 101 / 204 / 205 / 304 | null body (a 204 still ends in `No response body`) | same |
| Redirect bodies | cancelled before the next hop | left open until the call ended |
| IPv6-literal URLs (`http://[2001:db8::1]/`) | resolved without brackets, validated, fetched | always failed: the bracketed name went to `dns.lookup` (SR-09) |
| Proxy env vars / `NODE_USE_ENV_PROXY` | ignored | honoured by Node's fetch (no pinning possible) |
| Idle timers | only the policy deadline | undici's 300 s headers and body timeouts also applied |
| TLS ALPN | none offered | `http/1.1` offered |
| Protocol | HTTP/1.1 | HTTP/1.1 (undici's default; `allowH2` is off) |

## Error messages

In an agent tool the error text usually goes back to the model, so a prompt-injected page can read it. Two rules
(staged only, 2026-11-26):

- **A refused DNS answer is not named.** `SSRF rejected: a resolved address is in a blocked range` is the whole
  message, whatever the address (`... is not a canonical IPv4 address` and `unknown address family <n> for a resolved
  address` likewise). Before, the message said which internal address the name resolved to, so a page could map
  internal DNS (`http://vault.corp/` -> `10.20.30.40`) without any connection being made (pinning review PR-03). The
  error is still a plain `Error`; it is typed `AddressRejection` and carries `blockedAddress` (the refused string) and
  `addressFamily`. Both properties are **non-enumerable** and read-only, so `util.inspect`, `JSON.stringify` and
  loggers that copy own enumerable fields do not print them; read them by name to log them. An IP-literal refusal
  still quotes the literal (`SSRF rejected: hostname "10.0.0.1" is blocked`), since the caller wrote it.
- **A URL in a message is redacted.** Its userinfo, query and fragment each become `<redacted>`; scheme, host, port and
  path stay. This covers `Invalid URL: ...`, `Invalid redirect Location: ...` and the transport's credentials and
  parse errors. For a string the parser rejects, everything before the last `@` counts as userinfo, because a
  password containing `/`, `?` or `#` is what breaks the parse. Example: `http://alice:s3cret@example.com:99999/?t=1`
  gives `Invalid URL: http://<redacted>@example.com:99999/?<redacted>`. Hostnames are not redacted.

`test/prepublication-gates.test.ts` checks both, including the inspect and JSON renderings.

### Block list

The ranges and names below are data: `src/blocklist-data.ts` is generated from
`../policy/blocklist.v1.json`, the table the Python package reads too (see
`../policy/README.md`, which also says how gate G3 is decided by editing it). The tables here
describe the `ts` column today.

IPv4 (from the literal and from DNS answers):

| Range | Why |
|---|---|
| `0.0.0.0/8` | "this" network (0.0.0.0 reaches localhost on many stacks) |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | RFC 1918 |
| `127.0.0.0/8` | loopback |
| `169.254.0.0/16` | link-local, including the AWS/GCP/Azure metadata address 169.254.169.254 |
| `168.63.129.16` (one address) | Azure WireServer: a **public** address the Azure host fabric answers inside every VM (DNS, health probes, the VM agent's goal state and extension configuration). Staged only, 2026-11-26. |
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
| `fec0::/10`, all of it | deprecated site-local (RFC 3879); some enterprise networks still route it. Staged only, 2026-11-26. |
| `2002::/16`, all of it | 6to4 (RFC 3056, deprecated by RFC 7526): a host or relay with 6to4 tunnels to the IPv4 in bits 16-47. Blocked whole, public embeds included, as the Python twin does; no agent tool needs 6to4. Staged only, 2026-11-26. |
| `2001:0::/32`, all of it | Teredo (RFC 4380): the client IPv4 is obfuscated and the server IPv4 is attacker-chosen, so no embedded-address check holds. Staged only, 2026-11-26. |
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
- NAT64 addresses (`64:ff9b::/96` with a blocked embedded IPv4, and all of `64:ff9b:1::/48`), and the other
  IPv4-embedding transition prefixes, 6to4 `2002::/16` and Teredo `2001:0::/32`, blocked whole.
- The Azure WireServer address `168.63.129.16`, in every spelling and embedding (mapped, NAT64, 6to4).
- Port 0, which `node:http` would otherwise dial as the default port.
- Errors that settle just as the deadline fires are reported as themselves (an SSRF rejection stays an SSRF
  rejection); only the deadline's own abort is reported as `Fetch timeout`.
- `localhost.`, `*.localhost` and `*.localhost.` (RFC 6761), refused before DNS whatever the resolver would answer.
- Error messages do not name a refused DNS answer or repeat credentials, queries or fragments (see "Error messages").
- `NODE_TLS_REJECT_UNAUTHORIZED=0` cannot disable certificate verification for these requests.
- **DNS rebinding (TOCTOU)**, in this staged copy only: the host is resolved once per hop and the socket is pinned to
  that validated answer (see "Connection pinning"). The in-tree module is still exposed.
- Proxies cannot carry the request around the check: proxy configuration is ignored.

### Not covered

- **The resolver is trusted to answer, not to be honest.** Whatever it returns is validated and pinned. An attacker
  who controls DNS can still choose any *public* address (that is not SSRF), and the pin lasts one hop: a redirect is
  resolved again.
- **IP-literal URLs** skip the pinned lookup: Node dials the literal itself, which the literal check already passed.
  The resolver is still called for them (as before) and its answer is validated, but the socket uses the literal.
- **Only `hardenedFetch` is pinned.** Code that validates with `isBlockedHost` / `validateResolvedAddresses` and then
  calls its own client gets no pin.
- **Other client features are absent:** no proxy support, no connection reuse, no custom CA / client certificate /
  TLS options (the default CA store is used), no HTTP/2, GET only.
- **`getaddrinfo` cannot be cancelled.** The lookup is raced against the deadline, so the call still fails at
  `timeoutMs`, but a lookup that is still running is abandoned and finishes in the background (on libuv's threadpool).
- **Other IPv6 ranges that are not blocked:** the documentation prefix `2001:db8::/32`, the rest of `2001::/23`
  outside Teredo, discard `100::/64`, and the rest of the IETF-reserved space outside `2000::/3`. (6to4, Teredo,
  NAT64 and `fec0::/10` are blocked; see the block list.)
- **No port policy beyond port 0 and the Fetch bad-port list.** `http://public-host:6379/` is fetched.
- **IPv4 documentation ranges** (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) and other special-purpose ranges such as
  `192.88.99.0/24` are not blocked.
- **Other local-only names** (`*.local`, `*.internal`, `metadata.google.internal`, `*.home.arpa`) are not caught by the
  literal check. They are blocked only if DNS resolves them to a blocked address, which is the normal case.
- **A name-existence oracle remains.** A name that does not resolve gives `DNS resolution failed for "<host>": ...`
  and a name that resolves to a blocked address gives `SSRF rejected: a resolved address is in a blocked range`, so a
  page can still learn that `db.corp` exists internally (not its address). Merging the two messages is a policy
  choice left open.
- **Downgrade.** The default `protocols` allows an https-to-http redirect. Set `protocols: ['https']` to forbid it.
- **Error causes are Node's.** A network failure is `TypeError('fetch failed', { cause })`, and Node's `cause` can name
  the pinned (already validated, so not internal) address and port, or the hostname.

`test/hardened-fetch.test.ts` pins the testable gaps above under "KNOWN GAPS (pinned)". Fixing one should flip its test on purpose.
The NAT64, body-read, DNS-rebinding, 6to4, site-local and localhost-name gaps were fixed on 2026-11-26: their pinned
tests were flipped into "fixed gaps (formerly pinned)", `test/corpus-gaps.test.ts` holds the full set for 6to4, Teredo,
`fec0::/10`, WireServer and port 0, and `test/prepublication-gates.test.ts` the one for localhost names, error
messages and the engine range. `test/hardening.test.ts` holds the full regression set for the first two and for policy
validation (including the real transport against a 127.0.0.1 slow-drip listener), and `test/pinning.test.ts` the one
for connection pinning.

## Divergences from the in-tree source

| Area | Difference |
|---|---|
| Exports | `LEADERBOARD_POLICY` and `leaderboardFetch` (AlienClaw-specific) are removed. Every other export is identical. |
| Block list (staged only, 2026-11-26) | 6to4 `2002::/16`, Teredo `2001:0::/32` and site-local `fec0::/10` are blocked whole, and the Azure WireServer address `168.63.129.16` is in the IPv4 table (so its NAT64 embedding `64:ff9b::a83f:8110` is blocked too). In-tree allows all of them. `test/parity-in-tree.test.ts` declares exactly these ranges and asserts that each one still differs (staged blocks, in-tree allows) and that nothing else does. CGNAT `100.64.0.0/10` was already blocked in-tree. |
| Block list as data (staged only, 2026-11-26; no decision change) | `isBlockedIpv4`, `isBlockedIpv6` and `isLocalhostName` read the generated `src/blocklist-data.ts` (from `../policy/blocklist.v1.json`) instead of hard-coded ranges and names; parsing and the fail-closed rules are unchanged. Every shared-corpus verdict and message is unchanged. `test/blocklist-data.test.ts` fails when the generated file and the JSON disagree. |
| Port 0 (staged only, 2026-11-26) | `validateUrl` refuses an explicit port outside 1-65535 (`Port rejected: ...`), before DNS. In-tree hands `:0` to `fetch()`. Declared end-to-end in `test/parity-in-tree.test.ts`. |
| Localhost names (staged only, 2026-11-26) | `isBlockedHost` also blocks `localhost.`, `*.localhost` and `*.localhost.` (and the other two tokens with trailing dots). In-tree leaves them to DNS. Declared in `test/parity-in-tree.test.ts` (`inDeclaredName`). No shared-corpus verdict changed: the corpus's localhost vectors already blocked through their loopback DNS answers. |
| Error messages (staged only, 2026-11-26) | A resolved-address refusal does not name the address (`AddressRejection.blockedAddress` carries it); `Invalid URL`, the new `Invalid redirect Location` and the transport's URL errors are redacted. In-tree names the address and repeats the URL. `test/parity-in-tree.test.ts` maps in-tree messages to the staged form (`inTreeAsStaged`) and still compares decision, reason and address. |
| Redirect handling (staged only, 2026-11-26; found by `../vectors/redirect-vectors.json`) | Only 301/302/303/307/308 are followed; in-tree follows any 3xx with a `Location`, a `305 Use Proxy` included. A redirect with more than one `Location` header is refused (`Redirect with 2 Location headers (status 302)`); in-tree reads them through `Headers#get`, which joins them into one URL. A non-ASCII `Location` is read as UTF-8 before `new URL()`, as `fetch()`'s own redirect follower and browsers do (`/caf%C3%A9`); in-tree percent-encodes the Latin-1 mojibake (`/caf%C3%83%C2%A9`). Tests: `test/hardened-fetch.test.ts`, `test/pinning.test.ts`. |
| TLS (staged only, 2026-11-26) | `rejectUnauthorized: true` is explicit, so `NODE_TLS_REJECT_UNAUTHORIZED=0` is ignored. In-tree uses `fetch()`, which honours it. |
| Timeout reporting | In-tree commit d18c5c5d (only the deadline's own abort is reported as a timeout) is ported. In-tree checks the error and its `cause`; the staged copy walks the `cause` chain (up to 4 levels), because the pinned transport reports a body broken by the abort as `TypeError('terminated', { cause: <AbortError> })`. Regression test: `test/timeout-masking.test.ts`, adapted from in-tree `test/net/hardened-fetch-timeout-masking.test.ts` to stub the transport. |
| Transport (staged only, 2026-11-26) | `fetch()` is replaced by the pinned `node:http` / `node:https` transport in `src/pinned-request.ts`, and `FetchPolicy` gains `resolve`. The classifiers (`isBlockedHost`, `validateResolvedAddresses`) are unchanged, so the decision parity below still holds; `test/parity-in-tree.test.ts` stubs the transport for the staged module and `fetch` for the in-tree one with the same responses. See "Differences from `fetch()`" for every observable change. |
| Non-behavioural | The header comment is rewritten (consumer list dropped, rebinding claim corrected). |
| Tests | The ported vectors fix the in-tree `'[::])'` typo and replace four vacuous "obfuscated IPv4" assertions with real `new URL()` canonicalisation. The two `expect(true)` jail notes are not ported. `test/hardening.test.ts` is the in-tree `test/net/hardened-fetch-hardening.test.ts` without its `leaderboardFetch` block. |

## Differences from the Python twin (`src/alienclaw/tools/_ssrf_guard.py`)

These were found by running both block predicates over a shared address corpus on Python 3.14. The in-tree Python
column comes from `ipaddress` `is_private` / `is_reserved`, whose tables change between Python versions. The staged
Python package reads the same `../policy/blocklist.v1.json` as this package (its `python` column), so the staged column
no longer depends on the interpreter.

| Address / range | TS | Python (main) | Note |
|---|---|---|---|
| `100.64.0.0/10` CGNAT | block | **allow** | Fixed by AlienClaw PR #630 (open). |
| `::ffff:<public IPv4>` | block (all mapped) | allow | Python unwraps the address and checks the embedded IPv4. |
| `192.0.0.9`, `192.0.0.10` | block (whole /24) | allow | Python treats these as globally reachable. |
| `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` | allow | block | TEST-NETs |
| `64:ff9b::/96` NAT64 with a **public** embedded IPv4 | allow | block | TS blocks the /96 only when the embedded IPv4 is blocked, so DNS64 keeps working; Python blocks all of `::/8` through `is_reserved`, which includes the whole NAT64 /96. |
| `64:ff9b::/96` NAT64 with a blocked embedded IPv4, `64:ff9b:1::/48` | block | block | |
| `2002::/16` 6to4, `2001:0::/32` Teredo, `fec0::/10` site-local | block (staged) | block | Staged TS blocks all three whole since 2026-11-26; the in-tree TS still allows them. |
| rest of `2001::/23`, `2001:db8::/32` | allow | block | |
| `fe00::/9` and other non-`2000::/3` space (`100::/64`, `3fff::/20`, `4000::/3`, ...) | allow | block | Python `is_reserved` |
| `168.63.129.16` Azure WireServer, port 0 | block (staged) | allow (in-tree); block (staged Python) | Staged only, 2026-11-26. |
| `::1:ffff:0:0` | allow | block | Python `is_reserved` (`::/8`) |
| Redirects | followed, each hop re-validated | every 3xx refused | behavioural |
| Literal pre-check | yes, before DNS | no, DNS (`getaddrinfo`) only | behavioural |

## Shared vector corpus: resolved differences

`../vectors/DIFFERENCES.md` listed 68 vectors on which this package and the Python twin disagreed. The 2026-11-26 fixes
above resolved 17 of them, all by changing a TS verdict from allow to block (Python already blocked them):

- g6, 6to4 (8): `emb-6to4-loopback`, `emb-6to4-metadata`, `emb-6to4-rfc1918`, `emb-6to4-public`,
  `meta-imds-6to4-literal`, `meta-imds-dns-6to4`, `v6url-6to4-private`, `dns-6to4-loopback`.
- g7, Teredo (6): `emb-teredo-prefix`, `emb-teredo-doc-client`, `emb-teredo-loopback-client`,
  `meta-imds-dns-teredo`, `v6url-teredo-loopback`, `dns-teredo-loopback`.
- g11, site-local (3): `v6-site-local`, `v6url-site-local`, `dns-site-local`.

Two vectors that both languages allowed now block in both: `meta-azure-wireserver` and `port-zero`. 51 differences
remain; they are the owner's strictest-wins decision and were left alone.

## Filesystem jail (`fs-jail.ts`)

This is a TS port of the Python `agent_tool_sandbox.boundary`, so file tools get the same guarantees in both
languages. All functions are async.

- `assertInsideBoundary(pathStr, root, { denyRoots })` returns the resolved path. It resolves against an explicit
  `root` (nothing comes from the environment) and contains the result with realpath plus the `root + "/"` rule,
  which catches sibling prefixes such as `root-evil/`. It rejects a final real component that starts with `.`
  (`.env`, `.env/`, `.env/./`, `a/../.env/`, or a symlink whose target is a dotfile); dot-directories in the
  middle of a path are allowed, as in Python. It also rejects anything under `denyRoots`.
- `assertNoSymlink(path, { operation })` walks the unresolved path and rejects a symlink in any component. A
  component that can't be inspected (for example EACCES) fails closed.
- `readFileJailed(pathStr, root, { maxBytes, encoding, denyRoots })` checks the path, then opens it with
  `O_NOFOLLOW`. `maxBytes` is required, up to `MAX_READ_BYTES_CEILING` (256 MiB).
- `writeFileJailed(pathStr, data, root, { createParents, mode, encoding, denyRoots })` writes atomically (a temp
  file in the same directory, then rename) and refuses a symlink target.
- Errors are `BoundaryError` with a stable `code`. Windows throws `UNSUPPORTED_PLATFORM` in v0.1.

Parity with Python is enforced by data: `../vectors/fs-vectors.json` (105 layouts) runs in both
`test/shared-fs-vectors.test.ts` and `python/tests/test_shared_fs_vectors.py`. They differ on one declared vector:
both refuse `.env\0` on read, but TS reports the NUL byte where Python reports a dotfile. EACCES is not in the
corpus, because its outcome depends on the environment. On Python 3.13+, `Path.is_symlink()` swallows EACCES, so
only the later `open()` fails there; TS fails closed at the check.

## Testing

The package has no devDependencies of its own. Inside the AlienClaw repo it uses the root `vitest`, `typescript`,
`@types/node` and `fast-check` through normal parent-directory resolution.

```bash
# from the repo root
node_modules/.bin/vitest run staging/agent-tool-sandbox/ts
node_modules/.bin/tsc -p staging/agent-tool-sandbox/ts/tsconfig.json
```

The tests make no external network calls. `node:dns/promises` is replaced with `vi.mock`, and the decision tests stub
the internal `transport.request` seam in `src/pinned-request.ts` (it took the place of `globalThis.fetch`; it is not
exported from the package entry points), with a throwing guard in `beforeEach`. Tests that need a real server use
127.0.0.1 listeners they start and close: the slow-drip test in `test/hardening.test.ts`, and `test/pinning.test.ts`,
which feeds hardenedFetch a fake `resolve` hook, wraps `net.Socket.prototype.connect` so that no socket can dial
anything but loopback, and uses the global `fetch` against the same listener as the reference for the parity checks.
**New tests that reach the transport must stub `transport.request` (or use the pinning instruments), not
`globalThis.fetch`: a `fetch` stub is never called now, and the request would go to the real network.**
`test/parity-in-tree.test.ts` imports the in-tree module by relative path. Delete it, or point it at a pinned copy,
when the package leaves the repo.

**Property-based tests** (`fast-check`, a fixed seed on every `fc.assert`, about 3 s together) check invariants over
generated inputs rather than listed examples:

- `test/property-classifier.test.ts`: `isBlockedHost` and `validateResolvedAddresses` agree with
  `test/reference-blocklist.ts`, an independent classifier that reads `../policy/blocklist.v1.json` itself (its own
  parsing and BigInt CIDR arithmetic, the matching rules and profiles of `../policy/README.md`, no code shared with
  `src/` or the generator). Addresses are biased to every range's first and last address and their neighbours, drawn
  inside each range, embedded (IPv4-compatible, -mapped, -translated, NAT64, 6to4, Teredo and near misses) or uniform.
  Every textual spelling of an IPv6 address (compressed anywhere, expanded, zero-padded, dotted tail, mixed case, zone
  ID) gets one verdict, and so does every spelling of a host that WHATWG URL normalises to one host (case, full-width
  forms, ideographic dots, soft hyphens, percent-encoding, IDNA labels, hex/octal/short IPv4, trailing dots).
- `test/property-fetch.test.ts`: for generated multi-answer `resolve` results, `hardenedFetch` refuses before any
  socket connect, or the socket is offered exactly the validated answer and Node dials from it; `resolve` runs once
  per hop, across generated redirect chains too (the `test/pinning.test.ts` connect instruments, copied). Generated
  `FetchPolicy` objects: a bad field is a `TypeError` naming the first bad field before any I/O, a valid one is
  accepted and enforced, and each field is read once.
- `test/property-strictest-wins.test.ts`: the same reference check with `src/blocklist-data.ts` replaced (through
  `vi.mock`, nothing on disk) by the table `../policy/gen-ts.mjs` resolves for `strictest-wins`, the profile gate G3
  may switch to.

The reference-based suites skip when `../policy/` is not next to the package. A failing property prints its
counterexample, seed and path; add the counterexample to that assertion's `examples` as a regression case.

## Packaging

`package.json` describes the published shape: `exports` (`.` and `./hardened-fetch`, each with a `types` condition)
and `types` point at `dist/`, which `tsconfig.build.json` fills with ESM `.js` plus `.d.ts` from `src/` only (tests
are not compiled). `files` is `dist` and `README.md`; npm adds `package.json` (and a `LICENSE` file once one is
added at the package root). The tests do **not** go through `exports`: they import `../src/*.js` by relative path,
which vitest and `tsc` resolve to the `.ts` sources, so they always run against `src/` and need no build step and
no custom export condition. Nothing in the repo imports the package by name.

```bash
# from this directory; never into the repo (dist/ is gitignored, keep it out anyway)
../../../node_modules/.bin/tsc -p tsconfig.build.json --outDir /tmp/some-dir
npm pack --dry-run --json      # lists README.md, package.json and dist/** only, offline
```

`private: true` stays until the publication decision; there is no `prepack` script, so a pack without a fresh build
would ship a stale or missing `dist/`. Add `"prepack": "npm run build"` when the package moves to its own repo with
its own devDependencies.

## License

The AlienClaw repository is MIT-licensed (`LICENSE`, Copyright (c) 2026 Bugsy Hewitt), and this staged copy is under the
same terms. The license for any eventual open-source release is the copyright holder's decision; it is not settled here.
