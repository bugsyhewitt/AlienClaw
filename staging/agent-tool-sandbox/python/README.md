# agent-tool-sandbox (Python)

Two small, stdlib-only guards for tools that an LLM agent can call:

- **SSRF guard** (`ssrf_guard`): decides whether a URL may be fetched, and builds a
  `urllib` opener that refuses redirects.
- **Connection pinning** (`pinning`): resolves the host once, through the same guard, and
  fetches over a connection that dials only the addresses that passed. This is the
  DNS-rebinding fix; use it whenever the agent can choose the hostname.
- **Filesystem jail** (`boundary`): decides whether a path the agent supplied stays inside
  a directory you choose, and refuses symlinks on write paths.

Status: staging copy, version `0.0.0.dev0`, not published. It builds offline (setuptools):
the wheel holds only the five package modules and metadata, and the sdist leaves the tests
out (`MANIFEST.in`). It was lifted from a
larger project's tool layer and keeps that code's behaviour, with the differences listed
under [Divergences](#divergences-from-the-reference-sources).

License: MIT, the same as the source repository ("Copyright (c) 2026 Bugsy Hewitt"). The
license for an open-source release has **not been decided yet**; that is Bugsy's call.

Requires Python 3.11 or later and has no runtime dependencies. `requires-python` is
`>=3.11` because 3.10 reached end of life in October 2026 (PEP 619) and a security library
should not advertise an interpreter that no longer gets security fixes. The code itself
still runs on 3.10 (nothing 3.11-only is used), but that is not supported.

## API

```python
from agent_tool_sandbox import (
    SsrfBlockedError,          # subclass of ValueError; .detail, .blocked_address, .hostname
    DeadlineExceededError,     # subclass of TimeoutError AND urllib.error.URLError; .phase
    assert_safe_fetch_url,     # (raw_url: str) -> str
    build_no_redirect_opener,  # () -> urllib.request.OpenerDirector
    resolve_and_validate,      # (url: str) -> PinnedTarget
    PinnedTarget,              # frozen dataclass: scheme, host, port, canonical_url, addresses
    build_pinned_opener,       # (target, *, context=None, deadline=None) -> OpenerDirector
    pinned_urlopen,            # (url, data=None, *, timeout=30.0, headers=None, method=None,
                               #  context=None, follow_redirects=0) -> http.client.HTTPResponse
    assert_inside_boundary,    # (path_str, boundary: Path, *, deny_roots=()) -> Path
    assert_no_symlink,         # (path: Path, *, operation="write", root=None) -> None
)
from agent_tool_sandbox.pinning import PinnedHTTPConnection, PinnedHTTPSConnection
```

### Refusal messages (`SsrfBlockedError`)

`str(exc)` is written to be handed back to an agent, whose context a prompt-injected page
may control. So it never names an address the guard learned from DNS. A name that resolves
to an internal address and a name that does not resolve both read
`Refusing hostname 'db.corp': not an allowed destination`, so the message cannot be used
to map internal DNS (PR-03). Refusals decided from the input alone (scheme, userinfo,
port, parser differentials, loopback names) still say what was wrong. Any URL quoted in
a message has its userinfo, query and fragment replaced by `REDACTED`
(`http://REDACTED@host/cb?REDACTED#REDACTED`). That covers a redirect `Location`, the
"opener is pinned to ..." message, and urllib/http.client parse errors.

For logs, the exception carries the rest. **Do not return these attributes to the model:**

| Attribute | Value |
|---|---|
| `detail` | the full reason, for example `Refusing blocked IP 10.0.0.1 (resolved from 'db.corp')` or `Refusing unresolvable hostname 'x'`; equal to `str(exc)` when nothing was withheld |
| `blocked_address` | the `IPv4Address`/`IPv6Address` that was refused, or `None` |
| `hostname` | the host that was checked, or `None` |

The type is unchanged (`SsrfBlockedError(ValueError)`), and `SsrfBlockedError("text")` still
works (`detail == "text"`). Before 2026-11-26, `str(exc)` was what `detail` is now.

### `assert_safe_fetch_url(raw_url) -> str`

Returns a **canonical URL** if `raw_url` passes, and raises `SsrfBlockedError` otherwise.
The canonical URL is rebuilt from the validated parts: lower-case scheme and host, the
host IDNA-encoded to ASCII, the port only if one was given (normalised, so `:080` becomes
`:80` and an empty `:` is dropped), no userinfo, and everything after the authority
exactly as given (an empty `?` or `#` is kept), with every non-ASCII character
percent-encoded as UTF-8 (an IRI such as
`http://bücher.example/café` becomes `http://xn--bcher-kva.example/caf%C3%A9`, as WHATWG
parsers write it; existing `%XX` escapes are left alone). That encoding happens after the
character rule below and before every other check, so the checks see the canonical form,
and urllib can send it (it raises `UnicodeEncodeError` on a non-ASCII request line).
**Fetch the returned URL, not `raw_url`:** it is the only string whose host has
been checked against what urllib, urllib3, httpx and yarl will connect to. It rejects a
URL when:

- it contains a backslash, whitespace or a non-printable character anywhere (urlsplit
  silently drops tab/CR/LF that urllib keeps, and WHATWG parsers such as urllib3, and
  therefore requests, end the authority at `\`);
- the scheme is not `http` or `https`, or the URL has no hostname, or `urlparse` fails;
- the authority has userinfo (any `@`), a `%`, brackets anywhere but around an IPv6
  literal, or more than one `:` outside brackets (urlparse splits the port at the first
  `:`, http.client at the last);
- the port is not a number in 1-65535 (port 0 is refused with `Refusing URL with port 0: ...`:
  urlparse accepts it, and a client that reads 0 as "use the default", as Node's http module
  does, would dial port 80);
- the host urllib would connect to (`Request(url).host` as split by http.client, compared
  as a `(host, port)` pair) differs from the checked one, for `raw_url` and again for the
  canonical URL;
- after IDNA the host name uses a character outside `[a-z0-9._-]`;
- after IDNA, and **before any resolution**, the host is `localhost`, any name under
  `.localhost`, or one of the Debian aliases `ip6-localhost` / `ip6-loopback`, with or
  without trailing dots (`localhost.`, `foo.localhost.`, fullwidth `ｌｏｃａｌｈｏｓｔ`).
  RFC 6761 §6.3 makes these loopback, and stub resolvers such as systemd-resolved answer
  them without asking DNS, so a hosts file or resolver that maps them elsewhere is not
  trusted. `localhost.example.com` and `mylocalhost` are ordinary names. The message is
  `Refusing hostname '<host>': reserved loopback name (RFC 6761)`;
- the hostname cannot be resolved (including IDNA encoding errors);
- **any** address the hostname resolves to is loopback, private (RFC 1918, ULA and the
  rest of the stdlib's private list), link-local (which covers `169.254.169.254`
  metadata), multicast, reserved, unspecified, CGNAT `100.64.0.0/10`, the Azure WireServer
  address `168.63.129.16` (a public address the Azure host fabric answers inside every VM,
  so no range rule catches it), or IPv6 site-local `fec0::/10`. IPv4-mapped IPv6 answers
  (`::ffff:a.b.c.d`) are unwrapped before the check.

Resolution goes through `socket.getaddrinfo`, so every IPv4 spelling that the platform
resolver accepts (`127.1`, `0x7f.0.0.1`, `0177.0.0.1`, `2130706433`, `0`) is checked as
the address it really denotes.

### `build_no_redirect_opener()`

This is a `urllib` opener in which 301, 302, 303, 307 and 308 raise `SsrfBlockedError`
instead of being followed. Other 3xx codes surface as `urllib.error.HTTPError`, because
urllib never follows them. It is **not pinned**: it resolves the name again when it
connects. Prefer `pinned_urlopen`.

### Connection pinning

`assert_safe_fetch_url` resolves the host, checks the addresses and returns a string.
Whatever fetches that string resolves the name **again** when it connects, so a DNS server
that answers with a public address for the check and an internal one for the connect gets
through. The pinning API removes the second resolution.

**`resolve_and_validate(url) -> PinnedTarget`** runs exactly the checks of
`assert_safe_fetch_url`, in the same order and with the same error messages, and calls
`getaddrinfo` **once**. The policy is unchanged: the URL is refused if **any** address in
the answer is blocked. The result is a frozen dataclass:

| Field | Meaning |
|---|---|
| `scheme` | `"http"` or `"https"` |
| `host` | ASCII host as http.client sees it: the IDNA-encoded name, or an IPv6 literal without brackets |
| `port` | effective port (80/443 filled in) |
| `canonical_url` | the same string `assert_safe_fetch_url` returns |
| `addresses` | the validated `IPv4Address`/`IPv6Address` objects, in resolver order, deduplicated, with IPv4-mapped IPv6 unwrapped to IPv4 |

**`build_pinned_opener(target, *, context=None)`** returns a `urllib` opener that:

- connects only to `target.addresses`, trying them in order and moving to the next one on
  a connect error. No resolver is called at connect time: the socket is created for the
  address family of the IP and connected to `(ip, port)` directly, not through
  `socket.create_connection`, which would call `getaddrinfo` again;
- sends `Host:` as the URL's authority (`host[:port]`, IPv6 in brackets) and refuses a
  caller-set `Host` header that names anything else (that would steer a shared front end at
  the pinned IP to another virtual host);
- for HTTPS, runs TLS over the pinned socket with `server_hostname=target.host`, so SNI
  carries the original name and the certificate is verified against that name. The default
  context is `ssl.create_default_context()` (CERT_REQUIRED, `check_hostname=True`) with ALPN
  `http/1.1`, built directly, so a process-wide
  `ssl._create_default_https_context = ssl._create_unverified_context` does not switch
  verification off. `context=` replaces it;
- raises `SsrfBlockedError` on 301/302/303/307/308, like `build_no_redirect_opener`
  (to follow redirects safely, use `pinned_urlopen(..., follow_redirects=N)`);
- with `deadline=` (a `time.monotonic()` value; default none), bounds every request made
  through it in total, exactly as `pinned_urlopen` does below, and `open(..., timeout=)`
  still caps each socket operation. Without `deadline=`, `timeout` is per operation, as in
  stock urllib;
- uses **no proxy**. `build_opener()` installs a `ProxyHandler` that reads `http_proxy`,
  `https_proxy` and `all_proxy` (upper or lower case), and a proxy resolves the name
  itself, past every IP check. This opener is assembled by hand without one. If you add a
  `ProxyHandler` to it yourself, requests are refused, not proxied;
- serves only the target's scheme, host and port. Any other http(s) URL raises
  `SsrfBlockedError`; file, ftp and data URLs raise `URLError` (no handler is installed).

The target is re-checked when the opener is built (addresses against the IP block, and
`canonical_url` against `host`/`port`), so a hand-built `PinnedTarget`, for example one
filled from your own resolver, gets the same policy. A target can be reused for several
requests and never resolves again.

**`pinned_urlopen(url, data=None, *, timeout=30.0, headers=None, method=None, context=None, follow_redirects=0)`**
is `resolve_and_validate` plus `build_pinned_opener` plus one request for
`target.canonical_url`. It raises `SsrfBlockedError` (guard refusal, refused redirect,
foreign `Host`), `urllib.error.HTTPError` (other 3xx, 4xx and 5xx), `urllib.error.URLError`
(no pinned address accepted the connection, TLS failure), or `DeadlineExceededError`.

**`timeout` is the total budget** (PR-02, gate G4; changed 2026-11-26, previously per
operation). One `time.monotonic()` deadline covers, in order:

| Phase (`DeadlineExceededError.phase`) | How it is bounded |
|---|---|
| `resolving the host name` | the one `getaddrinfo` call runs in a worker thread; the caller stops waiting at the deadline (see below) |
| `waiting for a resolver thread` | no worker slot freed up before the deadline |
| `connecting` | each attempt's socket timeout is what is **left**, so 12 blackholed A records cost one budget, not twelve |
| `in the TLS handshake` | the socket timeout set from what is left bounds the whole handshake (CPython 3.5+) |
| `sending the request` | re-armed from what is left before each 16 KiB, so a server that reads slowly cannot stretch it |
| `reading the response` | the head and **every read of the returned response** re-arm the socket timeout from what is left, and any read after the deadline is refused, buffered bytes included. A one-byte-per-second drip ends at the deadline |

So the deadline keeps running after `pinned_urlopen` returns: read the body within it.
`DeadlineExceededError` is both a `TimeoutError` and a `urllib.error.URLError`, so code
written for the old behaviour (`URLError` from a connect timeout, `TimeoutError` from a
read timeout) still catches it. `timeout=None` means no deadline and blocking sockets, as
before; anything else must be a positive, finite number (`ValueError`, or `TypeError` for
a non-number).

*Why a worker thread for DNS.* `getaddrinfo` cannot be interrupted, and the system resolver
applies its own retries (`resolv.conf` timeout x attempts x servers, 30 s or more by
default), so documenting the limit would have left the one unbounded phase in a call that
promises a bound. The TypeScript twin races `dns.lookup` against its deadline the same way.
The cost is a thread per call that cannot be stopped: an abandoned lookup finishes when
the system resolver gives up, and its answer is thrown away. At most 16 lookups run at
once, abandoned ones included. Past that a call fails closed with `DeadlineExceededError`
instead of starting more threads, so a stream of hanging names cannot exhaust threads.
With `timeout=None` the resolution runs inline, as before.

**`follow_redirects`** (gate G5; default `0`, which keeps refusing every
301/302/303/307/308 with `Redirect to '<Location>' blocked`). With `N` from 1 to 20:

- each hop goes through `resolve_and_validate` again (its own single resolution, every
  check, loopback names, port 0 and the rest) and a new opener pinned to that answer. A
  `Location` that names an internal address, rebinds to one, or uses another scheme is
  refused before any socket to it exists;
- `https` to `http` is refused (`Refusing redirect to ...: https to http downgrade`);
  `http` to `https` is allowed;
- on a hop to another origin (scheme, host or port differs), `Authorization`, `Cookie`,
  `Proxy-Authorization` and a caller-set `Host` are dropped; same-origin hops keep them;
- 307 and 308 repeat the method and body (the body must be `bytes`); 301, 302 and 303
  become a `GET` without a body, and the `Content-*` and `Transfer-Encoding` headers are
  dropped (a `HEAD` stays a `HEAD`, as in urllib);
- only 301/302/303/307/308 are followed: any other 3xx is an `HTTPError`, even with a
  `Location`;
- a redirect body is never read, and a 3xx without `Location`, or with an empty one, is an
  `HTTPError`; more than one `Location` header is refused
  (`Refusing redirect (status 302): 2 Location headers`), as browsers do;
- a non-ASCII `Location` is read as UTF-8 (as browsers and `fetch()` read it) and its path,
  query and fragment are percent-encoded, so `/café` is requested as `/caf%C3%A9`. The
  guard's character rule is applied first, so whitespace and control characters, ASCII or
  not, are still refused;
- hop N+1 raises `Redirect to '<Location>' blocked: more than N redirects`;
- every hop spends the same deadline; `resp.url` is the final canonical URL.

**`PinnedHTTPConnection` / `PinnedHTTPSConnection`** (in `agent_tool_sandbox.pinning`) are
the `http.client` classes underneath, for callers that use http.client directly:
`PinnedHTTPSConnection(target.host, target.port, addresses=target.addresses, timeout=10)`.
They re-check `addresses` (IP objects or strings) on construction and refuse `set_tunnel`.
Both take a keyword `deadline=None` (a `time.monotonic()` value) with the meaning above.

Why this design: the classes override `connect()` itself rather than the private
`HTTPConnection._create_connection` hook. If a future CPython renamed that hook, an override
of it would silently stop being called and connections would go back to resolving the name;
an overridden `connect()` always runs, and anything it no longer matches fails loudly.
`connect()` keeps the stdlib's `http.client.connect` audit event and `TCP_NODELAY`.

### `assert_inside_boundary(path_str, boundary, *, deny_roots=()) -> Path`

Returns the resolved absolute path, or raises `ValueError`. The steps run in this order:

Before any of these, and before any filesystem call, a `path_str` over 4096 UTF-8 bytes
(`PATH_MAX`) or with more than 256 components is rejected (`Path rejected: ...`), so a
huge path costs nothing; `assert_no_symlink` applies the same limits (allowing the root's
own components on top).

1. If the final component of `path_str` that names something starts with `.`, it is
   rejected (`Dotfile rejected`). Empty and `.` components are skipped first, so `.env/`,
   `.env/./` and `./sub/.secret//` are rejected like `.env`; `.`, `a/.` and `a/..` are
   rejected too.
2. `boundary / path_str` is resolved with `os.path.realpath`, so relative paths are anchored
   to the boundary rather than the CWD, and symlinks are followed. The result must be the
   boundary itself or lie under `realpath(boundary) + os.sep`; otherwise
   `Path traversal rejected`. This catches `../`, absolute paths, symlinks that escape,
   and sibling prefixes such as `ws-evil/`.
3. If the resolved path (other than the boundary itself) has a final component that starts
   with `.`, it is rejected (`Dotfile rejected`). This catches a symlink whose target is a
   dotfile or a dot-directory.
4. If the result is inside any of `deny_roots`, it is rejected (`Denied root`). Each deny
   root is resolved with `realpath`, so this works for roots inside the boundary too.

### `assert_no_symlink(path, *, operation="write", root=None) -> None`

Raises `ValueError` if `path` itself, or any of its ancestors up to `/`, is a symlink. Use
it on write **and read** paths and pass it the **unresolved** path. `operation` only
changes the message (`Symlink rejected on read: ...`); the default keeps the original
`... on write: ...` wording. A component that cannot be inspected (an `lstat` error such
as `EACCES`) fails closed with `Path not inspectable on <operation>: ...`.

Pass `root=<boundary>` (recommended; the examples below do). The components of the
unresolved path are then walked top-down, `..` is skipped, and a component is inspected
only if the directory it is looked up in resolves at or below `realpath(root)`:

- a symlinked **prefix** is accepted: an ancestor of the root (macOS `/tmp` ->
  `/private/tmp`, a symlinked home directory) or the root's own entry when the root is
  spelled through a symlink;
- a symlink **inside** the root is still rejected (`Symlink rejected` for the final
  component, `Symlink in path rejected` for a directory);
- nothing **outside** the root is inspected, so an out-of-boundary path never gets a
  symlink or "not inspectable" answer: its only refusal is `assert_inside_boundary`'s
  generic `Path traversal rejected: "<path>" resolves outside workspace boundary`. The
  only filesystem calls outside the root are those of the non-strict `os.path.realpath`.

`root=None` keeps the original walk up to `/`.

## Examples

```python
from agent_tool_sandbox import SsrfBlockedError, pinned_urlopen

def fetch(url: str) -> bytes:
    try:
        # guard + one resolution + pinned dial; 10 s in total, body read included
        with pinned_urlopen(url, timeout=10, follow_redirects=3) as resp:
            return resp.read(1_000_000)
    except SsrfBlockedError as exc:                     # refused URL or hop, foreign Host
        log.info("refused %s", exc.detail)              # the detail may name an address
        return f"refused: {exc}".encode()               # str(exc) is safe for the agent
    except TimeoutError:                                # DeadlineExceededError included
        return b"timed out"
```

The older, unpinned composition still works and is unchanged. It is exposed to DNS
rebinding (see the threat model):

```python
url = assert_safe_fetch_url(url)
with build_no_redirect_opener().open(url, timeout=10) as resp:
    body = resp.read(1_000_000)
```

```python
import os
import stat
from pathlib import Path
from agent_tool_sandbox import assert_inside_boundary, assert_no_symlink

ROOT = Path(os.path.realpath("/srv/agent/workspace"))   # pass a realpath'd root (see below)
DENY = [ROOT / "governance"]                             # e.g. files the agent must not touch

READ_FLAGS = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)

def read_tool(path_str: str) -> str:
    assert_no_symlink(ROOT / path_str, operation="read", root=ROOT)  # unresolved, first
    target = assert_inside_boundary(path_str, ROOT, deny_roots=DENY)
    fd = os.open(target, READ_FLAGS)        # no swapped-in final link; a FIFO cannot block
    try:
        st = os.fstat(fd)                   # judge what was opened, not the path
        if not stat.S_ISREG(st.st_mode) or st.st_size > 1_000_000:
            raise ValueError(f"Not a readable file: {path_str}")
        with open(fd, "rb", closefd=False) as fh:
            data = fh.read(1_000_001)       # bounded: the file may grow after fstat
        if len(data) > 1_000_000:
            raise ValueError(f"Not a readable file: {path_str}")
        return data.decode("utf-8")
    finally:
        os.close(fd)

def write_tool(path_str: str, text: str) -> None:
    assert_no_symlink(ROOT / path_str, root=ROOT)        # unresolved path, first
    target = assert_inside_boundary(path_str, ROOT, deny_roots=DENY)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)
```

## Threat model

### Covered

- **SSRF:** non-HTTP schemes, private and internal IP literals in every spelling the
  resolver accepts, names that resolve to internal addresses (if any A or AAAA record is
  internal, the URL is rejected), IPv4-mapped IPv6, IDNA tricks that normalise to
  internal names (fullwidth or circled `localhost`, `127。0。0。1`), names that fail to
  resolve or are IDNA-illegal (both rejected), redirects (with `build_no_redirect_opener`
  only), and URL spellings that HTTP clients split differently from `urlparse`: userinfo,
  percent-escapes in the host (`http://%31%32%37.0.0.1/` was once vetted as a name and
  connected to `127.0.0.1`), a second `:` (`http://a.x.tld:b.x.tld:80/`), a backslash
  (`http://169.254.169.254\@example.com/` reaches metadata through requests), and
  whitespace or control characters. `tests/test_connect_host.py` checks the returned URL
  against urllib, urllib3, httpx and yarl (each skipped if not installed).
- **DNS rebinding (time of check to time of use), with the pinning API only**
  (`pinned_urlopen`, `build_pinned_opener`, `PinnedHTTP(S)Connection`). The name is
  resolved once, every answer is checked, and the socket is connected to a checked address
  without a second lookup. A resolver that answers public-then-private cannot move the
  connection. `Host` and TLS SNI/verification still use the name. Environment proxies are
  not used.
- **Slow and stalling servers, with `pinned_urlopen` (or `deadline=`):** one total
  deadline bounds DNS, every connect attempt, TLS, sending, the head and the body, so a
  name with many blackholed A records, a slow-drip head or body, or a slow-reading server
  cannot hold a worker past `timeout`.
- **Redirects, with `pinned_urlopen(follow_redirects=N)`:** every hop is checked and
  pinned afresh, with no https-to-http downgrade, and credentials stay on their origin.
- **Loopback names** (`localhost`, `*.localhost`, trailing dots) are refused by name,
  whatever the resolver answers.
- **Error text as an oracle:** refusal messages do not name resolved addresses, read the
  same for "internal" and "does not resolve", and redact userinfo, query and fragment.
- **Filesystem:** `..` traversal, absolute paths outside the boundary, sibling-prefix
  confusion, symlinks that escape (followed by `realpath` before the comparison), denied
  sub-trees, dotfiles as the final component however spelled (`.env/`, `.env/./`), a
  symlink whose target is a dotfile, and, on read and write paths that call
  `assert_no_symlink`, a symlink as the target or as any ancestor.

### Not covered: the caller must handle these

- **DNS rebinding outside the pinning API.** `assert_safe_fetch_url` returns a *URL
  string*, and every client that fetches a string resolves the name **again** when it
  connects: `build_no_redirect_opener()`, plain `urllib`/`http.client`, and `requests`,
  httpx or aiohttp used directly with the canonical URL. Anyone who controls DNS for the
  host can answer with a public address for the check and an internal one for the connect.
  If the attacker can choose the hostname, use `pinned_urlopen` / `build_pinned_opener`, or
  pass `target.addresses` to your client's own pinning hook (no adapter for requests or
  httpx ships here), or fetch through an egress proxy that enforces the policy.
- **Fetching `raw_url` instead of the returned URL.** The parse-differential refusals
  protect callers that fetch either string, but only the returned canonical URL is
  checked against the clients' parsers. Fetch the return value. (`pinned_urlopen` always
  does.)
