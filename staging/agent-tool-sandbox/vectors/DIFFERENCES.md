# Python vs TS SSRF verdicts: differences

> **This is input to the owner's decision, not a decision.** The corpus RECORDS current behaviour. Apart from the clear-cut gaps closed on 2026-11-26 (see [Resolved](#resolved)), neither implementation was changed for this list. Plan `docs/salvage/OSS-LIB-EXTRACTION-PLAN.md` §3.4 (gate G3) proposes a strictest-wins default. The *Strictest wins* column below is what that rule produces for each vector, nothing more.

Generated from `ssrf-vectors.json` (generated_at 2026-11-26, CPython 3.14.9, Node 24.18.0). Of 296 vectors, **50 differ**. The corpus was first frozen with 68; the 17 that the 2026-11-26 gap fixes resolved are listed under [Resolved](#resolved), with the two both-allow vectors those fixes also closed. Inputs are shown JSON-escaped, and `→` shows the mocked DNS answer of a `url` vector. Level `ip` is the post-DNS address classifier, and level `url` is the full guard. See README.md for the harness.

State of the code when the verdicts were frozen: the TS package already had its connection-pinning transport (`ts/src/pinned-request.ts`, which also fixed SR-09 by stripping IPv6-literal brackets). The Python package had `pinning.py`, which runs the same checks as `assert_safe_fetch_url`. Both packages were still being edited by other agents. Run `python3 generate.py` (check mode) once those edits land to see any verdict that has moved.

Later on 2026-11-26 the clear-cut gaps were closed in both staged packages and the verdicts regenerated: TS now blocks 6to4 `2002::/16`, Teredo `2001:0::/32` and site-local `fec0::/10` whole (as Python does), both languages block the Azure WireServer address `168.63.129.16`, and both refuse port 0. Exactly 19 vectors changed (21 verdicts), all listed under [Resolved](#resolved); no other verdict moved.

## Summary by range

| Group | Range / rule | Vectors | Python | TS | Strictest wins |
|---|---|---|---|---|---|
| [g1](#g1) | IPv4 `192.0.0.9`, `192.0.0.10`: PCP / TURN anycast inside `192.0.0.0/24` | 4 | allow | block | block (whole /24, as TS does) |
| [g2](#g2) | IPv4 documentation TEST-NETs `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` | 4 | block | allow | block |
| [g3](#g3) | IPv4-mapped `::ffff:0:0/96` with a PUBLIC embedded IPv4 | 3 | allow | block | block all mapped (as TS does) |
| [g4](#g4) | NAT64 well-known prefix `64:ff9b::/96`, embedded IPv4 that TS's table allows | 4 | block | allow | block by default; `nat64: 'decode'` opt-in (plan §3.4) |
| [g5](#g5) | `64:ff9b::/32` outside the `/96` well-known and `/48` local-use prefixes | 2 | block | allow | block |
| [g8](#g8) | Rest of `2001::/23` (IETF protocol assignments) | 4 | block | allow | block, except the IANA globally-reachable exceptions |
| [g9](#g9) | IPv6 documentation `2001:db8::/32`, `3fff::/20` | 3 | block | allow | block |
| [g10](#g10) | Discard-only `100::/64` and the rest of `100::/8` | 2 | block | allow | block |
| [g12](#g12) | Other IPv6 space outside `2000::/3` | 6 | block | allow | block (rule: allow only inside 2000::/3, minus the rows above) |
| [g13](#g13) | Pre-DNS hostname rule (`localhost`) | 0 (resolved) | block | block | block pre-DNS |
| [g14](#g14) | Raw-URL spellings Python refuses and WHATWG normalises | 15 | block | allow | reject (Python's rule); TS adds a raw-string pre-check before `new URL()` |
| [g15](#g15) | URL spellings WHATWG refuses and Python accepts | 3 | allow | block | reject |

Groups g6 (6to4), g7 (Teredo) and g11 (site-local) are resolved; their ids are not reused. Python is the stricter side on 40 vectors, and TS on 11. The CGNAT difference mentioned in earlier notes is not present: the staged Python blocks `100.64.0.0/10` in every spelling in the corpus (IPv4, mapped, NAT64, 6to4 and DNS answer), so only the in-tree AlienClaw copy still differs there.

## Every differing vector

<a id="g1"></a>
### g1: IPv4 `192.0.0.9`, `192.0.0.10`: PCP / TURN anycast inside `192.0.0.0/24`

Refs: RFC 7723, RFC 8155, RFC 6890.

Python's `ipaddress` exempts these two from `is_private` because IANA marks them globally reachable. They are anycast addresses that route to the nearest PCP or TURN server, which is usually the local gateway or an on-network relay. Plan §3.4 already picks the whole /24. The IPv6 equivalents `2001:1::1` and `2001:1::2` are allowed by **both** languages (see 'Both allow' below), so TS is not internally consistent on this rule either.

| Vector | Level | Input | Python | TS | Strictest wins |
|---|---|---|---|---|---|
| `v4-ietf-pcp-anycast` | ip | `192.0.0.9` | allow | block | block |
| `v4-ietf-turn-anycast` | ip | `192.0.0.10` | allow | block | block |
| `emb-mapped-pcp-anycast` | ip | `::ffff:192.0.0.9` | allow | block | block |
| `dns-pcp-anycast` | url | `http://pcp.example/` → 192.0.0.9 | allow | block | block |

<a id="g2"></a>
### g2: IPv4 documentation TEST-NETs `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`

Refs: RFC 5737.

Not routed on the internet, so blocking costs nothing. A private network that reuses them is internal by definition.

| Vector | Level | Input | Python | TS | Strictest wins |
|---|---|---|---|---|---|
| `v4-test-net-1-host` | ip | `192.0.2.1` | block | allow | block |
| `v4-test-net-2` | ip | `198.51.100.1` | block | allow | block |
| `v4-test-net-3` | ip | `203.0.113.1` | block | allow | block |
| `dns-test-net` | url | `http://testnet.example/` → 192.0.2.1 | block | allow | block |

<a id="g3"></a>
### g3: IPv4-mapped `::ffff:0:0/96` with a PUBLIC embedded IPv4

Refs: RFC 4291 §2.5.5.2.

Python unwraps the mapped address and checks the IPv4, so a public one passes. TS blocks the whole /96. A resolver never needs to return a mapped address for a public host, and a mapped literal in a URL is only ever an evasion attempt. Blocking all of them removes the unwrap code path entirely. Private embeddings are blocked by both.

| Vector | Level | Input | Python | TS | Strictest wins |
|---|---|---|---|---|---|
| `emb-mapped-public` | ip | `::ffff:8.8.8.8` | allow | block | block all mapped |
| `v6url-mapped-public` | url | `http://[::ffff:8.8.8.8]/` | allow | block | block all mapped |
| `dns-mapped-public` | url | `http://mapped-public.example/` → ::ffff:93.184.216.34 | allow | block | block all mapped |

<a id="g4"></a>
### g4: NAT64 well-known prefix `64:ff9b::/96`, embedded IPv4 that TS's table allows

Refs: RFC 6052 §2.1, RFC 6147.

Python blocks the whole /96 (it sits in reserved `::/8`). TS decodes the last 32 bits and blocks only when that IPv4 is blocked. **This is the DNS64 trade-off; see the section below.** `emb-nat64-test-net` shows that decoding inherits TS's IPv4 table, TEST-NET gap included.

| Vector | Level | Input | Python | TS | Strictest wins |
|---|---|---|---|---|---|
| `emb-nat64-public` | ip | `64:ff9b::808:808` | block | allow | block by default |
| `v6url-nat64-public` | url | `http://[64:ff9b::808:808]/` | block | allow | block by default |
| `dns-dns64-public` | url | `http://dns64.example/` → 64:ff9b::5db8:d822 | block | allow | block by default |
| `emb-nat64-test-net` | ip | `64:ff9b::c000:201` | block | allow | block by default |

<a id="g5"></a>
### g5: `64:ff9b::/32` outside the `/96` well-known and `/48` local-use prefixes

Refs: RFC 6052, RFC 8215, IANA IPv6 Address Space.

These addresses are unassigned space inside reserved `::/8`. TS checks only the /96 and the /48, so anything else under `64:ff9b::/32` falls through as allowed. The 'allow only inside 2000::/3' rule from plan §3.4 covers them.

| Vector | Level | Input | Python | TS | Strictest wins |
|---|---|---|---|---|---|
| `emb-nat64-32-outside-96` | ip | `64:ff9b:0:0:1::7f00:1` | block | allow | block |
| `emb-nat64-32-outside-48` | ip | `64:ff9b:2::a9fe:a9fe` | block | allow | block |

<a id="g8"></a>
### g8: Rest of `2001::/23` (IETF protocol assignments)

Refs: RFC 2928, RFC 5180, RFC 4843, RFC 9665.

Python blocks all of 2001::/23 except the entries IANA marks globally reachable. Inside it, TS blocks only Teredo `2001:0::/32` (since 2026-11-26). `2001:1::3` (DNS-SD SRP anycast, RFC 9665) is marked globally reachable by IANA, but Python 3.10-3.14 do not yet exempt it. It routes to the nearest SRP server, typically an on-site Thread border router, so strictest-wins (block) is also the safe reading.

| Vector | Level | Input | Python | TS | Strictest wins |
|---|---|---|---|---|---|
| `v6-ietf-2001-23-last` | ip | `2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff` | block | allow | block, except the IANA globally-reachable exceptions |
| `v6-benchmarking` | ip | `2001:2::1` | block | allow | block, except the IANA globally-reachable exceptions |
| `v6-orchid-deprecated` | ip | `2001:10::1` | block | allow | block, except the IANA globally-reachable exceptions |
| `v6-srp-anycast` | ip | `2001:1::3` | block | allow | block, except the IANA globally-reachable exceptions |

<a id="g9"></a>
### g9: IPv6 documentation `2001:db8::/32`, `3fff::/20`

Refs: RFC 3849, RFC 9637.

Never routed, so blocking costs nothing.

| Vector | Level | Input | Python | TS | Strictest wins |
|---|---|---|---|---|---|
| `v6-doc-2001-db8` | ip | `2001:db8::1` | block | allow | block |
| `v6-doc-3fff` | ip | `3fff::1` | block | allow | block |
| `v6url-doc` | url | `http://[2001:db8::1]/` | block | allow | block |

<a id="g10"></a>
### g10: Discard-only `100::/64` and the rest of `100::/8`

Refs: RFC 6666, IANA IPv6 Address Space.

Not globally reachable.

| Vector | Level | Input | Python | TS | Strictest wins |
|---|---|---|---|---|---|
| `v6-discard-host` | ip | `100::1` | block | allow | block |
| `v6-reserved-100-8` | ip | `100:0:0:1::1` | block | allow | block |

<a id="g12"></a>
### g12: Other IPv6 space outside `2000::/3`

Refs: RFC 4291, IANA IPv6 Address Space, RFC 9602.

TS enumerates bad prefixes and lets everything else through, so all of the space IANA reserves passes: `4000::/3` (including the `5f00::/16` SRv6 SIDs), `fe00::/9`, and the odd `::/8` shapes. Those shapes are `::1:ffff:0:0`, `ffff` at group 3, and a non-zero group 5 before an IPv4 tail. Python's `is_reserved` covers all of them.

| Vector | Level | Input | Python | TS | Strictest wins |
|---|---|---|---|---|---|
| `v6-srv6-sid` | ip | `5f00::1` | block | allow | block |
| `v6-reserved-fe00` | ip | `fe00::1` | block | allow | block |
| `v6-reserved-1-ffff-0-0` | ip | `::1:ffff:0:0` | block | allow | block |
| `v6-reserved-4000` | ip | `4000::1` | block | allow | block |
| `emb-ffff-wrong-group` | ip | `::ffff:0:0:7f00:1` | block | allow | block |
| `emb-compat-group5-nonzero` | ip | `::1:7f00:1` | block | allow | block |

<a id="g13"></a>
### g13: Pre-DNS hostname rule (`localhost`)

Refs: RFC 6761 §6.3, plan G7.

TS refuses `localhost`, `ip6-localhost` and `ip6-loopback` by name, before DNS. Python relies on the answer, so a resolver or `/etc/hosts` that maps `localhost` to a public address passes. Neither language blocks `localhost.` or `*.localhost` by name; both block them through the 127.0.0.1 answer (`dot-localhost`, `loc-subdomain`).

| Vector | Level | Input | Python | TS | Strictest wins |
|---|---|---|---|---|---|
| `loc-localhost-lying-resolver` | url | `http://localhost/` → 93.184.216.34 | block | block | resolved: Python blocks `localhost`/`*.localhost` pre-DNS since the G7 change (2026-11-26) |

<a id="g14"></a>
### g14: Raw-URL spellings Python refuses and WHATWG normalises

Refs: SR-01, SR-03, plan §3.4 userinfo / percent rows.

Python refuses any URL on which two parsers could disagree. That means a backslash, any whitespace or non-printable character (soft hyphen, ZWSP, tab, CR/LF, leading space), any `@` in the authority, `%` in the host, a missing `//`, and IDNA-illegal labels (over 63 characters, empty). TS parses once with WHATWG, and its transport connects to that same parsed host. These TS allows therefore go to the host that was checked, so they are **not bypasses today**. Rejecting them still matters for a published library: callers hand the same string to other clients (the SR-01 lesson), and strictest-wins keeps one contract.

| Vector | Level | Input | Python | TS | Strictest wins |
|---|---|---|---|---|---|
| `idna-soft-hyphen` | url | `http://exa\u00admple.com/` → 93.184.216.34 | block | allow | reject |
| `idna-zero-width-space` | url | `http://exa\u200bmple.com/` → 93.184.216.34 | block | allow | reject |
| `idna-overlong-label` | url | `http://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.example/` → 93.184.216.34 | block | allow | reject |
| `idna-empty-label` | url | `http://a..example/` → 93.184.216.34 | block | allow | reject |
| `ui-empty` | url | `http://@public.example/` → 93.184.216.34 | block | allow | reject |
| `bs-public-before` | url | `http://public.example\\@169.254.169.254/` → 93.184.216.34 | block | allow | reject |
| `bs-path-separator` | url | `http://public.example\\path` → 93.184.216.34 | block | allow | reject |
| `bs-scheme-slashes-public` | url | `http:\\\\public.example\\` → 93.184.216.34 | block | allow | reject |
| `pct-sr03-dot` | url | `http://a%2ex.attacker.tld/` → 93.184.216.34 | block | allow | reject |
| `ws-tab-in-host` | url | `http://127.0.0.1\t.public.example/` → 93.184.216.34 | block | allow | reject |
| `ws-leading-space-public` | url | ` http://public.example/` → 93.184.216.34 | block | allow | reject |
| `ws-crlf-in-path` | url | `http://public.example/\r\nHost: 127.0.0.1` → 93.184.216.34 | block | allow | reject |
| `scheme-single-slash` | url | `http:/public.example/` → 93.184.216.34 | block | allow | reject |
| `scheme-no-slash` | url | `http:public.example` → 93.184.216.34 | block | allow | reject |
| `scheme-triple-slash` | url | `http:///public.example/` → 93.184.216.34 | block | allow | reject |

<a id="g15"></a>
### g15: URL spellings WHATWG refuses and Python accepts

Refs: RFC 6874, RFC 3986 §3.2.2, UTS #46.

WHATWG rejects IPv6 zone IDs, IPvFuture literals and invalid punycode. Python accepts a raw numeric zone on a public address. It also hands the IPvFuture host `v1.fe80::a+en1` to `getaddrinfo` as a DNS name, because `_ascii_host` skips the character allowlist for any host containing `:`. And it accepts `xn--zz` as an opaque label. None of these reaches an internal address in the corpus, but agent tools never need them.

| Vector | Level | Input | Python | TS | Strictest wins |
|---|---|---|---|---|---|
| `zone-url-raw-numeric-public` | url | `http://[2606:4700:4700::1111%1]/` | allow | block | reject |
| `v6url-ipvfuture` | url | `http://[v1.fe80::a+en1]/` → 93.184.216.34 | allow | block | reject |
| `idna-invalid-punycode` | url | `http://xn--zz.example/` → 93.184.216.34 | allow | block | reject |

<a id="resolved"></a>
## Resolved 2026-11-26

Closed in both staged packages (`python/src/agent_tool_sandbox/ssrf_guard.py`, `ts/src/hardened-fetch.ts`), with regression tests in `python/tests/test_wireserver_port_zero.py` and `ts/test/corpus-gaps.test.ts`. The in-tree AlienClaw copies are unchanged, so these are declared divergences from them (both `PROVENANCE.json` files and both parity tests).

| Former group | Rule now | Vectors | Was (Python / TS) | Now |
|---|---|---|---|---|
| g6 | TS blocks 6to4 `2002::/16` whole, public embeds included (Python's behaviour and the strictest-wins pick) | 8 | block / allow | block / block |
| g7 | TS blocks Teredo `2001:0::/32` whole: the client IPv4 is obfuscated and the server IPv4 is attacker-chosen | 6 | block / allow | block / block |
| g11 | TS blocks deprecated site-local `fec0::/10` whole (RFC 3879) | 3 | block / allow | block / block |
| both-allow | Both block the Azure WireServer address `168.63.129.16` by name, next to the metadata ranges (TS puts it in the IPv4 table, so its NAT64 embedding `64:ff9b::a83f:8110` is caught too; Python already blocked every IPv6 embedding of it) | 1 | allow / allow | block / block |
| both-allow | Both refuse port 0 (Python: `Refusing URL with port 0: ...`; TS: `Port rejected: 0 ...`, before DNS). The TS pinned transport used to hand 0 to `node:http`, which dials the default port 80. Ports above 65535 were already refused by both parsers | 1 | allow / allow | block / block |

| Vector | Level | Input | Python | TS |
|---|---|---|---|---|
| `emb-6to4-loopback` | ip | `2002:7f00:1::1` | block | allow → block |
| `emb-6to4-metadata` | ip | `2002:a9fe:a9fe::1` | block | allow → block |
| `emb-6to4-rfc1918` | ip | `2002:a00:1::1` | block | allow → block |
| `emb-6to4-public` | ip | `2002:808:808::1` | block | allow → block |
| `meta-imds-6to4-literal` | url | `http://[2002:a9fe:a9fe::]/latest/meta-data/` | block | allow → block |
| `meta-imds-dns-6to4` | url | `http://imds-6to4.example/latest/meta-data/` → 2002:a9fe:a9fe::1 | block | allow → block |
| `v6url-6to4-private` | url | `http://[2002:7f00:1::1]/` | block | allow → block |
| `dns-6to4-loopback` | url | `http://sixtofour.example/` → 2002:7f00:1::1 | block | allow → block |
| `emb-teredo-prefix` | ip | `2001::1` | block | allow → block |
| `emb-teredo-doc-client` | ip | `2001:0:4136:e378:8000:63bf:3fff:fdd2` | block | allow → block |
| `emb-teredo-loopback-client` | ip | `2001:0:4136:e378:8000:63bf:80ff:fffe` | block | allow → block |
| `meta-imds-dns-teredo` | url | `http://imds-teredo.example/latest/meta-data/` → 2001:0:4136:e378:8000:63bf:5601:5601 | block | allow → block |
| `v6url-teredo-loopback` | url | `http://[2001:0:4136:e378:8000:63bf:80ff:fffe]/` | block | allow → block |
| `dns-teredo-loopback` | url | `http://teredo.example/` → 2001:0:4136:e378:8000:63bf:80ff:fffe | block | allow → block |
| `v6-site-local` | ip | `fec0::1` | block | allow → block |
| `v6url-site-local` | url | `http://[fec0::1]/` | block | allow → block |
| `dns-site-local` | url | `http://sitelocal.example/` → fec0::1 | block | allow → block |
| `meta-azure-wireserver` | url | `http://168.63.129.16/machine?comp=goalstate` | allow → block | allow → block |
| `port-zero` | url | `http://public.example:0/` → 93.184.216.34 | allow → block | allow → block |

## DNS64 / NAT64 compatibility trade-offs (group g4)

- **What breaks if the whole `64:ff9b::/96` is blocked (Python today, plan v1 default).** On an IPv6-only host behind DNS64, every IPv4-only public site resolves only to `64:ff9b::<v4>`. Examples are IPv6-only cloud subnets with DNS64 turned on, many mobile networks, and some container platforms. Blocking the /96 makes all of those sites unreachable (`dns-dns64-public`). On dual-stack and IPv4 hosts nothing is lost, because the resolver never returns these addresses there.
- **What decoding keeps safe (TS today).** RFC 6052 §2.1 says the well-known prefix always uses the /96 format, so the embedded IPv4 is always the last 32 bits. Decoding and re-checking those bits blocks every private embedding the corpus has (loopback, metadata, RFC 1918, CGNAT, 192.0.0.9), and both languages agree on those vectors. One residual: the decode inherits the IPv4 table, gaps included (`emb-nat64-test-net`).
- **What neither choice covers.** A network-specific NAT64 prefix (RFC 6052 §2.2, any /32 to /96 the operator picks) looks like ordinary global unicast. A host behind such a translator can reach internal IPv4 through it whatever this block list says. That needs a configurable prefix list (for example `nat64Prefixes`, learned per RFC 7050 from `ipv4only.arpa`) or an egress firewall. `192.0.0.170`/`.171`, the discovery answers, are blocked by both.
- **Local-use `64:ff9b:1::/48` (RFC 8215).** Both block it whole. That is correct: the operator picks the embedding length, so the IPv4 cannot be located reliably.
- **The choice for the owner.** Strictest-wins means block the /96 by default and offer an explicit `nat64: 'decode'` opt-in for IPv6-only deployments (plan §3.4). The alternative is to default to decode, which works out of the box on IPv6-only hosts and accepts the inherited-table residual. Either way, both languages should share the IPv4 table that the decode feeds.

## Both languages allow, but worth a look

These are not differences. They are the `allow`/`allow` vectors a reviewer may not expect, listed for the same decision.

| Vector | Input | Why it matters |
|---|---|---|
| `port-redis-public` | `http://public.example:6379/` | Neither language has a port policy (SR-14). TS refuses only the Fetch bad-port list. |
| `v6-pcp-anycast` | `2001:1::1` | `2001:1::1` (PCP anycast) is allowed by both, while TS blocks the IPv4 twin `192.0.0.9` (group g1). |
| `v6-turn-anycast` | `2001:1::2` | `2001:1::2` (TURN anycast): same as above, twin of `192.0.0.10`. |
| `v4-6to4-relay-anycast` | `192.88.99.1` | `192.88.99.0/24`, the deprecated 6to4 relay anycast prefix (RFC 7526). Plan §3.4 says block. Both languages allow it. |
| `emb-isatap-loopback` | `2001:4860:4860::5efe:7f00:1` | An ISATAP interface ID (`::5efe:a.b.c.d`, RFC 5214) on a global prefix that embeds 127.0.0.1. It reaches the IPv4 only where the prefix is on-link on an ISATAP interface. Low risk. |

Every other `allow`/`allow` vector is a public control: a range edge just outside a block, a public literal or name, an IANA globally-reachable assignment (AS112, AMT, ORCHIDv2, drone DETs), or a harmless URL spelling.
