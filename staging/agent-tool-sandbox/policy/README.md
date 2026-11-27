# SSRF block-list policy

One table for both languages of the agent-tool sandbox. `blocklist.v1.json` lists every
address range and host name the SSRF guards refuse, with a rationale, references, and one
column per language. Two generators turn it into the module each guard reads:

| File | What it is |
|---|---|
| `blocklist.v1.json` | The table: the only place a range is written down |
| `gen_python.py` | Writes `../python/src/agent_tool_sandbox/_blocklist_data.py` (stdlib only) |
| `gen-ts.mjs` | Writes `../ts/src/blocklist-data.ts` (no dependencies) |
| `../python/tests/test_blocklist_data.py` | Drift test: regenerates in memory, compares bytes |
| `../ts/test/blocklist-data.test.ts` | Drift test, TS side |

Both generated files start with `GENERATED — do not edit` and are committed. Each carries
the SHA-256 of the JSON, so ANY edit to the JSON (a rationale too) fails both drift tests
until both generators have been run:

```bash
python3 policy/gen_python.py && node policy/gen-ts.mjs   # write
python3 policy/gen_python.py --check; node policy/gen-ts.mjs --check   # exit 1 if stale
```

The code that stays in each guard is parsing (URL, IPv4/IPv6 literals, zone IDs), the
fail-closed rules (an unparseable IPv6 is blocked; an unknown address family is refused),
the embedded-IPv4 extraction, and the trailing-dot handling of names. Every block decision
comes from the table. Python no longer consults any `ipaddress.is_*` property.

## How G3 gets decided

Gate G3 (`docs/salvage/OSS-LIB-EXTRACTION-PLAN.md` §3.4) is a decision about this file
only. Today it reproduces each language's behaviour exactly (`"profile": "per-language"`),
so the columns differ wherever `../vectors/DIFFERENCES.md` says the languages differ. Two
ways to decide:

- **All at once:** set `"profile": "strictest-wins"`. Both languages then enforce the same
  rules (asserted by both drift test files).
- **Range by range:** flip individual `applies` values and keep `per-language`.

Then run both generators, run `python3 vectors/generate.py --write` (the shared-vector
suites assert the recorded verdicts, so they fail until the corpus is re-recorded), and
update `../vectors/DIFFERENCES.md`. URL-spelling rules (DIFFERENCES.md groups g14 and g15)
and port rules are parser rules, not ranges, so they are not in this table.

What `strictest-wins` changes in the shared corpus today (296 vectors; measured 2026-11-26
on a scratch copy with the profile switched, both generators re-run): **32 verdicts move,
all from allow to block, 25 in TS and 7 in Python.** No refusal message of an unchanged
verdict moves. The vectors where the languages differ drop from 50 to 18, which are exactly
the parser-rule groups g14 (15) and g15 (3).

| DIFFERENCES.md group | Rule that decides it | TS | Python |
|---|---|---|---|
| g1 `192.0.0.9`, `192.0.0.10` | the two exemptions turn off (TS does not grant them) | - | 4 |
| g2 IPv4 TEST-NETs | `v4-test-net-*` turn on | 4 | - |
| g3 IPv4-mapped, public embedding | `v6-ipv4-mapped` turns on and beats the decode | - | 3 |
| g4 NAT64 `64:ff9b::/96`, public embedding | `v6-nat64-wkp` turns on and beats the decode | 4 | - |
| g5 `64:ff9b::/32` outside the /96 and /48 | `v6-reserved-0000` | 2 | - |
| g8 rest of `2001::/23` | `v6-ietf-2001-23` (its IANA exemptions stay on) | 4 | - |
| g9 IPv6 documentation | `v6-documentation`, `v6-documentation-3fff` | 3 | - |
| g10 `100::/8`, discard-only `100::/64` | `v6-reserved-0100`, `v6-discard` | 2 | - |
| g12 other IPv6 outside `2000::/3` | `v6-reserved-*` | 6 | - |
| **total** | | **25** | **7** |

The "Both languages allow" rows in DIFFERENCES.md (`192.88.99.0/24`, `2001:1::1`/`::2`,
ISATAP, the Redis port) do not move: no column blocks them today.

## Schema (`schema_version: 1`)

Top level, keys in this order: `schema_version` (1), `profile` (`"per-language"` or
`"strictest-wins"`), `description`, `entries`.

Each entry:

