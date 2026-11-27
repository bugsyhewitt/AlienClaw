# agent-tool-sandbox (Python)

Two small, stdlib-only guards for tools that an LLM agent can call:

- **SSRF guard** (`ssrf_guard`): decides whether a URL may be fetched, and builds a
  `urllib` opener that refuses redirects.
- **Connection pinning** (`pinning`): resolves the host once, through the same guard, and
  fetches over a connection that dials only the addresses that passed. This is the
  DNS-rebinding fix; use it whenever the agent can choose the hostname.
- **Filesystem jail** (`boundary`): decides whether a path the agent supplied stays inside
  a directory you choose, and refuses symlinks on write paths.

Status: staging copy, version `0.0.0.dev0`, not published or built. It was lifted from a
larger project's tool layer and keeps that code's behaviour, with the differences listed
under [Divergences](#divergences-from-the-reference-sources).

License: MIT, the same as the source repository ("Copyright (c) 2026 Bugsy Hewitt"). The
license for an open-source release has **not been decided yet**; that is Bugsy's call.

Requires Python 3.10 or later and has no runtime dependencies.

## API

```python
from agent_tool_sandbox import (
    SsrfBlockedError,          # subclass of ValueError
    assert_safe_fetch_url,     # (raw_url: str) -> str
    build_no_redirect_opener,  # () -> urllib.request.OpenerDirector
    resolve_and_validate,      # (url: str) -> PinnedTarget
    PinnedTarget,              # frozen dataclass: scheme, host, port, canonical_url, addresses
    build_pinned_opener,       # (target, *, context=None) -> urllib.request.OpenerDirector
    pinned_urlopen,            # (url, data=None, *, timeout=30.0, headers=None, method=None,
                               #  context=None) -> http.client.HTTPResponse
    assert_inside_boundary,    # (path_str, boundary: Path, *, deny_roots=()) -> Path
    assert_no_symlink,         # (path: Path, *, operation="write") -> None
)
from agent_tool_sandbox.pinning import PinnedHTTPConnection, PinnedHTTPSConnection
```

### `assert_safe_fetch_url(raw_url) -> str`

Returns a **canonical URL** if `raw_url` passes, and raises `SsrfBlockedError` otherwise.
The canonical URL is rebuilt from the validated parts: lower-case scheme and host, the
host IDNA-encoded to ASCII, the port only if one was given (normalised, so `:080` becomes
`:80` and an empty `:` is dropped), no userinfo, and the path, query and fragment as
parsed. **Fetch the returned URL, not `raw_url`:** it is the only string whose host has
been checked against what urllib, urllib3, httpx and yarl will connect to. It rejects a
URL when:

- it contains a backslash, whitespace or a non-printable character anywhere (urlsplit
  silently drops tab/CR/LF that urllib keeps, and WHATWG parsers such as urllib3, and
  therefore requests, end the authority at `\`);
- the scheme is not `http` or `https`, or the URL has no hostname, or `urlparse` fails;
- the authority has userinfo (any `@`), a `%`, brackets anywhere but around an IPv6
  literal, or more than one `:` outside brackets (urlparse splits the port at the first
  `:`, http.client at the last);
- the port is not a number in 0-65535;
- the host urllib would connect to (`Request(url).host` as split by http.client, compared
  as a `(host, port)` pair) differs from the checked one, for `raw_url` and again for the
  canonical URL;
- after IDNA the host name uses a character outside `[a-z0-9._-]`;
- the hostname cannot be resolved (including IDNA encoding errors);
- **any** address the hostname resolves to is loopback, private (RFC 1918, ULA and the
  rest of the stdlib's private list), link-local (which covers `169.254.169.254`
  metadata), multicast, reserved, unspecified, CGNAT `100.64.0.0/10`, or IPv6 site-local
  `fec0::/10`. IPv4-mapped IPv6 answers (`::ffff:a.b.c.d`) are unwrapped before the check.

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
- raises `SsrfBlockedError` on 301/302/303/307/308, like `build_no_redirect_opener`;
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

**`pinned_urlopen(url, data=None, *, timeout=30.0, headers=None, method=None, context=None)`**
is `resolve_and_validate` plus `build_pinned_opener` plus one request for
`target.canonical_url`. `timeout` is passed to every socket operation (each connect
attempt, each read); it is not a deadline for the whole request. It raises
`SsrfBlockedError` (guard refusal, redirect, foreign `Host`), `urllib.error.HTTPError`
(other 3xx, 4xx and 5xx), or `urllib.error.URLError` (no pinned address accepted the
connection, TLS failure).

**`PinnedHTTPConnection` / `PinnedHTTPSConnection`** (in `agent_tool_sandbox.pinning`) are
the `http.client` classes underneath, for callers that use http.client directly:
`PinnedHTTPSConnection(target.host, target.port, addresses=target.addresses, timeout=10)`.
They re-check `addresses` (IP objects or strings) on construction and refuse `set_tunnel`.

Why this design: the classes override `connect()` itself rather than the private
`HTTPConnection._create_connection` hook. If a future CPython renamed that hook, an override
of it would silently stop being called and connections would go back to resolving the name;
an overridden `connect()` always runs, and anything it no longer matches fails loudly.
`connect()` keeps the stdlib's `http.client.connect` audit event and `TCP_NODELAY`.

### `assert_inside_boundary(path_str, boundary, *, deny_roots=()) -> Path`

Returns the resolved absolute path, or raises `ValueError`. The steps run in this order:

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

### `assert_no_symlink(path, *, operation="write") -> None`

Raises `ValueError` if `path` itself, or any of its ancestors up to `/`, is a symlink. Use
it on write **and read** paths and pass it the **unresolved** path. `operation` only
changes the message (`Symlink rejected on read: ...`); the default keeps the original
`... on write: ...` wording.

## Examples

```python
from agent_tool_sandbox import SsrfBlockedError, pinned_urlopen

def fetch(url: str) -> bytes:
    try:
        with pinned_urlopen(url, timeout=10) as resp:   # guard + one resolution + pinned dial
            return resp.read(1_000_000)
    except SsrfBlockedError as exc:                     # refused URL, redirect, foreign Host
        return f"refused: {exc}".encode()
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
from pathlib import Path
from agent_tool_sandbox import assert_inside_boundary, assert_no_symlink

ROOT = Path(os.path.realpath("/srv/agent/workspace"))   # pass a realpath'd root (see below)
DENY = [ROOT / "governance"]                             # e.g. files the agent must not touch

def read_tool(path_str: str) -> str:
    assert_no_symlink(ROOT / path_str, operation="read")  # unresolved path, first
    target = assert_inside_boundary(path_str, ROOT, deny_roots=DENY)
    fd = os.open(target, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))  # no swapped-in link
    with open(fd, encoding="utf-8") as fh:
        return fh.read()

def write_tool(path_str: str, text: str) -> None:
    assert_no_symlink(ROOT / path_str)                   # unresolved path, first
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
- **Clients that follow redirects.** Redirects are refused only by
  `build_no_redirect_opener()` and the pinning API. `requests` and aiohttp follow redirects
  by default without re-validating, so a 302 to an internal address gets through. To follow
  a redirect deliberately, call `pinned_urlopen` again on the `Location` URL, which checks
  and pins it afresh; nothing here does that for you.
- **Proxies.** `build_no_redirect_opener()` uses `build_opener`, which installs a
  `ProxyHandler` if `http_proxy`, `https_proxy` or `all_proxy` is set. The guard checks the
  target, and the proxy then resolves the name itself. The pinning API uses no proxy, so a
  deployment that *must* egress through a proxy cannot use it as is.
- **Limits of pinning.** It pins the TCP destination, nothing more:
  - The one resolution is a plain `getaddrinfo` call with no timeout of its own (the
    system resolver's settings apply), and `timeout=` applies per socket operation and per
    connect attempt, so a dual-stack host whose first address hangs costs one `timeout`
    per address. There is no Happy Eyeballs.
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
- **No port policy, no host allowlist, no HTTPS requirement.** `http://public-host:25/`
  passes. Response size, timeouts and content type are also the caller's job.
- **The address tables belong to the interpreter.** The classification comes from
  `ipaddress` (`is_private`, `is_reserved` and so on), and those tables changed in
  CPython 3.12.4 and 3.13, for example in the `192.0.0.0/24` sub-ranges, `2002::/16`, and
  how IPv4-mapped IPv6 delegates. Edge ranges can therefore be decided differently on
  different patch releases. On 3.14, NAT64 `64:ff9b::/96`, 6to4 `2002::/16` and
  IPv4-compatible `::a.b.c.d` were observed as blocked.
- **Resolver entries that cannot be parsed are skipped.** If `getaddrinfo` returns an
  entry that `ipaddress` cannot parse, the guard ignores it rather than failing. The URL
  is still rejected when *no* entry parses.
- **Filesystem time of check to time of use.** Both jail functions check paths. They do
  not open files. A symlink swapped in after the check is followed unless you open with
  `O_NOFOLLOW` (as in the read example), and that protects only the final component. If
  the agent can race your file operations on directories, use `openat`-style descriptor
  walking.
- **Dot-directories are allowed.** The dotfile rule covers only the final component, so
  `.git/config`, `.git/hooks/pre-commit` and `.vscode/tasks.json` are accepted. On a write
  path that can mean code execution on the host. If that matters, use `deny_roots`.
- **`assert_no_symlink` walks to `/`.** If the root sits under a symlinked directory
  (macOS `/tmp` and `/var`, for example), every write is rejected. Pass a root that has
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
   reference repo's open, unmerged PR #630 applied verbatim. It is the only difference in
   *decisions* at equivalent configuration.
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

`tests/test_parity_in_tree.py` adds the reference repository's `src/` to the path,
four directory levels up or at `$AGENT_TOOL_SANDBOX_REFERENCE_SRC`. It then checks that
both implementations reach the same decision, with the same message, for a corpus of URLs,
resolver answers, IPs (explicit vectors plus a Hypothesis property) and filesystem paths
(traversal, absolute paths, and symlinks in a temporary tree). When the reference sources
cannot be imported, the whole module **skips**, so the package can be lifted out as is.
