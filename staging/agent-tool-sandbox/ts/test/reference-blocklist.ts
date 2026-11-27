/**
 * An independent reference classifier for the property tests (test/property-*.test.ts).
 *
 * It reads policy/blocklist.v1.json directly and applies the matching rules of
 * policy/README.md ("Matching rules", "Profiles") with its own parsing and its own
 * BigInt CIDR arithmetic. It deliberately shares nothing with the code under test:
 * not src/blocklist-data.ts (the generated table), not the parsers in
 * src/hardened-fetch.ts, not policy/gen-ts.mjs. If the generator and this file read
 * the JSON differently, the property tests are where that shows up.
 *
 * Inputs here are numbers (an IPv4 or IPv6 address as a bigint) or a canonical host
 * name, never an address string: turning a value into its many spellings is the
 * generators' job (also here, below), and the library has to read every one of them
 * back to the same value.
 *
 * Not a test file (no .test. in the name), so vitest does not collect it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as fc from 'fast-check';

export const POLICY_SOURCE = fileURLToPath(new URL('../../policy/blocklist.v1.json', import.meta.url));
/** False when the package has been lifted out of the repo without its policy/ folder. */
export const HAVE_POLICY = existsSync(POLICY_SOURCE);

export const V4_MAX = (1n << 32n) - 1n;
export const V6_MAX = (1n << 128n) - 1n;

type Column = 'python' | 'ts';

interface RawEntry {
  id: string;
  family: 'ipv4' | 'ipv6' | 'name';
  effect: 'block' | 'exempt' | 'decode';
  cidr?: string;
  name?: string;
  name_suffix?: string;
  matcher?: string;
  decode_excludes?: { python: string[]; ts: string[] };
  applies: { python: boolean; ts: boolean };
}

/** One CIDR of the table as an inclusive [first, last] range. */
export interface Range {
  readonly id: string;
  readonly family: 4 | 6;
  readonly effect: 'block' | 'exempt' | 'decode';
  readonly first: bigint;
  readonly last: bigint;
  readonly prefixLen: number;
  readonly on: boolean;
}

// ---------------------------------------------------------------------------
// Strict parsers for the table's own CIDR notation (schema: no host bits, IPv6 in
// plain lower-case hex groups, no embedded dotted quad).
// ---------------------------------------------------------------------------

/** The table's IPv4 notation (strict dotted quad) as a number. Exported for building test prefixes. */
export function parseTableV4(text: string): bigint {
  const parts = text.split('.');
  if (parts.length !== 4) throw new Error(`reference: bad IPv4 in table: ${text}`);
  let value = 0n;
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255) throw new Error(`reference: bad IPv4 octet: ${text}`);
    value = (value << 8n) | BigInt(part);
  }
  return value;
}

/** The table's IPv6 notation (lower-case hex groups, at most one '::') as a number. */
export function parseTableV6(text: string): bigint {
  const halves = text.split('::');
  if (halves.length > 2) throw new Error(`reference: bad IPv6 in table: ${text}`);
  const side = (s: string): bigint[] => (s === '' ? [] : s.split(':').map((g) => {
    if (!/^[0-9a-f]{1,4}$/.test(g)) throw new Error(`reference: bad IPv6 group in table: ${text}`);
    return BigInt(`0x${g}`);
  }));
  const head = side(halves[0]!);
  const tail = halves.length === 2 ? side(halves[1]!) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) throw new Error(`reference: bad IPv6 group count: ${text}`);
  const groups = [...head, ...new Array<bigint>(halves.length === 2 ? fill : 0).fill(0n), ...tail];
  return groups.reduce((acc, g) => (acc << 16n) | g, 0n);
}