- **Clients that follow redirects.** Redirects are refused by
  `build_no_redirect_opener()` and the pinning API, and followed safely only by
  `pinned_urlopen(..., follow_redirects=N)`. `requests` and aiohttp follow redirects by
  default without re-validating, so a 302 to an internal address gets through.
- **Limits of `follow_redirects`.** There is no cookie jar (a `Set-Cookie` on a redirect is
  not replayed). The `Location` fragment is not inherited (fragments are never sent).
  Headers other than `Authorization`, `Cookie`, `Proxy-Authorization` and `Host` are kept
  across origins, so a custom credential header (`X-Api-Key`) follows a cross-origin hop
  unless you leave redirects off. A 307/308 replays only a `bytes` body.
- **Proxies.** `build_no_redirect_opener()` uses `build_opener`, which installs a
  `ProxyHandler` if `http_proxy`, `https_proxy` or `all_proxy` is set. The guard checks the
  target, and the proxy then resolves the name itself. The pinning API uses no proxy, so a
  deployment that *must* egress through a proxy cannot use it as is.
- **Limits of pinning.** It pins the TCP destination, nothing more:
  - The total deadline belongs to `pinned_urlopen` and to openers built with `deadline=`.
    `build_pinned_opener(target)` without it, and the connection classes without it, keep
    urllib's per-operation `timeout`: each connect attempt and each read gets the full
    `timeout`, so N blackholed addresses cost N timeouts and a slow drip is unbounded.
    Code that builds its own opener should pass `deadline=time.monotonic() + budget`.
  - An abandoned DNS lookup keeps its worker thread until the system resolver gives up
    (up to 16 such threads; then calls fail closed until one ends). A resolver hook that
    never returns holds its slot for good.
  - Within the deadline, addresses are tried in resolver order and the first one that
    hangs can spend the whole budget. There is no Happy Eyeballs and no per-family cap,
    so a reachable second address may never be tried.
  - The deadline is checked between operations. A read can block for at most what was
    left when it started, so the overshoot is bounded by scheduling, not by the server.
  - A pinned address is trusted for as long as you keep the `PinnedTarget`; DNS TTLs are
    ignored. That is safe, but a long-lived target can go stale.
  - A public address that forwards traffic (an open proxy, a cloud load balancer that
    routes on `Host` or SNI) still reaches whatever it forwards to. The `Host` override refusal closes only the caller-set-header case.
  - `context=` is trusted as given: a context with `check_hostname=False` or `CERT_NONE`
    keeps the pin (the SSRF protection does not depend on TLS) but loses certificate
    verification. For an IP-literal HTTPS URL no SNI is sent, and the certificate must
    carry that IP.
  - The pinned opener answers one request per connection (`Connection: close`, as urllib
    always does) and cannot be pointed at a second host; build one per target.
