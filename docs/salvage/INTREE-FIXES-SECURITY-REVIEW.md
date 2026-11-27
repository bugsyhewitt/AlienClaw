# In-tree fix set: third (security) review

Date: 2026-11-26. Scope: the `src/`, `test/` and `.gitignore` parts of the 13 commits that
`staging/tools/replay_fixes.sh` replays onto `origin/main`
(`git diff origin/main..HEAD -- src test .gitignore`). This pass looked only for what the two
earlier /code-review passes did not report. Findings they already made, and the items they
parked, are not repeated here.

How it was checked: by reading the code, then running offline probes on CPython 3.12.13 (the CI
version) and 3.14.9 (the local one), with origin/main extracted alongside for before/after
timings. The probes are under
`/tmp/claude-1000/-home-xil-dev-alienclaw/8583d279-be75-4906-9885-a0f66a34619d/scratchpad/intree-review/`
(`p1`..`p7`). DNS is mocked and no sockets are opened. The fix set's own Python tests pass
offline on 3.14 (`687 passed`).

## Findings

| ID | Severity | File:line | Title | NEW/KNOWN |
|----|----------|-----------|-------|-----------|
| F1 | **Medium** | `src/alienclaw/tools/_boundary.py:173` (via :199) | Symlink walk calls `realpath()` once per path component, so cost grows quadratically. A few KB of path takes tens of seconds of CPU in `file_read` and `file_write` | NEW (regression, 8d66853c) |
| F2 | Low | `src/alienclaw/tools/_ssrf_guard.py:186` | The canonical URL drops an empty query `?`, so `/a?` is fetched as `/a`. A test pins this behaviour | NEW (c4527f06) |
| F3 | Low | `src/alienclaw/tools/file_read.py:69-78` | The 10 MiB cap is checked on `fstat()` but the read is unbounded. A file that grows after the `fstat()` is read in full | NEW claim, pre-existing race |
| F4 | Info | `src/alienclaw/tools/file_read.py:29-42` | An in-root hard link to an outside file is read (no path check can see it) | pre-existing |
| F5 | Info | `src/alienclaw/tools/_boundary.py:138-151` | "Fail closed on uninspectable paths" only holds on Python ≤3.12. On 3.13+ the protection comes from `open()` instead | NEW (doc/test accuracy) |
| F6 | Info | `src/alienclaw/net/hardened-fetch.ts:24-28` | Nothing in `src/` imports this module, so all of tonight's TS fixes are test-only. The header's "Consumers" list is stale | pre-existing |
| F7 | Info | `file_read.py:54`, `file_write.py:23` | A non-string `path` (`123`, a list) raises `TypeError` instead of returning a RunResult. The bridge catches it | pre-existing |

### F1 (Medium): quadratic symlink walk, a CPU DoS from one tool call

`_entries_at_or_below()` computes `os.path.realpath(parent)` for **every** component of the
unresolved path. `realpath()` walks the whole prefix each time and builds strings component by
component. Before 8d66853c the walk was linear.

Repro (`p3_outside_deep.py`): `path = "../"*depth + "nonexistent-zz/" + "a/"*N + "x.txt"`.
Every call ends in the correct generic refusal, but only after this much CPU:

| N (path length) | origin/main 3.12 | HEAD 3.12 | HEAD 3.14 |
|---|---|---|---|
| 1000 (2 KB) | 0.00 s | 1.82 s | 1.13 s |
| 2000 (4 KB) | 0.01 s | 7.25 s | 4.61 s |
| 4000 (8 KB) | 0.01 s | 30.40 s | 19.77 s |

`file_write` behaves the same way (N=2000: 4.7 s). An in-root path (`"a/"*N`, `p2_deep_path.py`)
costs the same on 3.14: 26.6 s at N=4000, against 0.012 s on main. On 3.12 the in-root case
stops near N≈2000 (≈10 s), when `lstat` hits ENAMETOOLONG. The out-of-root case has no such
stop on either version, because out-of-root entries are never lstat()ed. The bridge accepts
requests up to 1 MiB (`bridge/server.py:47`), so one call can carry N≈500 000. That call burns
CPU until `real-summon-adapter.ts` sends SIGTERM/SIGKILL at `timeout_ms`, and it reports a
timeout instead of a refusal. The path comes from the tool inputs, which an LLM or
prompt-injected content can shape.

Fix:
1. At the top of both tools, before any filesystem call, refuse
   `len(path_str) > 4096` and refuse paths with more than about 64 components. The kernel refuses
   more than PATH_MAX anyway, so no legitimate caller loses anything.
2. Optionally, make the walk incremental. Carry `parent_real` from one step to the next. For
   `..`, use `parent_real = dirname(parent_real)`: it is already symlink-free, so this matches
   the kernel. For an in-root entry that passed `is_symlink`, use `join(parent_real, part)`.
   Call `realpath()` only on out-of-root steps.

Add a regression test that bounds the time (for example N=4000 under 0.5 s) for both tools.

### F2 (Low): empty query lost in the canonical URL

`urlsplit()` followed by `urlunsplit()` drops an empty query. This is the same class of bug as
the `;` params fix in 66292280, which that commit's own test calls "another resource".
`p1_canonical.py`, identical on 3.12 and 3.14:

```
'http://example.com/a?'  -> 'http://example.com/a'   request-target '/a?' -> '/a'
'http://example.com/?'   -> 'http://example.com/'    '/?' -> '/'
'http://example.com?'    -> 'http://example.com'     '/?' -> '/'
```