function parseCidr(entry: RawEntry, on: boolean): Range {
  const [addr, len, extra] = entry.cidr!.split('/');
  if (addr === undefined || len === undefined || extra !== undefined || !/^[0-9]{1,3}$/.test(len)) {
    throw new Error(`reference: bad CIDR ${entry.cidr}`);
  }
  const family = entry.family === 'ipv4' ? 4 : 6;
  const bits = family === 4 ? 32 : 128;
  const prefixLen = Number(len);
  if (prefixLen > bits) throw new Error(`reference: prefix too long: ${entry.cidr}`);
  const first = family === 4 ? parseTableV4(addr) : parseTableV6(addr);
  const hostBits = BigInt(bits - prefixLen);
  const hostMask = (1n << hostBits) - 1n;
  if ((first & hostMask) !== 0n) throw new Error(`reference: CIDR has host bits set: ${entry.cidr}`);
  return { id: entry.id, family, effect: entry.effect, first, last: first | hostMask, prefixLen, on };
}

// ---------------------------------------------------------------------------
// The table, resolved for one column and the file's profile
// ---------------------------------------------------------------------------

/** The prefixes README.md documents for each embedded-IPv4 matcher. */
const MATCHER_PREFIX: Readonly<Record<string, string>> = {
  'ipv4-mapped': '::ffff:0:0/96',
  'nat64-embedded': '64:ff9b::/96',
};

interface Matcher {
  readonly name: string;
  readonly first: bigint;
  readonly last: bigint;
  readonly prefixLen: number;
  /** The decode entry is on: the low 32 bits decide, as IPv4, minus `excludes`. */
  readonly decodeOn: boolean;
  readonly excludes: ReadonlySet<string>;
}

export interface Reference {
  readonly profile: string;
  readonly ranges: readonly Range[];
  /** True when the IPv4 address `value` (0 .. 2^32-1) is blocked. */
  v4(value: bigint): boolean;
  /** True when the IPv6 address `value` (0 .. 2^128-1) is blocked. Zone IDs never reach here. */
  v6(value: bigint): boolean;
  /** True when the canonical (lower-case, IDNA-applied) host name is refused by name. */
  name(hostname: string): boolean;
  /** The id of the innermost range containing `value` (for failure messages). */
  describe(family: 4 | 6, value: bigint): string;
}

export function loadReference(column: Column = 'ts', text: string = readFileSync(POLICY_SOURCE, 'utf8')): Reference {
  const doc = JSON.parse(text) as { schema_version: number; profile: string; entries: RawEntry[] };
  if (doc.schema_version !== 1) throw new Error(`reference: unknown schema_version ${doc.schema_version}`);
  const strictest = doc.profile === 'strictest-wins';
  if (!strictest && doc.profile !== 'per-language') throw new Error(`reference: unknown profile ${doc.profile}`);

  // Profiles (policy/README.md): per-language reads one column; strictest-wins turns a
  // block or decode entry on if EITHER column is on, an exempt entry only if BOTH are.
  const isOn = (e: RawEntry): boolean => {
    if (!strictest) return e.applies[column];
    return e.effect === 'exempt' ? e.applies.python && e.applies.ts : e.applies.python || e.applies.ts;
  };
  const excludesOf = (e: RawEntry): Set<string> => {
    const ex = e.decode_excludes ?? { python: [], ts: [] };
    if (!strictest) return new Set(ex[column]);
    return new Set(ex.python.filter((id) => ex.ts.includes(id)));
  };

  const ranges: Range[] = [];
  const names: string[] = [];
  const suffixes: string[] = [];
  const matchers: Matcher[] = [];
  for (const e of doc.entries) {
    const on = isOn(e);
    if (e.family === 'name') {
      if (!on) continue;
      if (e.name !== undefined) names.push(e.name);
      if (e.name_suffix !== undefined) suffixes.push(e.name_suffix);
      continue;
    }
    const range = parseCidr(e, on);
    ranges.push(range);
    if (e.effect === 'decode') {
      const documented = MATCHER_PREFIX[e.matcher ?? ''];
      if (documented === undefined || documented !== e.cidr) {
        throw new Error(`reference: decode entry ${e.id} has matcher ${e.matcher} on ${e.cidr}, README says ${documented}`);
      }
      matchers.push({ name: e.matcher!, first: range.first, last: range.last, prefixLen: range.prefixLen, decodeOn: on, excludes: excludesOf(e) });
    }
  }

  const inside = (r: Range, value: bigint): boolean => value >= r.first && value <= r.last;
  const v4Rule = (value: bigint, excludes: ReadonlySet<string>): boolean =>
    ranges.some((r) => r.family === 4 && r.on && r.effect === 'block' && !excludes.has(r.id) && inside(r, value)) &&
    !ranges.some((r) => r.family === 4 && r.on && r.effect === 'exempt' && inside(r, value));
  const NONE: ReadonlySet<string> = new Set();

  return {
    profile: doc.profile,
    ranges,
    v4: (value) => v4Rule(value, NONE),
    v6(value) {
      // Rule 3: embedded-IPv4 matchers first.
      for (const m of matchers) {
        if (value < m.first || value > m.last) continue;
        const wholeBlock = ranges.some((r) => r.family === 6 && r.on && r.effect === 'block' &&
          r.first === m.first && r.prefixLen === m.prefixLen);
        if (wholeBlock) return true;
        if (m.decodeOn) return v4Rule(value & V4_MAX, m.excludes);
        break;  // the matcher prefixes do not overlap; the IPv6 ranges decide
      }
      // Rule 4.
      return ranges.some((r) => r.family === 6 && r.on && r.effect === 'block' && inside(r, value)) &&
        !ranges.some((r) => r.family === 6 && r.on && r.effect === 'exempt' && inside(r, value));
    },
    name(hostname) {
      // Rule 1: lower case, trailing dots removed, then exact names and suffixes.
      let n = hostname.toLowerCase();
      while (n.endsWith('.')) n = n.slice(0, -1);
      return names.includes(n) || suffixes.some((s) => n.endsWith(s));
    },
    describe(family, value) {
      const hits = ranges.filter((r) => r.family === family && value >= r.first && value <= r.last)
        .sort((a, b) => b.prefixLen - a.prefixLen);
      return hits.length === 0 ? '(no range)' : hits.map((r) => `${r.id}${r.on ? '' : ' (off)'}`).join(', ');
    },
  };
}