- **No port policy beyond refusing port 0, no host allowlist, no HTTPS requirement.**
  `http://public-host:25/` passes. Response size and content type are also the caller's
  job, and so are timeouts outside `pinned_urlopen` / `deadline=`.
- **What the messages still reveal.** `str(exc)` no longer names resolved addresses, but:
  - the time a refusal takes still differs between a fast NXDOMAIN, a slow resolver and
    a cached answer;
  - a refused URL (internal name) and an accepted one that then fails to connect are still
    told apart by the exception type;
  - `exc.detail` and `exc.blocked_address` hold the address on purpose: log them, do not
    return them to the model;
  - redaction covers userinfo, query and fragment only, so a secret in the path
    (`/reset/<token>`) is quoted as is.
- **The TypeScript twin decides names its own way.** It refuses `localhost`,
  `ip6-localhost` and `ip6-loopback` by name too; see `../vectors/DIFFERENCES.md` for any
  vector on which the two languages still differ.
- **The address table is data, not the interpreter's.** Every range comes from
  `_blocklist_data.py`, generated from `../policy/blocklist.v1.json` (the table the TS
  package reads too; see `../policy/README.md`). No `ipaddress.is_*` property is consulted.
  The table reproduces the `ipaddress` tables of CPython 3.10.22, 3.11.17, 3.12.13 and
  3.14.9 (identical, with the 2024 `is_private` fix). On an older unpatched patch release,
  whose tables differ (for example in the `192.0.0.0/24` sub-ranges, `2002::/16` and how
  IPv4-mapped IPv6 delegates), the guard now gives the table's verdicts, not the
  interpreter's.
