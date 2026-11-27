# Shared SSRF vector corpus

One versioned list of SSRF test inputs, with every vector's recorded verdict for both
implementations of the agent-tool sandbox:

- Python `agent_tool_sandbox` (`../python`)
- TypeScript `@v3x/hardened-fetch` (`../ts`)

The corpus **records current behaviour**. It does not say what either implementation should
do. Where the two disagree, `DIFFERENCES.md` lists the vector, its range and what the
plan's strictest-wins rule would pick. That choice is the owner's
(`docs/salvage/OSS-LIB-EXTRACTION-PLAN.md`, gates G3 and G6).

| File | What it is |
|---|---|
| `ssrf-vectors.json` | The corpus: inputs, mocked DNS answers, verdicts, rationale, refs |
| `generate.py` | Runs both implementations and fills in `expected` (Python in-process, TS through `generate-ts.mjs`) |
| `generate-ts.mjs` | TS half of the generator; prints verdicts as JSON and never writes the corpus |
| `DIFFERENCES.md` | Every vector where `python != ts`, grouped by range |
| `../python/tests/test_shared_vectors.py` | One pytest case per vector, asserting `expected.python` |
| `../ts/test/shared-vectors.test.ts` | One vitest case per vector, asserting `expected.ts` |

## Schema (`schema_version: 1`)

Top level:

| Field | Type | Meaning |
|---|---|---|
| `schema_version` | integer | `1`. Bump only when the file format changes. |
| `generated_at` | `YYYY-MM-DD` | Date the verdicts last changed. |
| `generated_with` | object | `python`, `node` and `platform` versions the verdicts were recorded on. |
| `vectors` | list | The vectors, in a stable order (grouped by category). |

Each vector:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Unique, `[a-z0-9][a-z0-9.-]*[a-z0-9]`. It is the test-case name in both suites. Never reuse one. |
| `category` | string | Grouping, for example `ipv4-special`, `ipv6-embedded-ipv4`, `metadata`, `backslash` or `scheme`. |
| `input` | string | A URL (level `url`) or an IP address (level `ip`). It may contain any character, including control characters. |
| `level` | `"url"` or `"ip"` | Which part of the guard runs (see below). |
| `resolves_to` | list of IPs, optional | Level `url` only: what the mocked resolver answers for any non-literal hostname. If absent, the answer is NXDOMAIN. `[]` is an empty answer. |
| `expected` | `{"python": v, "ts": v}` | `v` is `"block"` or `"allow"`, as observed by running the code. Do not hand-edit it; it is written by `generate.py --write`. |
| `rationale` | string | Why the vector exists and what it probes. |
| `refs` | list of strings | RFC sections, IANA registry names, review finding IDs (`SR-NN`), plan threats (`T3`) or `control` for a public control. |

## The harness (both languages, network-free)

**Level `url` runs the full guard on `input`.**

- *Python* calls `assert_safe_fetch_url(input)`. `socket.getaddrinfo` is replaced. IP
  literals go to the real libc parser with `AI_NUMERICHOST`, so `127.1`, `0x7f.1` and
  `2130706433` behave as in production, and str hosts get the real IDNA codec. Every other
  name is answered with `resolves_to`. `block` means `SsrfBlockedError` was raised;
  `allow` means a URL was returned. `pinning.resolve_and_validate` runs the same checks.
- *TS* calls `hardenedFetch(input, { timeoutMs: 5000, maxBytes: 65536 })`.
  `dns.promises.lookup` is replaced:
  - an IP literal is answered with itself, as Node does;
  - a bracketed name never resolves, as with the real getaddrinfo;
  - every other name is answered with `resolves_to`.

  `net.Socket.prototype.connect` is replaced by a tripwire that records the attempt and
  destroys the socket before anything is sent. `allow` means a connect was attempted, so
  the request would have left the host. `block` means `hardenedFetch` rejected first. The
  tripwire works whatever transport the package uses (undici `fetch`, or the
  `node:http(s)` pinned transport), so refusals inside the transport, such as the Fetch
  bad-port list and credentials in the URL, count as `block`.

**Level `ip` runs the post-DNS address check on `input`, as the only address a lookup
returned.**

- *Python* calls `assert_safe_fetch_url("http://ip-vector.test/")` with the resolver
  answering `input` only, so the IPv4-mapped unwrap in `_resolve_host_ips` is included.
- *TS* calls `validateResolvedAddresses([{ address: input, family: net.isIP(input) }])`.

The harness is written four times: `generate.py`, `generate-ts.mjs` and the two test files.
Change all four together.

Python verdicts were also checked on CPython 3.10.22, 3.11.17, 3.13.16 and 3.14.5, and are
identical to the recorded 3.14.9 ones for every vector. Python's decisions come from
`ipaddress` tables, so an older patch release can still differ. A failure there is real
drift, not a flaky test.

## Run the tests

From the repository root (`W`):

```bash
# Python
cd staging/agent-tool-sandbox/python && PYTHONPATH=src python3 -m pytest tests/test_shared_vectors.py -q -p no:cacheprovider
# TS
node_modules/.bin/vitest run staging/agent-tool-sandbox/ts/test/shared-vectors.test.ts
```

Neither suite needs the network. For proof, run either one under `unshare -rn`, which
gives a namespace with loopback only.

## Regenerate the verdicts

```bash
cd staging/agent-tool-sandbox/vectors
python3 generate.py            # check: run both languages, list every changed verdict, exit 1 if any
python3 generate.py --explain  # also print each side's reason for every python != ts vector
python3 generate.py --write    # write the observed verdicts (and generated_at / generated_with)
```

`generate.py` finds tsx through `--tsx PATH`, then `$TSX`, then the nearest
`node_modules/.bin/tsx` above this directory, then `PATH`. It refuses to write if either
harness crashes or returns something other than `block`/`allow`, so a crash is reported and
never recorded as a verdict. It validates the schema first and exits with code 2 if the
schema is broken. Run it under `unshare -rn` as well, if you can.

After `--write`, review `git diff ssrf-vectors.json`. Every changed verdict is a behaviour
change in one implementation, and it must be explained by the change that caused it. Then
update `DIFFERENCES.md`: every `python != ts` vector must appear in it exactly once.

## Add a vector

1. Append an object to `vectors` in `ssrf-vectors.json`, next to its category, with `id`,
   `category`, `input`, `level`, optional `resolves_to`, `"expected": {}`, `rationale` and
   `refs`. Use a new id.
2. For a hostname at level `url`, give `resolves_to`. Without it the vector tests NXDOMAIN,
   not the policy you meant. For parser-differential vectors (userinfo, backslash,
   percent, whitespace), give a public answer, so a `block` has to come from the parser
   check rather than from DNS.
3. Run `python3 generate.py --write`, read the two verdicts it recorded, and hand-review
   them. If `python != ts`, add the vector to `DIFFERENCES.md`.
4. Run both test files.

## Versioning

- Adding a vector, or rewording `rationale` or `refs`, is a patch-level corpus change.
- A changed `expected` value is a policy change in one implementation. Per plan §3.5, it
  is a minor bump with a CHANGELOG "Policy" entry once the library is published.
- `schema_version` changes only with the file format. Both test files assert it.