`http_get` and `url_fetch` now request a different request-target from the one the caller asked
for. That matters for pre-signed or HMAC-signed URLs and for servers that route on `?`. The host
does not change, so this is not an SSRF issue. **`test/tools/test_fetch_output_url.py:84` pins
the wrong behaviour** (`"http://public.example/x?" -> "http://public.example/x"`).

Fix: change only the authority and keep the rest of the input exactly. The authority is already
validated as plain, so:

```python
rest = raw_url[len(split.scheme) + 3 + len(split.netloc):]
canonical = f"{split.scheme}://{netloc}{rest}"
```

Keep the second `_assert_connects_to(canonical, ...)` check. Change line 84 of the test to keep
the `?`. Every other rebuild difference I checked is safe and does not change the connect
target compared with main:

- scheme and host are lower-cased;
- `:080` becomes `:80` and an empty `:` is dropped;
- the host is IDNA-encoded;
- the fragment is kept in the URL (urllib never sends it);
- percent-encoding and `//` paths are unchanged.

### F3 (Low): unbounded read after the size check

`p6_grow_after_fstat.py` appends 20 MiB just after `fstat()`. The result is `ok=True`,
`sizeBytes` reported as 6, and 20 971 526 bytes read into memory. The old code had the same race
(`getsize()` then `read_text()`), but the new comment says the size "comes from the fd". Inside
AlienClaw, `file_write` replaces files atomically and cannot cause this. It needs an outside
appender, such as a log file in the workspace.

Fix: `data = os.read`-loop or `open(fd, 'rb', closefd=False).read(_MAX_BYTES + 1)`, refuse if
`len(data) > _MAX_BYTES`, then decode with
`io.TextIOWrapper(io.BytesIO(data), encoding='utf-8', errors='replace').read()`, which keeps
the universal-newline behaviour. Report `sizeBytes = len(data)`.

### F4–F7 (Info)

- **F4.** `p4_read_swap.py` races each component swap between the checks and the open. Swapping
  an ancestor for a symlink gives ENOTDIR. Swapping the final component for a symlink gives
  ELOOP. A FIFO or a directory gives "Not a file", with no hang. The dir-fd walk holds in all
  these cases. Only a hard link (`final->hardlink(outside)`) reads outside content. That needs an
  actor outside the tools, and `protected_hardlinks` limits it to files that actor can already
  read. An optional hardening is to refuse `st_nlink > 1` on the fd.
- **F5.** On 3.13+, `Path.is_symlink()` returns False on EACCES or ENAMETOOLONG, so
  `_is_symlink` never raises there. The later `open()` fails EACCES, so the path still fails
  closed, just with a different message. The tests monkeypatch `is_symlink` to simulate 3.12, so
  on 3.14 they do not exercise the real behaviour. Say this in the docstring. A positive side
  effect: on 3.12 this commit removes a **pre-existing** escape. On main, a component of 300+
  characters made `path.exists()` raise `OSError ENAMETOOLONG` out of `file_read` and
  `file_write` (`p5_edge_paths.py`). HEAD returns a RunResult.
- **F6.** The real leaderboard fetch is `governance/common/leaderboard.ts`'s own
  `hardenedFetch`. Merging the TS changes is safe but adds no runtime protection.
- **F7.** No change in the fix set. Listed because the RunResult contract was in scope.

## Checked and clean

- **hardened-fetch deadline and abort.** No unhandled rejections: `Promise.race` subscribes to
  both promises it races, and `expired` has a `.catch`. The timer is cleared in `finally`. The
  listener is `once` on a per-call controller, and the cleanup `abort()` settles it. Redirect and
  non-2xx bodies are cancelled. `isDeadlineError` can only match when the deadline aborted the
  signal. NAT64 is additive only: 64:ff9b:1::/48 is matched on `groups[2] === 1`.
- **SSRF guard exceptions.** Every path out of `assert_safe_fetch_url` is a
  `SsrfBlockedError`. The parsers agree when the authority is followed by `#@`, `?@` or `;`.
  The scoped IPv6 `%25` case is refused by the connect-target check.
- **Read path.** NUL bytes, lone surrogates, trailing `/`, `./`, `..` after a real directory,
  `//`, an absolute path inside the root, and in-root symlinks (now refused, as intended) all
  return a RunResult with the expected outcome.
- **Codec** (`p7_codec.py`):
  - Python rejects bool, float (including `-0.0`), NaN, ±inf, str and None with the documented
    ValueError, and accepts `np.int64`.
  - TS maps `-0` to `00` and rejects 1.5, NaN, ±Infinity and 2^53.
  - A Python int with more than 4300 digits still raises ValueError, but with the int-to-str
    limit's message, not the documented one.
- **`_id_tag_for`.** Output is always `[0-9A-Z]{6}01`, and ASCII names map to the same tag as
  before. **Conformance scoring** ignores extra keys, so the always-present `fetched_url` field
  does not move fitness.

## Merge verdict

**Merge after fixing F1.** It is a regression this fix set introduces: a CPU DoS that one
tool-call input of a few KB can trigger. Capping path length and component count is a few lines.
F2 should go in the same pass, because its test currently asserts the wrong behaviour. F3 can
be a follow-up.

## Test quality

- `test_fetch_output_url.py:84` asserts F2's wrong behaviour (see above).
- No test bounds the time or size of path inputs. Add one for F1.
- The uninspectable-path tests only simulate 3.12. Add a test that runs on the real interpreter
  (`chmod 000` on a directory, skipped when running as root) and asserts `ok=False`, whatever
  the message.
- `test_boundary_outside_generic_refusal`'s "no lstat outside" property deliberately does not
  count `realpath()`'s own lstats. That is fine, but those uncounted calls are exactly the F1
  cost.
