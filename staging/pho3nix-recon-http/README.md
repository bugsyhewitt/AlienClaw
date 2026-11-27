# pho3nix-recon-http (staged)

AlienClaw's four recon request tools, copied out of `src/alienclaw/tools/` so they
can later move to Pho3nix: `http_get`, `url_fetch`, `web_search` and `search_text`.
The two fetch tools use the SSRF guard from
[`agent-tool-sandbox`](../agent-tool-sandbox/python/README.md) instead of the
in-tree `_ssrf_guard` module. Nothing here imports `alienclaw`.

Status: **staged only**. Nothing consumes this package yet, the in-tree tools are
unchanged, and Pho3nix has not been touched. Moving it to Pho3nix waits on the
owner's go.

Behavior matches the in-tree tools except for these deliberate differences, each
asserted on its own by `tests/test_parity_in_tree.py`, which runs the same mocked
inputs through both sides:

- CGNAT `100.64.0.0/10` is refused (inherited from agent_tool_sandbox).
- http_get and url_fetch use **DNS pinning**: one resolution, a connection only to
  the vetted addresses, no environment proxy, and a `Host` header must name the
  URL's own host (below).
- search_text **works off the main thread** (below).
- A bad input type (`{"field_count": "x"}`, a list as `text`, a string as
  `headers`) returns `ok=False` with an `Invalid ...` error instead of raising, in
  http_get, url_fetch and search_text.

`PROVENANCE.json` records the source blob of every file and lists each divergence.

## Layout

```
pyproject.toml                  name pho3nix-recon-http, depends on agent-tool-sandbox (declared only)
src/pho3nix_recon_http/
  __init__.py                   TOOL_REGISTRY (the 4 tools), RunResult, RunnerFn
  http_get.py  url_fetch.py     SSRF-guarded, DNS-pinned fetch tools
  web_search.py                 JSON search backend client (operator-configured URL)
  search_text.py                literal / glob / regex line search with a ReDoS guard
  _scan.py                      search_text's compile + scan (also its child-process script)
  _inputs.py                    input type checks (Invalid ... errors)
  limits.py  types.py           10 MiB I/O cap, RunResult dataclass
tests/                          network-free suite (see "Tests")
PROVENANCE.json                 source blobs, divergences, new files
```

## Tools

Every tool is `run(inputs: dict, params: dict = {}) -> RunResult`. `RunResult` has
`ok`, `output`, `error`, `tool_calls` (the number of requests or scans made,
retries included) and `correctness` (1.0 on success, 0.0 on failure,
web_search 0.5 for an empty result).

