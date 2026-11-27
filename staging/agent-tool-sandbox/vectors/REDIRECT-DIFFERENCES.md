# Redirect corpus: Python vs TypeScript differences

Input to the owner's gate G5 decision (`docs/salvage/OSS-LIB-EXTRACTION-PLAN.md`). The
corpus `redirect-vectors.json` (81 vectors) records what each implementation does. It does
not say what either one should do. Python is `pinned_urlopen(..., follow_redirects=N)`; TS
is `hardenedFetch(url, { maxRedirects: N, ... })`, with the same N in every vector. Python's
default of `follow_redirects=0` (against TS's `maxRedirects` default of 5) is a documented
API difference and has no vector here.

Recorded 2026-11-26 on CPython 3.14 and Node 24.18, inside `staging/tools/offline.sh`. The
two harnesses are `../python/tests/test_shared_redirect_vectors.py` and
`../ts/test/shared-redirect-vectors.test.ts`. Their docstrings describe the listeners, the
test-only resolver and wire, and how to re-record: `REDIRECT_VECTORS_RECORD=<dir>` writes
one `<id>.<lang>.json` per vector, and each file's `observed` becomes that vector's
`expected.<lang>`.

| | Vectors |
|---|---|
| python == ts | 14 |
| python != ts, API surface only (A1, A2) | 50 |
| python != ts, behaviour (B1 to B9) | 17 |

Every `python != ts` vector appears below exactly once.

## What both implementations do the same way

- **Internal destinations.** Each of the 22 `internal-*` vectors is refused before any connect in
  both languages, with `stray_connects: []`. The vectors cover loopback in 7 spellings, RFC 1918,
  cloud metadata as a literal and as a name, Azure WireServer, CGNAT, ULA, NAT64 metadata, a name
  that answers private, loopback or mixed, NXDOMAIN, and 4 localhost names. Localhost names never
  reach the resolver in either language. These vectors differ only through A2.
- **Hop cap and loops.** `cap-*`, `loop-*`: with N redirects allowed, both make at most N + 1
  requests and refuse the next redirect. 20 hops work in both.
- **Deadline.** All 5 `deadline-*` vectors match. One budget covers every hop. A stalled or
  dripping hop ends at the budget, and a redirect body is never read, so a dripping redirect
  body costs nothing.
- **No cookie jar.** A `Set-Cookie` on a redirect is not replayed (`cred-set-cookie-not-replayed`).
- **Location parsing.** Relative, dot-segment, query-only, fragment and scheme-relative
  Locations resolve the same way. A tab inside the Location is stripped in both (Python's
  `urljoin` strips it too).
- **Scheme changes.** `file:`, `ftp:`, `data:`, `javascript:` and `gopher:` Locations are refused. An http to
  https upgrade is followed.

## A. API surface (not redirect logic)

**A1. TS does not return the status.** `hardenedFetch` returns only the body string, so a
TS `ok` outcome has no `status`. 13 vectors differ only in this:
`status-201-location-not-followed`, `relative-absolute-path`, `relative-dot-segments`,
`relative-query-only`, `relative-fragment`, `relative-tab-in-path`,
`cred-set-cookie-not-replayed`, `cred-caller-host-header`, `cap-exact`, `cap-twenty`,
`deadline-slow-hops-control`, `deadline-redirect-body-not-read`, `body-large-redirect-body`.
*Recommendation:* none needed for G5.

**A2. TS cannot send a method, headers or a body.** `hardenedFetch` always sends its own
GET with fixed headers, so the vector's `request.method`, `headers` and `body` reach only the
Python hops. As a result, TS cannot be tested for credential stripping, 301/302/303 rewriting or
307/308 replay. Its credential vectors pass trivially, because TS never had credentials to send.
In these 37 vectors the only difference is what hops carried (once the Python hops are reduced
to TS's GET with only `host`):
`status-301-post`, `status-302-post`, `status-303-post`, `status-307-post`,
`status-308-post`, `status-307-put-cross-origin`, `status-303-head`,
`relative-scheme-relative-cross-origin`, `scheme-http-to-https`, `cred-same-origin`,
`cred-cross-host-302`, `cred-cross-host-307`, `cred-cross-port`, `cred-cross-scheme`,
`cred-cross-origin-and-back`, and the 22 `internal-*` vectors (their first hop carried
the caller's credentials in Python only).

What the Python side shows:
- 301/302/303 become a body-less GET, and HEAD stays HEAD.
- 307/308 replay the method and the body, also across origins.
- `Authorization`, `Cookie` and `Proxy-Authorization` are dropped on any change of host, port
  or scheme. They are not restored when the chain comes back to the first origin.
- A caller-set `Host` is replaced on a cross-origin hop.
- `X-Api-Key` follows a cross-origin hop. This is a documented limit: only the three named
  headers count as credentials.

*Recommendation:* if TS gains `method`/`headers`/`body` options, port these rules unchanged.
These vectors then test them without edits, apart from re-recording `expected.ts`.

## B. Behaviour

**B1. A 3xx that is not a redirect status, sent with a Location header.** Vectors:
`status-300-with-location`, `status-304-with-location`, `status-305-with-location`,
`status-306-with-location`. Python raises `HTTPError` with that status. TS follows it,
because it treats any 300-399 response that has a Location as a redirect. Fetch follows only
301/302/303/307/308. Each hop is still re-validated, so this is not SSRF. Still, a `304` or
`305 Use Proxy` sent to another origin should not be followed.
*Recommendation:* in TS, follow only 301/302/303/307/308 (reported as a TS bug).

**B2. 3xx without a Location header** (`status-302-without-location`). Both fail after one
request: Python with `HTTPError` 302, TS with `Redirect with no Location header`. Only the
error type differs. *Recommendation:* no change.

**B3. Empty Location** (`status-302-empty-location`, max 3). Python resolves `""` against
the current URL (RFC 3986) and requests the same URL again until the hop cap: 4 requests,
then `hop_cap`. TS treats an empty value as missing: 1 request, then `no_location`.
*Recommendation:* fail fast in both (the TS behaviour). Low priority.

**B4. Two Location headers** (`status-302-two-location-headers`). Python follows the first
one. TS joins them (`<first>, <second>`) and parses the result as one URL. The host comes from
the first one, and the second URL becomes part of the path
(`/one,%20http://c.redirect.test:{port:c}/two`). Browsers refuse such a response
(`ERR_RESPONSE_HEADERS_MULTIPLE_LOCATION`).
*Recommendation:* refuse a redirect with more than one Location, in both libraries (reported
as a TS bug; the Python behaviour is defensible but silent).

**B5. Parser differentials in Location.**
- `relative-backslash-authority` (`/\b.redirect.test:PORT/x`): TS follows it to **another
  origin** (b), because WHATWG reads `\` as `/` in special schemes. Python refuses any backslash.
- `relative-space-in-path` (`/a b`): TS percent-encodes the space and follows. Python refuses raw
  whitespace.

Each library is consistent with its own parser: TS validates and connects with WHATWG `URL`.
The case for change is downstream consumers, which may parse the same Location differently.
*Recommendation (strictest wins):* TS refuses a Location that contains `\` or raw whitespace,
as Python's guard does.

**B6. Non-ASCII Location** (`relative-non-ascii-path`, UTF-8 bytes on the wire). Both decode
the header as Latin-1.
- **Python crashes.** The guard accepts the hop. `http.client` then cannot encode the request
  line and raises `UnicodeEncodeError` out of `pinned_urlopen`. This is not one of its
  documented exceptions (`SsrfBlockedError`, `HTTPError`, `URLError`). It fails closed (no
  second request is sent), but a caller that catches the documented types crashes.
- TS percent-encodes the mojibake (`/caf%C3%83%C2%A9`) and follows.

*Recommendation:* Python raises `SsrfBlockedError` (or percent-encodes) for a non-ASCII
URL (reported as a Python bug).

**B7. https to http downgrade** (`scheme-https-to-http`, `scheme-https-to-http-uppercase`).
Python refuses the hop (`downgrade`) before resolving it. TS follows it, as documented:
its default `protocols` allows http, and `protocols: ['https']` forbids every http URL, not
only a downgrade.
*Recommendation (the main G5 alignment item):* TS refuses https to http by default, as
Python does and as G5's "redirect handling aligned" implies. Keep `protocols` as a separate
allowlist.

**B8. Redirect to port 25 of a public host** (`port-smtp`). Python dials it (it has no port
policy), which shows as `stray_connects: ["93.184.216.34:25"]`. TS refuses it before
connecting (the Fetch bad-port list). The address is public, so this is a port-policy question, not SSRF.
*Recommendation:* owner's call. If Python adopts the Fetch bad-port list, it should at least
apply it to redirect hops, whose port the server chooses.

**B9. Userinfo in Location.**
- `userinfo-user-password`, `userinfo-user-only`, `userinfo-authority-confusion`: both
  refuse. TS refuses only in its transport, after it has resolved the hop's host, so `resolved`
  includes `b.redirect.test` in TS. Python refuses before DNS.
- `userinfo-empty` (`http://@b.redirect.test/`): TS follows it (WHATWG drops an empty userinfo).
  Python refuses any `@` in the authority.

*Recommendation (strictest wins):* in TS, move the credentials check into `validateUrl`
(before DNS) and refuse any `@` in the authority.

## Library bugs found (not fixed here)

| Library | Vector(s) | Bug |
|---|---|---|
| Python | `relative-non-ascii-path` | `pinned_urlopen` lets `UnicodeEncodeError` escape on a non-ASCII redirect Location (B6). |
| TS | `status-300-with-location`, `status-304-with-location`, `status-305-with-location`, `status-306-with-location` | Any 3xx with a Location is followed, not only 301/302/303/307/308 (B1). |
| TS | `status-302-two-location-headers` | Multiple Location headers are comma-joined and followed as one URL (B4). |

The TS https to http downgrade (B7) is documented behaviour, not a bug. It is the open G5
decision.