// ---------------------------------------------------------------------------
// Spellings: one address value, many texts (generator side, also independent)
// ---------------------------------------------------------------------------

export function v4Text(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((s) => String((value >> s) & 0xffn)).join('.');
}

export function v6Groups(value: bigint): number[] {
  const groups: number[] = [];
  for (let i = 7; i >= 0; i--) groups.push(Number((value >> BigInt(i * 16)) & 0xffffn));
  return groups;
}

const hex = (g: number): string => g.toString(16);

/** `groups` written with the zero run [start, end) compressed to '::' (end > start), or uncompressed. */
function join(groups: readonly number[], run?: readonly [number, number], pad = false): string {
  const fmt = (g: number): string => (pad ? hex(g).padStart(4, '0') : hex(g));
  if (run === undefined) return groups.map(fmt).join(':');
  const [start, end] = run;
  return `${groups.slice(0, start).map(fmt).join(':')}::${groups.slice(end).map(fmt).join(':')}`;
}

/** Every [start, end) with groups[start..end) all zero (each a legal '::' placement). */
function zeroRuns(groups: readonly number[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  for (let s = 0; s < groups.length; s++) {
    for (let e = s + 1; e <= groups.length && groups[e - 1] === 0; e++) runs.push([s, e]);
  }
  return runs;
}

/** RFC 5952 §4.2: the first longest run of two or more zero groups becomes '::'. */
export function v6Canonical(value: bigint): string {
  const groups = v6Groups(value);
  let best: [number, number] | undefined;
  for (const [s, e] of zeroRuns(groups)) {
    if (e - s >= 2 && (best === undefined || e - s > best[1] - best[0])) best = [s, e];
  }
  return join(groups, best);
}

/** The last 32 bits as a dotted quad after the first six groups (RFC 4291 §2.2 form 3). */
function dottedTail(groups: readonly number[], run?: readonly [number, number]): string {
  const tail = v4Text(BigInt(groups[6]!) << 16n | BigInt(groups[7]!));
  const head = groups.slice(0, 6);
  if (run === undefined) return `${head.map(hex).join(':')}:${tail}`;
  const text = join(head, run);
  return text.endsWith('::') ? `${text}${tail}` : `${text}:${tail}`;
}

/**
 * Every textual spelling of one IPv6 address this suite checks: canonical, expanded,
 * zero-padded, every legal '::' placement (a single zero group too), and the embedded
 * dotted-quad form with and without each '::' placement in its first six groups.
 * All are valid RFC 4291 text and all are accepted by WHATWG URL inside brackets.
 */
export function v6Spellings(value: bigint): string[] {
  const groups = v6Groups(value);
  const out = new Set<string>([v6Canonical(value), join(groups), join(groups, undefined, true), dottedTail(groups)]);
  for (const run of zeroRuns(groups)) out.add(join(groups, run));
  for (const run of zeroRuns(groups.slice(0, 6))) out.add(dottedTail(groups, run));
  return [...out];
}

/** Upper-cases the characters of `s` whose bit in `mask` is set (cycling through the mask). */
export function mixCase(s: string, mask: readonly boolean[]): string {
  if (mask.length === 0) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) out += mask[i % mask.length] ? s[i]!.toUpperCase() : s[i]!;
  return out;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Address generators biased toward the table's CIDR boundaries (built only when the table is there). */
export function addressArbitraries(ref: Reference) {
  const v4Ranges = ref.ranges.filter((r) => r.family === 4);
  const v6Ranges = ref.ranges.filter((r) => r.family === 6);
  const clamp = (v: bigint, max: bigint): bigint => (v < 0n ? 0n : v > max ? max : v);
  const boundaries = (rs: readonly Range[], max: bigint): bigint[] => {
    const out = new Set<bigint>();
    for (const r of rs) {
      for (const v of [r.first - 1n, r.first, r.first + 1n, r.last - 1n, r.last, r.last + 1n]) out.add(clamp(v, max));
    }
    return [...out];
  };
  const inside = (rs: readonly Range[]) => fc.constantFrom(...rs).chain((r) => fc.bigInt({ min: r.first, max: r.last }));

  const v4Value = fc.oneof(
    fc.constantFrom(...boundaries(v4Ranges, V4_MAX)),
    inside(v4Ranges),
    fc.bigInt({ min: 0n, max: V4_MAX }),
  );

  // Prefixes that carry an IPv4 address in their low 32 bits, plus near misses next to
  // the two matcher prefixes (outside the /96s, so the IPv6 ranges decide there).
  const LOW32_PREFIXES = [
    '::', '::ffff:0:0', '::ffff:0:0:0', '64:ff9b::', '64:ff9b:1::', '64:ff9b::1:0:0', '64:ff9b:0:1::',
    '65:ff9b::', '::1:ffff:0:0', '::fffe:0:0', '::1:0:0', '0:0:0:1::', '2001:db8::', 'fe80::',
  ].map(parseTableV6);
  const sixToFour = fc.tuple(v4Value, fc.bigInt({ min: 0n, max: (1n << 80n) - 1n }))
    .map(([v4, low]) => (0x2002n << 112n) | (v4 << 80n) | low);
  const teredo = fc.tuple(v4Value, fc.bigInt({ min: 0n, max: 0xffffffffn }), v4Value)
    .map(([server, flagsPort, client]) => (0x20010000n << 96n) | (server << 64n) | (flagsPort << 32n) | (client ^ V4_MAX));
  const embedded = fc.oneof(
    fc.tuple(fc.constantFrom(...LOW32_PREFIXES), v4Value).map(([p, v4]) => p | v4),
    sixToFour,
    teredo,
  );
  const v6Value = fc.oneof(
    fc.constantFrom(...boundaries(v6Ranges, V6_MAX)),
    inside(v6Ranges),
    embedded,
    fc.bigInt({ min: 0n, max: V6_MAX }),
  );
  const v4Edges = fc.constantFrom(...v4Ranges.flatMap((r) => [r.first, r.last, clamp(r.last + 1n, V4_MAX)]));
  return { v4Value, v6Value, v4Edges };
}
