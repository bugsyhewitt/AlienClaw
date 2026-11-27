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

Re-recorded the same day after the three library bugs the corpus found were fixed (see
"Library bugs found"). Exactly 7 vectors changed, 9 recorded outcomes in all:
`status-300-with-location`, `status-304-with-location`, `status-305-with-location`,
`status-306-with-location` (TS), `status-302-two-location-headers` (both),
`relative-non-ascii-path` (both), `status-302-empty-location` (Python). No other vector's
outcome moved, so none of the policy items below (B5, B7, B8, B9) changed.

| | Vectors (before the fixes) |
|---|---|
| python == ts | 19 (14) |
| python != ts, API surface only (A1, A2) | 51 (50) |
| python != ts, behaviour (B2, B5, B7, B8, B9) | 11 (17) |

Every `python != ts` vector appears below exactly once. B1, B3, B4 and B6 are resolved and
kept, struck through, so that their numbers stay stable.

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
- **Redirect statuses** (since the fixes). Only 301, 302, 303, 307 and 308 are followed. A
  300, 304, 305 or 306 is an HTTP error after one request even with a Location
  (`status-30x-with-location`): Python raises `HTTPError`, TS `HTTP <status> from <host>`.
- **Two Location headers** (since the fixes, `status-302-two-location-headers`). Both refuse
  the response after one request, as browsers do: Python
  `SsrfBlockedError("Refusing redirect (status 302): 2 Location headers")`, TS
  `Error("Redirect with 2 Location headers (status 302)")`. The harnesses classify both as
  `multiple_location`.
- **Non-ASCII Location** (since the fixes, `relative-non-ascii-path`; differs only through
  A1). Both read the header's bytes as UTF-8, as browsers and `fetch()` do, and percent-encode
  the result: `/café` sent as UTF-8 is requested as `/caf%C3%A9`.

## A. API surface (not redirect logic)

**A1. TS does not return the status.** `hardenedFetch` returns only the body string, so a
TS `ok` outcome has no `status`. 14 vectors differ only in this:
`status-201-location-not-followed`, `relative-absolute-path`, `relative-dot-segments`,
`relative-query-only`, `relative-fragment`, `relative-tab-in-path`,
`relative-non-ascii-path` (since the fixes), `cred-set-cookie-not-replayed`, `cred-caller-host-header`, `cap-exact`, `cap-twenty`,
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

**~~B1. A 3xx that is not a redirect status, sent with a Location header.~~ Resolved.**
Vectors: `status-300-with-location`, `status-304-with-location`, `status-305-with-location`,
`status-306-with-location`. Python raised `HTTPError` with that status. TS followed it,
because it treated any 300-399 response that had a Location as a redirect, a `305 Use Proxy`
to another origin included. *Fixed in TS:* `hardenedFetch` follows only 301/302/303/307/308
(`REDIRECT_STATUSES`); any other 3xx takes the non-2xx path (`HTTP <status> from <host>`).
All four vectors are now python == ts.

**B2. 3xx without a Location header, or with an empty one** (`status-302-without-location`,
and since the fixes `status-302-empty-location`). Both fail after one request: Python with
`HTTPError` 302, TS with `Redirect with no Location header`. Only the error type differs.
*Recommendation:* no change.

**~~B3. Empty Location.~~ Resolved; now part of B2** (`status-302-empty-location`, max 3).
Python resolved `""` against the current URL (RFC 3986) and requested the same URL again until
the hop cap: 4 requests, then `hop_cap`. TS treats an empty value as missing. *Fixed in
Python:* an empty (or blank) Location is treated as a missing one, so `pinned_urlopen`
raises `HTTPError` 302 after 1 request.