- **Resolver entries that cannot be parsed are skipped.** If `getaddrinfo` returns an
  entry that `ipaddress` cannot parse, the guard ignores it rather than failing. The URL
  is still rejected when *no* entry parses.
- **Filesystem time of check to time of use.** Both jail functions check paths. They do
  not open files. A symlink swapped in after the check is followed unless you open with
  `O_NOFOLLOW` (as in the read example), and that protects only the final component; add
  `O_NONBLOCK` and `fstat` the descriptor so a FIFO or directory swapped in is refused
  instead of blocking or being read. If the agent can race your file operations on
  directories, use `openat`-style descriptor walking (`os.open(name, O_NOFOLLOW |
  O_DIRECTORY, dir_fd=...)` for each directory below the root), as the reference read
  tool does.
- **Dot-directories are allowed.** The dotfile rule covers only the final component, so
  `.git/config`, `.git/hooks/pre-commit` and `.vscode/tasks.json` are accepted. On a write
  path that can mean code execution on the host. If that matters, use `deny_roots`.
- **`assert_no_symlink` without `root=` walks to `/`.** Then, if the root sits under a
  symlinked directory (macOS `/tmp` and `/var`, for example), every path is rejected, and
  an out-of-boundary path is answered with facts about the filesystem outside the root
  (a symlink, or "not inspectable"). Pass `root=`; without it, pass a root that has
  already been through `realpath`.
