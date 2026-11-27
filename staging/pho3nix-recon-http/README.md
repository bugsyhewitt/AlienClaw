# pho3nix-recon-http (staged)

AlienClaw's four recon request tools, copied out of `src/alienclaw/tools/` so they
can later move to Pho3nix: `http_get`, `url_fetch`, `web_search` and `search_text`.
The two fetch tools use the SSRF guard from
[`agent-tool-sandbox`](../agent-tool-sandbox/python/README.md) instead of the
in-tree `_ssrf_guard` module. Nothing here imports `alienclaw`.

Status: **staged only**. Nothing consumes this package yet, the in-tree tools are
unchanged, and Pho3nix has not been touched. Moving it to Pho3nix waits on the
owner's go.

Behavior matches the in-tree tools, with one inherited difference (CGNAT, below).
`tests/test_parity_in_tree.py` runs the same mocked inputs through both sides and
checks this. `PROVENANCE.json` records the source blob of every file and lists
each divergence.

## Layout

```
pyproject.toml                  name pho3nix-recon-http, depends on agent-tool-sandbox (declared only)
src/pho3nix_recon_http/
  __init__.py                   TOOL_REGISTRY (the 4 tools), RunResult, RunnerFn
  http_get.py  url_fetch.py     SSRF-guarded fetch tools
  web_search.py                 JSON search backend client (operator-configured URL)
  search_text.py                literal / glob / regex line search with a ReDoS guard
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
| `http_get` | `url`, `headers` | `max_attempts` 1-5 (1), `request_count` 1-5 (1), `field_count` 1-5 (3), `body_preview` 1-10 (5) | `url` (the canonical URL), `statusCode`, `content`, `bytesReturned`, `contentType` (by field_count), always `truncated` and `body_preview` |
| `url_fetch` | `url`, `method` (GET), `headers`, `body` (sent as `str(body)`) | `max_attempts`, `request_count`, `field_count` as above, `content_preview` 1-10 (2) | `url`, `statusCode`, `content`, `contentLength`, `contentType` (by field_count), always `preview` |
| `web_search` | `query` (or `task`), `num_results` | `max_attempts` 1-5, `max_results` 1-10 (5), `page_count` 1-3 (1) | `query`, `result_count`, `results` [{title, url, snippet}] deduplicated by URL, `pages_fetched` |
| `search_text` | `text` (or `content`), `pattern` (or `query`), `flavor` literal/glob/regex, `regex` (alias), `case_sensitive` | `max_results` >=1 (100), `context_lines` 1-10 (1) | `pattern`, `flavor`, `caseSensitive`, `totalMatches`, `truncated`, `matches` [{matchText, lineNumber, startOffset, endOffset, contextBefore, contextAfter}] |

Response caps: http_get reads at most 1 MiB (and sets `truncated` when the server
announces a larger `Content-Length`), and url_fetch reads at most 2 MiB. Each
request has a 30 s timeout (20 s for web_search). search_text refuses text over
10 MiB and patterns over 200 characters.

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

## Safety guarantees (from agent_tool_sandbox)

`http_get` and `url_fetch` call `assert_safe_fetch_url` before any I/O and then
**fetch the canonical URL it returns**, never the raw input. They also report that
URL in `output["url"]`. Their opener comes from `build_no_redirect_opener()`. As a
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

## Known gaps

Each gap that can be shown in a test is pinned as a strict xfail in
`tests/test_known_gaps.py`. A fix then shows up as XPASS and fails the run. Every
gap applies to the in-tree tools too, because the code is identical.

- **No DNS pinning (rebinding).** The guard resolves the name once, and urllib
  resolves it again when it connects. A host whose DNS answers with a public address
  for the check and `127.0.0.1` for the connect gets through. The xfail shows the
  connect going to `127.0.0.1`. To close the gap, connect to the vetted IP (and send
  the original Host and SNI), or route fetches through an egress proxy that enforces
  the policy.
- **Redirect policy.** The fetch tools refuse every redirect rather than
  re-validating it, so a target that answers `301` to `https://` or to a trailing
  slash returns an error, not content. Following redirects safely would need a
  per-hop `assert_safe_fetch_url`. **web_search does not use the guard at all**:
  it uses the stock `urllib.request.urlopen`, which follows redirects. Its backend
  URL is trusted operator configuration (a local SearXNG instance, for example),
  and the result URLs it returns are data that has not been vetted. Fetch them with
  http_get or url_fetch, which apply the guard.
- **Proxies.** `build_opener` installs a `ProxyHandler` from `http_proxy` or
  `https_proxy`. With a proxy set, the guard checks the target, and the proxy then
  resolves the name itself.
- **No port policy and no host allowlist.** `http://public-host:25/` passes. A
  caller-supplied `Host` header is sent as given, so virtual-host probing works,
  while the connection still goes to the vetted host. A test documents this.
- **search_text only works on the main thread.** It installs a SIGALRM handler for
  its ReDoS timeout, and `signal.signal()` raises `ValueError` off the main thread.
  Called from a Flask request thread or a Qt worker, `run()` raises instead of
  returning a `RunResult`. On platforms without SIGALRM (Windows) there is no regex
  timeout at all. The timeout does interrupt a catastrophic pattern mid-match on
  CPython 3.14, which was checked. Other versions were not checked, and the tests
  stay bounded either way.
- **Bad input types raise.** A non-numeric param (`{"field_count": "x"}`), a
  non-string `text` or a non-string `pattern` raises from `run()` instead of
  returning `ok=False`. The in-tree tools behave the same, which the parity corpus
  confirms.

## How Pho3nix would consume it

Install both packages, or until they are published put both `src/` directories on
`PYTHONPATH`:

```python
from pho3nix_recon_http import TOOL_REGISTRY, RunResult

r: RunResult = TOOL_REGISTRY["http_get"]({"url": target_url}, {"field_count": 5})
if r.ok:
    fetched = r.output["url"]      # canonical URL actually fetched (IDNA host, no userinfo)
else:
    reason = r.error               # "Refusing ...", "Redirect to ... blocked", "HTTP 404: ..."
```

- Import tools directly (`pho3nix_recon_http.url_fetch.run`) or through
  `TOOL_REGISTRY`. The registry holds only these four tools.
- Set the web_search backend with the environment variable above.
- Call `search_text` from the main thread, or fix the gap above first.
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
- **HTTP:** an in-process urllib handler is added to the openers the tools build.
  The tools' own no-redirect handler stays in place, so 3xx handling is real. Some
  tests patch `urllib` at module level (the retry tests) or
  `urllib.request.urlopen` (web_search).
- **Environment:** proxy variables and the web_search variable are cleared for every
  test. Tests that need a backend set a dummy one (`http://stub.test/search`). No
  test reads an API key or any `.env` file.

The in-tree tests these were ported from used real `http.server` instances on
127.0.0.1 and bypassed the guard. The ported tests run the real guard instead.
`test_parity_in_tree.py` skips when `<repo>/src` (or
`$PHO3NIX_RECON_HTTP_REFERENCE_SRC`) is not importable, so the package still works
once lifted out of this repo.