**~~B4. Two Location headers.~~ Resolved** (`status-302-two-location-headers`). Python
followed the first one. TS joined them (`<first>, <second>`) and parsed the result as one
URL, with the host from the first and the second URL in the path
(`/one,%20http://c.redirect.test:{port:c}/two`). Browsers refuse such a response
(`ERR_RESPONSE_HEADERS_MULTIPLE_LOCATION`). *Fixed in both:* a redirect with more than one
Location is refused after one request (Python `SsrfBlockedError`, TS `Error`); see "What both
implementations do the same way". The TS check needs the transport's new optional
`headers.getAll()`, which the pinned transport always has (a WHATWG `Response` joins repeated
lines). Now python == ts.

**B5. Parser differentials in Location.**
- `relative-backslash-authority` (`/\b.redirect.test:PORT/x`): TS follows it to **another
  origin** (b), because WHATWG reads `\` as `/` in special schemes. Python refuses any backslash.
- `relative-space-in-path` (`/a b`): TS percent-encodes the space and follows. Python refuses raw
  whitespace.

The same holds for non-ASCII whitespace and control characters (`U+00A0`, `U+3000`, `U+0085`;
no vector): since the B6 fix Python applies its guard's character rule to the UTF-8 decoded
Location *before* it percent-encodes, so it still refuses them, and TS percent-encodes and
follows them. Neither the fix nor the re-recording changed a B5 outcome.

Each library is consistent with its own parser: TS validates and connects with WHATWG `URL`.
The case for change is downstream consumers, which may parse the same Location differently.
*Recommendation (strictest wins):* TS refuses a Location that contains `\` or raw whitespace,
as Python's guard does.

**~~B6. Non-ASCII Location.~~ Resolved; now A1 only** (`relative-non-ascii-path`, UTF-8 bytes
on the wire). Both decoded the header as Latin-1. Python's guard accepted the hop, then
`http.client` could not encode the request line and raised `UnicodeEncodeError` out of
`pinned_urlopen` (not one of its documented exceptions; no second request was sent). TS
percent-encoded the mojibake (`/caf%C3%83%C2%A9`), which is not what `fetch()` sends: undici
re-reads a non-ASCII Location as UTF-8 (`normalizeBinaryStringToUtf8`), as browsers do.
*Fixed in both:* the Location's bytes are read as UTF-8 (invalid sequences become U+FFFD), then
Python percent-encodes non-ASCII in the path, query and fragment as WHATWG does (the guard
still IDNA-encodes or refuses the host) and TS lets `new URL()` do it. Both request
`/caf%C3%A9`, as `fetch()` and browsers do. A non-ASCII URL passed by the *caller* (not a
Location) still raises `UnicodeEncodeError` in Python, as `urllib.request.urlopen` does; it
is outside this corpus.

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

## Library bugs found (all fixed 2026-11-26)

| Library | Vector(s) | Bug | Fix (regression tests) |
|---|---|---|---|
| Python | `relative-non-ascii-path` | `pinned_urlopen` let `UnicodeEncodeError` escape on a non-ASCII redirect Location (B6). | Location read as UTF-8, non-ASCII percent-encoded (`test_redirects.py`). TS's mojibake fixed with it (`hardened-fetch.test.ts`, `pinning.test.ts`). |
| TS | `status-300-with-location`, `status-304-with-location`, `status-305-with-location`, `status-306-with-location` | Any 3xx with a Location was followed, not only 301/302/303/307/308 (B1). | `REDIRECT_STATUSES` (`hardened-fetch.test.ts`; Python pinned by `test_redirects.py`). |
| TS | `status-302-two-location-headers` | Multiple Location headers were comma-joined and followed as one URL (B4). | Refused in both (`hardened-fetch.test.ts`, `pinning.test.ts`, `test_redirects.py`). |
| Python | `status-302-empty-location` | An empty Location re-requested the same URL until the hop cap (B3). | Treated as missing: `HTTPError` 302 at once (`test_redirects.py`). |

The TS https to http downgrade (B7) is documented behaviour, not a bug. It is the open G5
decision.