- **Case-insensitive filesystems.** `deny_roots` matching is a string-prefix comparison
  after `realpath`, and `realpath` does not canonicalise case. On a case-insensitive
  volume, `STATE/x` gets past a deny root of `state`. The boundary check itself fails
  closed in that case.
- **Hard links** to files outside the boundary cannot be detected.
- **Windows** (drive letters, junctions, alternate data streams) has not been tested.

## Divergences from the reference sources

These are also recorded in `PROVENANCE.json` and asserted in `tests/test_parity_in_tree.py`:

1. **CGNAT is blocked.** `_ip_is_blocked` blocks `100.64.0.0/10` (RFC 6598). This is the
   reference repo's open, unmerged PR #630 applied verbatim. It is one of three differences
   in *decisions* at equivalent configuration (items 5 and 6 are the others).
2. **Deny roots come from the caller.** The reference jail reads OpenClaw environment
   variables (`workspace_root()`, `file_write_root()`) and hardcodes `~/.openclaw` as a
   denied root (`_openclaw_home()`). All three are removed. The boundary is always passed
   in, and the hardcoded deny root became the keyword-only `deny_roots=()`. With
   `deny_roots=[Path.home() / ".openclaw"]` every decision matches the reference; with
   the default, nothing is denied beyond the boundary. The deny message is now
   `Denied root: ...` instead of `OpenClaw workspace denied: ...`.