| Tool | Inputs | Params (clamped) | Output |
|---|---|---|---|
| `http_get` | `url`, `headers` | `max_attempts` 1-5 (1), `request_count` 1-5 (1), `field_count` 1-5 (3), `body_preview` 1-10 (5) | `url` (the caller's input), `statusCode`, `content`, `bytesReturned`, `contentType` (by field_count), always `fetched_url` (the canonical URL requested), `truncated` and `body_preview` |
| `url_fetch` | `url`, `method` (GET), `headers`, `body` (sent as `str(body)`) | `max_attempts`, `request_count`, `field_count` as above, `content_preview` 1-10 (2) | `url`, `statusCode`, `content`, `contentLength`, `contentType` (by field_count), always `fetched_url` and `preview` |
| `web_search` | `query` (or `task`), `num_results` | `max_attempts` 1-5, `max_results` 1-10 (5), `page_count` 1-3 (1) | `query`, `result_count`, `results` [{title, url, snippet}] deduplicated by URL, `pages_fetched` |
| `search_text` | `text` (or `content`), `pattern` (or `query`), `flavor` literal/glob/regex, `regex` (alias), `case_sensitive` | `max_results` >=1 (100), `context_lines` 1-10 (1) | `pattern`, `flavor`, `caseSensitive`, `totalMatches`, `truncated`, `matches` [{matchText, lineNumber, startOffset, endOffset, contextBefore, contextAfter}] |

Response caps: http_get reads at most 1 MiB (and sets `truncated` when the server
announces a larger `Content-Length`), and url_fetch reads at most 2 MiB. Each
request has a 30 s timeout (20 s for web_search). search_text refuses text over
10 MiB and patterns over 200 characters.

Params are clamped to the ranges shown. A value `int()` refuses (`"x"`, `None`,
`"1.5"`, a list) returns `ok=False` with `Invalid param '<name>': expected an
integer, got ...` (web_search excepted, see Known gaps).

Retries: an HTTP status of 4xx or 5xx fails at once with `statusCode` in the
output. Any other failure (DNS, refused, timeout, invalid JSON from the search
backend) is retried up to `max_attempts` times, and every attempt counts in
`tool_calls`.

web_search reads its backend from the `ALIENCLAW_SEARCH_URL` environment variable
(`web_search.SEARCH_URL_ENV`). There is no default. When the variable is unset or
blank the tool fails with "backend not configured" and makes no request. It calls
`GET <base>?q=<quote_plus(query)>&max_results=N&offset=K` and accepts a JSON list,
or `{"results": [...]}`, of `{title, href, body}` objects. The variable keeps its
in-tree name so behavior stays identical. Renaming it for Pho3nix means changing
that one constant.

**web_search is deliberately left outside the SSRF guard and pinning.** Its target
is the backend URL the operator configured (a local SearXNG instance, for example),
not a URL the agent chose, so it uses the stock `urllib.request.urlopen` (which
follows redirects and honors proxy variables). The result URLs it returns are
unvetted data: fetch them with http_get or url_fetch, which apply the guard.

## Safety guarantees (from agent_tool_sandbox)

`http_get` and `url_fetch` call `resolve_and_validate` before any I/O (the SSRF
guard, resolving the name once) and then **fetch the canonical URL it returns**,
never the raw input, through `build_pinned_opener(target)`. They report that URL
in `output["fetched_url"]`; `output["url"]` is the caller's input, unchanged. As a
result:

- Only `http` and `https` are allowed. `file:`, `ftp:`, `gopher:`, `data:` and the
  rest are refused.
- Internal addresses are refused in every spelling the resolver accepts: loopback,
  RFC 1918, link-local and cloud metadata, multicast, reserved, unspecified, RFC 6598
  CGNAT, IPv6 ULA and site-local, and IPv4-mapped IPv6. This includes forms such as
  `127.1`, `0x7f.0.0.1` and `2130706433`. The check applies to **every** address a
  name resolves to: one internal A or AAAA record is enough to refuse the URL.
  Names that do not resolve are refused too.
- Any URL whose parts different parsers would split differently is refused: userinfo,
  `%` in the host, a second `:` outside brackets, a backslash, whitespace or control
  characters, and host characters outside `[a-z0-9._-]` after IDNA. The host the
  guard checks is therefore the host urllib connects to (see
  `tests/test_connect_host_tools.py`).
- Every 3xx is refused (`Redirect to '<Location>' blocked`). No redirect is
  followed, so a redirect cannot reach an internal address.
- **DNS pinning.** The connection goes only to the addresses the guard vetted, in
  resolver order with fallback; nothing resolves the name again at connect time,
  so a name that answers public for the check and `127.0.0.1` afterwards still
  reaches the public address. One resolution covers the whole `run()`, retries and
  `request_count` included. For HTTPS, SNI and certificate verification use the
  original host name.
- **No proxy.** `http_proxy`, `https_proxy` and `all_proxy` are ignored: a proxy
  resolves the name itself, past every IP check. (The in-tree tools honor them.)
- **Host header.** A caller-supplied `Host` header that names another host is
  refused (`Refusing Host header 'x': the pinned request is for 'y'`) and nothing
  is sent: a shared front end at the vetted IP would route it to another, possibly
  internal, site. One that names the URL's own host, in any case, is sent as
  given. Virtual-host probing therefore needs the vhost in the URL itself. (The
  in-tree tools forward any `Host`.)

## Known gaps

Each gap that can be shown in a test is pinned as a strict xfail in
`tests/test_known_gaps.py`. A fix then shows up as XPASS and fails the run. Three
former gaps (DNS rebinding, search_text off the main thread, bad input types) are
fixed in this copy only; their tests are now regression tests.

- **Redirect policy.** The fetch tools refuse every redirect rather than
  re-validating it, so a target that answers `301` to `https://` or to a trailing
  slash returns an error, not content. Following redirects safely would need a
  per-hop `resolve_and_validate` and a new pinned opener.
- **No port policy and no host allowlist.** `http://public-host:25/` passes.
- **web_search bad numbers raise.** web_search is kept identical to the in-tree
  tool, so a non-numeric `max_results`, `page_count`, `max_attempts` or
  `num_results` still raises from `run()` (strict xfail).
- **search_text off the main thread costs a process.** See below.

## search_text and threads

On the main thread (where SIGALRM exists) the regex timeout is SIGALRM, as in the
in-tree tool; the regex engine polls for signals while matching, so the alarm
interrupts a catastrophic pattern (checked on CPython 3.14). Anywhere else, such
as a Flask request thread, a Qt worker, a sub-interpreter or Windows, the staged
tool cannot use a signal, and nothing in-process can stop a runaway match: the
regex engine holds the GIL for the whole match, so a watchdog thread never gets to
run and the whole process (GUI thread included) stalls until the match ends. A
bounded-input or pattern-complexity guard was rejected too: a case-insensitive
200-character literal over 10 MiB already takes about 6 s, and any guard loose
enough to allow common recon patterns such as `(\d{1,3}\.){3}\d{1,3}` cannot
bound backtracking on a 10 MiB line.

So off the main thread the compile and scan run in a child interpreter,
`[sys.executable, "-I", "-S", _scan.py]` (isolated mode, no site), which is killed
at the same 5 s budget; results and error messages are identical to the main
thread. Startup costs about 20 ms. A literal search where `len(text) *
len(pattern)` is at most 10,000,000 (at most about 30 ms) skips the child and runs
in-process. If there is no usable interpreter (a frozen app, whose
`sys.executable` is the app itself, or an empty `sys.executable`), a glob, regex
or large literal search off the main thread returns an error rather than running
without a budget.

## How Pho3nix would consume it

Install both packages, or until they are published put both `src/` directories on
`PYTHONPATH`:

```python
from pho3nix_recon_http import TOOL_REGISTRY, RunResult

r: RunResult = TOOL_REGISTRY["http_get"]({"url": target_url}, {"field_count": 5})
if r.ok:
    asked = r.output["url"]            # the caller's input, unchanged
    fetched = r.output["fetched_url"]  # canonical URL actually fetched (IDNA host, no userinfo)
else:
    reason = r.error               # "Refusing ...", "Redirect to ... blocked", "HTTP 404: ..."
```

- Import tools directly (`pho3nix_recon_http.url_fetch.run`) or through
  `TOOL_REGISTRY`. The registry holds only these four tools.
- Set the web_search backend with the environment variable above.
- `search_text` works from any thread. Off the main thread it may start a child
  Python process (see "search_text and threads"); in a frozen build, keep glob and
  regex searches on the main thread.
- Route the fetch tools through a proxy (Caido, Burp) only by changing the code:
  the pinned opener ignores proxy variables on purpose.
- The package is stdlib-only apart from `agent-tool-sandbox`, which is itself
  stdlib-only.

## Tests

```bash
cd staging/pho3nix-recon-http
PYTHONPATH=src:../agent-tool-sandbox/python/src python3 -m pytest tests -q -p no:cacheprovider
ruff check .
```

The suite never touches the network. Everything below is mocked:

- **DNS:** `socket.getaddrinfo` is a fake resolver. IP literals go through the real
  libc parser with `AI_NUMERICHOST`, which never performs a lookup. Names come from a
  table (`public.example` resolves to `93.184.216.34`, `cgnat.example` to
  `100.64.0.1`, and so on), and everything else is NXDOMAIN.
- **Sockets:** `socket.socket.connect` raises and records the address it was given.
- **HTTP:** the tools' real pinned opener runs, and only its connection classes
  are replaced by in-process fakes, so the pinned handler's checks (scheme, host
  and port, Host header, address re-check) and the no-redirect handler are real.
  The DNS-pinning tests run without the fake transport and record the address
  that `socket.connect` was asked for. Some tests patch `urllib` at module level
  (the retry tests) or `urllib.request.urlopen` (web_search).
- **Processes:** the search_text thread tests start real child interpreters
  (`sys.executable -I -S`), which do no I/O beyond their pipes.
- **Environment:** proxy variables and the web_search variable are cleared for every
  test. Tests that need a backend set a dummy one (`http://stub.test/search`). No
  test reads an API key or any `.env` file.

The in-tree tests these were ported from used real `http.server` instances on
127.0.0.1 and bypassed the guard. The ported tests run the real guard instead.
`test_parity_in_tree.py` skips when `<repo>/src` (or
`$PHO3NIX_RECON_HTTP_REFERENCE_SRC`) is not importable, so the package still works
once lifted out of this repo.
