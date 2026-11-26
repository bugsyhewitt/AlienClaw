# agent-tool-sandbox (Python)

Two small, stdlib-only guards for tools that an LLM agent can call:

- **SSRF guard** (`ssrf_guard`): decides whether a URL may be fetched, and builds a
  `urllib` opener that refuses redirects.
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
    assert_inside_boundary,    # (path_str, boundary: Path, *, deny_roots=()) -> Path
    assert_no_symlink,         # (path: Path) -> None
)
```

### `assert_safe_fetch_url(raw_url) -> str`

Returns `raw_url` unchanged if it passes, and raises `SsrfBlockedError` otherwise. It
rejects a URL when:

- the scheme is not `http` or `https`, or the URL has no hostname, or `urlparse` fails;
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
urllib never follows them.

### `assert_inside_boundary(path_str, boundary, *, deny_roots=()) -> Path`

Returns the resolved absolute path, or raises `ValueError`. The steps run in this order:

1. If the final component of `path_str` starts with `.`, it is rejected (`Dotfile rejected`).
2. `boundary / path_str` is resolved with `os.path.realpath`, so relative paths are anchored
   to the boundary rather than the CWD, and symlinks are followed. The result must be the
   boundary itself or lie under `realpath(boundary) + os.sep`; otherwise
   `Path traversal rejected`. This catches `../`, absolute paths, symlinks that escape,
   and sibling prefixes such as `ws-evil/`.
3. If the result is inside any of `deny_roots`, it is rejected (`Denied root`). Each deny
   root is resolved with `realpath`, so this works for roots inside the boundary too.

### `assert_no_symlink(path) -> None`

Raises `ValueError` if `path` itself, or any of its ancestors up to `/`, is a symlink. Use
it on write paths and pass it the **unresolved** path.

## Examples

```python
import urllib.request
from agent_tool_sandbox import SsrfBlockedError, assert_safe_fetch_url, build_no_redirect_opener

def fetch(url: str) -> bytes:
    try:
        url = assert_safe_fetch_url(url)
    except SsrfBlockedError as exc:
        return f"refused: {exc}".encode()
    opener = build_no_redirect_opener()
    with opener.open(urllib.request.Request(url), timeout=10) as resp:
        return resp.read(1_000_000)
```

```python
import os
from pathlib import Path
from agent_tool_sandbox import assert_inside_boundary, assert_no_symlink

ROOT = Path(os.path.realpath("/srv/agent/workspace"))   # pass a realpath'd root (see below)
DENY = [ROOT / "governance"]                             # e.g. files the agent must not touch

def read_tool(path_str: str) -> str:
    return assert_inside_boundary(path_str, ROOT, deny_roots=DENY).read_text()

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
  resolve or are IDNA-illegal (both rejected), and redirects.
- **Filesystem:** `..` traversal, absolute paths outside the boundary, sibling-prefix
  confusion, symlinks that escape (followed by `realpath` before the comparison), denied
  sub-trees, dotfiles as the final component, and, on write paths, a symlink as the target
  or as any ancestor.

### Not covered: the caller must handle these

- **DNS rebinding (time of check to time of use).** The guard resolves the name, checks
  the addresses, and then returns the *URL string*. urllib resolves the name **again**
  when it connects. Anyone who controls DNS for the host can answer with a public address
  for the check and an internal one for the connect. Nothing pins the connection to the
  vetted IP. If the attacker can choose the hostname, the fix is to connect to the checked
  IP yourself (and send the original `Host` / SNI), or to fetch through an egress proxy
  that enforces the policy.
- **The checked host differs from the connected host.** The guard checks
  `urlparse(url).hostname`. urllib connects to `Request(url).host`, which keeps the
  userinfo and percent-decodes it. For example:
  - `http://a%2ex.attacker.tld/` is checked as `a%2ex.attacker.tld` but connected as
    `a.x.attacker.tld`;
  - `http://evil@x.attacker.tld/` is checked as `x.attacker.tld` but connected as
    `evil@x.attacker.tld`.

  An attacker who controls a DNS zone gets the same result as rebinding, but without a
  race and without fighting DNS caches. When no DNS is under attacker control these
  inputs fail closed, either as an unresolvable name or as an `InvalidURL` from
  `http.client`. `tests/test_http_get_ssrf.py::test_connect_host_matches_checked_host`
  records this as a strict xfail.
- **Proxies.** When the opener is built, `build_opener` installs a `ProxyHandler` if
  `http_proxy` or `https_proxy` is set. The guard checks the target, and the proxy then
  resolves the name itself.
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
  not open files. A symlink swapped in after the check is followed. The read path does not
  call `assert_no_symlink` at all. If the agent can race your file operations, use
  `O_NOFOLLOW` or `openat`-style descriptor walking.
- **Gaps in the dotfile rule.** The rule looks only at `os.path.basename(path_str)`, before
  resolution. As a result:
  - `.env/` (the basename is empty) resolves to `<root>/.env` and is **accepted**, for
    reads and for writes. A strict xfail test records this.
  - Dot-directories are allowed: `.git/config` is accepted.
  - A symlink that points at a dotfile inside the boundary is accepted.

  If dotfiles matter to you, use `deny_roots`, or check the resolved path yourself.
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
3. Docstrings and comments are generic. They drop product names and ticket numbers, and
   one inaccurate "returns the canonical URL" became "returns the URL unchanged". The
   other error messages are byte-identical.

## Tests

```bash
PYTHONPATH=src python3 -m pytest tests -q -p no:cacheprovider
```

The tests do not use the network. `conftest.py` swaps `socket.getaddrinfo` for a fake
resolver: IP literals still go through the real libc parser, called with `AI_NUMERICHOST`,
which never performs a lookup, and names are answered from an in-memory table. It also
makes every socket `connect` raise. `hypothesis` is optional; without it the property tests
are left out.

`tests/test_parity_in_tree.py` adds the reference repository's `src/` to the path,
four directory levels up or at `$AGENT_TOOL_SANDBOX_REFERENCE_SRC`. It then checks that
both implementations reach the same decision, with the same message, for a corpus of URLs,
resolver answers, IPs (explicit vectors plus a Hypothesis property) and filesystem paths
(traversal, absolute paths, and symlinks in a temporary tree). When the reference sources
cannot be imported, the whole module **skips**, so the package can be lifted out as is.