3. Docstrings and comments are generic. They drop product names and ticket numbers. The
   other error messages are byte-identical.
4. **Connection pinning exists only here** (added 2026-11-26). `pinning.py` and
   `tests/test_pinning.py` have no in-tree counterpart. In `ssrf_guard.py` the body of
   `assert_safe_fetch_url` moved into a private `_validate_fetch_url`, which also returns
   the scheme, host, port and the addresses of its one resolution;
   `assert_safe_fetch_url` returns that helper's canonical URL. Decisions and messages are
   unchanged, which the parity corpus and `test_refusal_messages_are_identical` assert.
5. **The Azure WireServer address is blocked** (staged only, 2026-11-26). `_ip_is_blocked`
   blocks `168.63.129.16` by name (`_METADATA_IPS`, IPv4 only like CGNAT; callers unwrap
   IPv4-mapped answers first). The reference guard allows it.
6. **Port 0 is refused** (staged only, 2026-11-26), with `Refusing URL with port 0: ports
   must be 1-65535`, before any resolution. The reference guard returns the URL.

Items 5 and 6 came from the shared vector corpus (`../vectors/DIFFERENCES.md`). Of the 68
python/TS differences listed there, 17 are resolved (groups g6 6to4, g7 Teredo and g11
site-local), all by the TS package now blocking what this package already blocked, so no
Python verdict changed for them. The two vectors both languages used to allow,
`meta-azure-wireserver` and `port-zero`, now block in both: those are the only Python
verdicts that changed then. 51 differences remained; item 9 below resolves one more
(`loc-localhost-lying-resolver`, group g13), so 50 remain for the owner's strictest-wins
decision.
Regression tests: `tests/test_wireserver_port_zero.py`.