| Field | Meaning |
|---|---|
| `id` | Unique, `[a-z0-9][a-z0-9.-]*[a-z0-9]`. Named in the generated files' comments. |
| `family` | `ipv4`, `ipv6` or `name` |
| `effect` | `block`, `exempt` (a carve-out from the block rules) or `decode` (an embedded-IPv4 matcher) |
| `cidr` | IP entries. Strict (no host bits); IPv6 in plain lower-case hex groups |
| `name` / `name_suffix` | Name entries: an exact host name, or a suffix that starts with `.` |
| `matcher` | Decode entries: `ipv4-mapped` (`::ffff:0:0/96`) or `nat64-embedded` (`64:ff9b::/96`); `cidr` must be that prefix |
| `decode_excludes` | Decode entries, optional: `{"python": [ids], "ts": [ids]}`, IPv4 block entries the decode skips |
| `rationale`, `refs` | Why, and where it comes from (RFCs, IANA registries, DIFFERENCES.md groups) |
| `applies` | `{"python": bool, "ts": bool}`: whether that language enforces the entry |

For an `exempt` entry, `true` means that language lets the range through even though a
block entry covers it (`false`: the block wins). For a `decode` entry, `true` means the
language judges the prefix by its embedded IPv4.

## Matching rules (both languages)

1. **Names** (before DNS, after IDNA, lower case, trailing dots removed): refused when equal
   to a `name` or ending in a `name_suffix`.
2. **IPv4:** blocked when inside a `block` entry and inside no `exempt` entry.
3. **IPv6**, embedded-IPv4 matchers first. For an address inside a matcher's prefix:
   - if a `block` entry with exactly that prefix is on, it is blocked;
   - else if the matcher's `decode` entry is on, the last 32 bits decide alone, as an IPv4
     address (rule 2, minus any `decode_excludes`);
   - else the IPv6 ranges decide.

   A block entry strictly inside a matcher prefix is refused by the generators: list the
   IPv4 range instead.
4. **Other IPv6:** blocked when inside a `block` entry and inside no `exempt` entry. Zone IDs
   are ignored.

## Profiles

- `per-language` (default): each language reads its own column.
- `strictest-wins`: a `block` or `decode` entry is on if EITHER column is `true`; an
  `exempt` entry only if BOTH are (an exemption survives only if neither language blocks
  the range); `decode_excludes` keeps only the ids both languages list. Since a whole-prefix
  block beats its decode (rule 3), this blocks every IPv4-mapped address and the whole NAT64
  `/96` today. The plan's `nat64: 'decode'` opt-in would be a per-call override of that,
  which is not built.

## Recorded behaviour quirks (kept for zero verdict change)

- **Python, raw IPv4-mapped input.** The guard unwraps IPv4-mapped DNS answers to IPv4
  before the check (`_resolve_host_ips`, and `pinning._checked_addresses` for pin lists), so
  through the guard the embedded address meets the whole IPv4 table. Only a mapped
  `IPv6Address` handed straight to `_ip_is_blocked` takes the `ipv4-mapped` decode, and
  there CGNAT and the WireServer address were never checked (the `is_*` properties delegate
  to the embedded IPv4; the CGNAT and WireServer checks were `IPv4Address`-only). The decode
  entry's `decode_excludes` reproduces that, because `tests/test_parity_in_tree.py` asserts
  `::ffff:100.64.0.1` and `::ffff:168.63.129.16` are allowed there exactly as the in-tree
  guard allows them.
- **Python unwrap under another profile.** `_resolve_host_ips` unwraps only while the
  `ipv4-mapped` matcher is a decode (`UNWRAP_IPV4_MAPPED` in the generated module), so a
  profile that blocks mapped addresses whole really blocks mapped DNS answers.
  `pinning._checked_addresses` (outside this change) still unwraps caller-built pin lists
  unconditionally; it then checks and dials the embedded IPv4, which is the same
  destination, so it is not a bypass. Make it read the flag when G3 lands.
- **Python versions.** The table freezes the `ipaddress` tables of CPython 3.10.22, 3.11.17,
  3.12.13 and 3.14.9, which are identical (all carry the 2024 `is_private` fix and the
  IPv4-mapped delegation). On those, old and new code agree on every corpus vector and on a
  differential run of about 600,000 addresses each. On an older, unpatched patch release
  (for example 3.11.0-3.11.9 or 3.12.0-3.12.3) the guard now gives these verdicts instead of
  that interpreter's: the decision no longer depends on the interpreter.