7. **Total deadline** (staged only, 2026-11-26, PR-02 / G4). `pinned_urlopen`'s
   `timeout` is a total budget, `DeadlineExceededError` is new, and `build_pinned_opener`
   and the connection classes take `deadline=`. Tests: `tests/test_deadline.py`.
8. **Refusal messages** (staged only, 2026-11-26, PR-03). A refusal decided by the DNS
   answer reads `Refusing hostname '<host>': not an allowed destination`. The reference
   message moved to `exc.detail`, which the parity corpus compares; the generic text is
   asserted on its own (`test_refusal_message_divergence`). Tests:
   `tests/test_refusal_disclosure.py`.
9. **Loopback names and redaction** (staged only, 2026-11-26, G7). Loopback names are
   refused before DNS; the reference refuses them only through a loopback answer (same
   decision in the parity corpus, different message: `LOOPBACK_NAME_URLS`). URLs in
   messages are redacted. One corpus verdict changed: `loc-localhost-lying-resolver`,
   python allow to block, which now equals the TS verdict. Tests:
   `tests/test_localhost_and_redaction.py`.
10. **Opt-in redirects** (staged only, 2026-11-26, G5). `pinned_urlopen(follow_redirects=N)`;
    the default 0 is unchanged. Tests: `tests/test_redirects.py`. Three fixes the shared
    redirect corpus (`../vectors/redirect-vectors.json`) found: a non-ASCII `Location` no
    longer lets `UnicodeEncodeError` escape (it is read as UTF-8 and percent-encoded), more
    than one `Location` is refused, and an empty `Location` is an `HTTPError` at once
    instead of a loop to the hop cap.
11. **Data-driven block list** (staged only, 2026-11-26, G3 preparation; no decision
    change). `_ip_is_blocked` and `_is_loopback_name` read the generated
    `_blocklist_data.py` instead of `ipaddress.is_*`, the CGNAT network, `_METADATA_IPS`
    and `_LOOPBACK_NAMES` (those three constants are gone). `_resolve_host_ips` unwraps
    IPv4-mapped answers while the table says so (`UNWRAP_IPV4_MAPPED`, true today). Every
    shared-corpus verdict and message is unchanged, and so is every parity-corpus
    decision. Tests: `tests/test_blocklist_data.py` (drift: the generated module must
    equal a fresh render of the JSON).

12. **Caller IRIs** (staged only, 2026-11-26). A non-ASCII path, query or fragment in the
    URL the caller passes is percent-encoded as UTF-8 before validation, as the redirect
    path already did for a non-ASCII `Location`, so `assert_safe_fetch_url` returns an
    ASCII URL and `pinned_urlopen` no longer lets `UnicodeEncodeError` escape. The
    reference returns them unchanged (same decision, different URL: `IRI_DIVERGENT_URLS`
    in the parity test). No shared-corpus verdict changed. Tests: `tests/test_caller_iri.py`.

The 2026-11-26 fixes (the dotfile rule, the read-path symlink gate, and the checked-host
vs connected-host refusals with the canonical return value) were applied to both sides
identically, so they are not divergences; the parity corpus covers them.

## Tests

```bash
PYTHONPATH=src python3 -m pytest tests -q -p no:cacheprovider
```

The tests do not use the network. `conftest.py` swaps `socket.getaddrinfo` for a fake
resolver: IP literals still go through the real libc parser, called with `AI_NUMERICHOST`,
which never performs a lookup, and names are answered from an in-memory table. It also
makes every socket `connect` raise. `hypothesis` is optional; without it the property tests
are left out.

`tests/test_pinning.py` swaps `socket.socket` for a fake that records the address each
socket connects to and every byte sent, then answers with a canned HTTP response. The real
urllib and http.client code therefore runs end to end, including request serialisation,
response parsing and the redirect and error handlers. For HTTPS it also swaps
`ssl.SSLContext.wrap_socket` to capture the context and `server_hostname`. The rebinding
tests install a resolver that answers `93.184.216.34` on the first call and `127.0.0.1` on
every later call. The pinned fetch must connect to `93.184.216.34` with exactly one
resolver call. A control test runs the unpinned `build_no_redirect_opener` composition
under the same resolver and shows that it lands on `127.0.0.1`, which proves the harness
would catch a client that resolves again.

`tests/test_deadline.py` uses a fake socket for blackholed connects (12 A records) and for a
slow-reading server, a resolver that hangs, and a **real listener on 127.0.0.1** for the
slow-drip head and body. Those few tests allow loopback for themselves only. Run the suite
under `../../tools/offline.sh`, which leaves only loopback reachable. `tests/test_redirects.py`
serves a canned response per connection and records every hop's target and request.

`tests/test_parity_in_tree.py` adds the reference repository's `src/` to the path,
four directory levels up or at `$AGENT_TOOL_SANDBOX_REFERENCE_SRC`. It then checks that
both implementations reach the same decision, with the same message, for a corpus of URLs,
resolver answers, IPs (explicit vectors plus a Hypothesis property) and filesystem paths
(traversal, absolute paths, and symlinks in a temporary tree). When the reference sources
cannot be imported, the whole module **skips**, so the package can be lifted out as is.

`tests/test_property_*.py` are Hypothesis properties over generated inputs (skipped without
`hypothesis`). They are deterministic in CI: `derandomize=True`, no example database, and no
per-example deadline (the example counts bound the runtime, about 4,000 examples in 11 s).
`ATS_PROPERTY_SCALE=N` multiplies every `max_examples` for a deeper local run.

- `test_property_url_guard.py`: URLs with mixed-case and foreign schemes, IDNA and unicode
  hosts, IP literals in every spelling, userinfo, edge ports, `%`, `\`, extra `:`, brackets,
  whitespace and control characters, and non-ASCII paths, under a resolver that answers
  every name with a public address. An accepted URL's canonical form must agree with the
  validated scheme, host and port under `urllib.request.Request`, under the `(host, port)` a
  stock urllib opener passes to `socket.create_connection`, and under `urlsplit`. The
  resolver must have been asked for that host, and the canonical URL must validate to
  itself. A refusal is always `SsrfBlockedError`. A clean population must be accepted in
  an independently written canonical form.
- `test_property_blocklist.py`: rebuilds the block list from `../policy/blocklist.v1.json`
  with `ipaddress.ip_network` and the rules in `../policy/README.md`, then compares it with
  `_ip_is_blocked`, with the guard (DNS answer and URL literal) and with
  `_is_loopback_name`. Inputs are random addresses, each CIDR's first and last address
  and their neighbours, and every IPv4 edge embedded as mapped, NAT64, compatible,
  translated, local-use NAT64, 6to4 and Teredo (the edge set is also checked exhaustively).
- `test_property_pinning.py`: multi-answer DNS (public and blocked IPv4/IPv6, mapped,
  duplicates), refused connects, and 1 to 3 redirect hops, on the `tests/test_pinning.py`
  socket seam. If any answer is blocked, `pinned_urlopen` must refuse before a socket
  exists. Otherwise it must dial only the vetted addresses, in resolver order, and resolve
  each hop exactly once.
- `test_property_boundary.py`: paths over a tree of hostile symlinks (escapes, loops, a
  sibling with the root's name as a prefix, links to dotfiles). The result must equal
  `os.path.realpath`, lie inside the root by `os.path.commonpath`, and break no dotfile
  or deny-root rule. A rejection must be a `ValueError`.
