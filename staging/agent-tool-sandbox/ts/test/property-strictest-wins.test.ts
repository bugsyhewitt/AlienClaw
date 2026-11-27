/**
 * Property 1 again, under the OTHER profile: what the classifier would do if gate G3
 * switched policy/blocklist.v1.json to "strictest-wins" (policy/README.md "How G3 gets
 * decided"). src/blocklist-data.ts is replaced, through vi.mock, by the table
 * policy/gen-ts.mjs resolves for that profile (its own `load` and `resolve`, as
 * test/blocklist-data.test.ts uses them), and the verdicts are compared with the
 * independent reference of test/reference-blocklist.ts reading the same JSON with the
 * profile switched. So this checks the generator's profile logic and the classifier's
 * use of it before anyone flips the switch. The committed table is untouched.
 *
 * Deterministic (fixed seeds), network-free (no fetch here at all).
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';

vi.mock('../src/blocklist-data.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/blocklist-data.js')>();
  const { existsSync, readFileSync } = await import('node:fs');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const generator = fileURLToPath(new URL('../../policy/gen-ts.mjs', import.meta.url));
  const source = fileURLToPath(new URL('../../policy/blocklist.v1.json', import.meta.url));
  if (!existsSync(generator) || !existsSync(source)) return original;
  type Rule = { network: bigint; netmask: bigint };
  type Resolved = {
    ipv4Block: Rule[]; ipv4Exempt: Rule[]; ipv6Block: Rule[]; ipv6Exempt: Rule[]; names: string[]; suffixes: string[];
    embedded: Array<Rule & { matcher: string; mode: 'block' | 'decode' | 'ranges'; ipv4Block: Rule[] }>;
  };
  const { load, resolve } = (await import(pathToFileURL(generator).href)) as {
    load(text: string): unknown;
    resolve(doc: unknown, lang: 'ts'): Resolved;
  };
  const doc = JSON.parse(readFileSync(source, 'utf8')) as { profile: string };
  doc.profile = 'strictest-wins';
  const t = resolve(load(JSON.stringify(doc)), 'ts');
  const v4 = (rules: Rule[]) => rules.map((r) => [Number(r.network), Number(r.netmask)] as const);
  const v6 = (rules: Rule[]) => rules.map((r) => [r.network, r.netmask] as const);
  return {
    ...original,
    PROFILE: 'strictest-wins',
    IPV4_BLOCK: v4(t.ipv4Block),
    IPV4_EXEMPT: v4(t.ipv4Exempt),
    IPV6_BLOCK: v6(t.ipv6Block),
    IPV6_EXEMPT: v6(t.ipv6Exempt),
    IPV6_EMBEDDED: t.embedded.map((e) => ({
      matcher: e.matcher, network: e.network, netmask: e.netmask, mode: e.mode, ipv4Block: v4(e.ipv4Block),
    })),
    LOOPBACK_NAMES: new Set(t.names),
    LOOPBACK_SUFFIXES: t.suffixes,
  };
});

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as data from '../src/blocklist-data.js';
import { isBlockedHost, validateResolvedAddresses } from '../src/index.js';
import {
  HAVE_POLICY, POLICY_SOURCE, addressArbitraries, loadReference, parseTableV6,
  v4Text, v6Canonical, v6Spellings, type Reference,
} from './reference-blocklist.js';

const SEED = 0x57_1c7e;
const GENERATOR = fileURLToPath(new URL('../../policy/gen-ts.mjs', import.meta.url));

const blocked = (address: string, family: number): boolean => {
  try { validateResolvedAddresses([{ address, family }]); return false; } catch { return true; }
};

describe.skipIf(!HAVE_POLICY || !existsSync(GENERATOR))('property: under strictest-wins the classifier matches the reference too', () => {
  let ref!: Reference;
  let v4Value!: fc.Arbitrary<bigint>;
  let v6Value!: fc.Arbitrary<bigint>;
  beforeAll(() => {
    const doc = JSON.parse(readFileSync(POLICY_SOURCE, 'utf8')) as { profile: string };
    doc.profile = 'strictest-wins';
    ref = loadReference('ts', JSON.stringify(doc));
    ({ v4Value, v6Value } = addressArbitraries(ref));
  });

  it('the switched table is in force (README: every move is allow -> block)', () => {
    expect(data.PROFILE).toBe('strictest-wins');
    expect(ref.profile).toBe('strictest-wins');
    // g1 192.0.0.9 (exemption off), g2 TEST-NET, g3 mapped public, g4 NAT64 public, g8, g9, g10, g12.
    for (const host of ['192.0.0.9', '192.0.2.1', '[::ffff:808:808]', '[64:ff9b::808:808]', '[2001:2::1]', '[2001:db8::1]',
      '[100::1]', '[4000::1]']) {
      expect(isBlockedHost(host), host).toBe(true);
    }
    // Both columns still allow these (DIFFERENCES.md "Both languages allow").
    for (const host of ['8.8.8.8', '192.88.99.1', '[2001:1::1]', '[2606:4700::1111]']) expect(isBlockedHost(host), host).toBe(false);
  });

  it('IPv4: isBlockedHost and validateResolvedAddresses give the reference verdict', () => {
    fc.assert(fc.property(v4Value, (v) => {
      const text = v4Text(v);
      const expected = ref.v4(v);
      expect(isBlockedHost(text), `${text} (${ref.describe(4, v)})`).toBe(expected);
      expect(blocked(text, 4), text).toBe(expected);
    }), { seed: SEED, numRuns: 4_000 });
  });

  it('IPv6: canonical, bracketed and one other spelling give the reference verdict', () => {
    fc.assert(fc.property(v6Value, fc.nat(), (v, pick) => {
      const expected = ref.v6(v);
      const canonical = v6Canonical(v);
      const spellings = v6Spellings(v);
      const other = spellings[pick % spellings.length]!;
      const where = `${canonical} (${ref.describe(6, v)})`;
      expect([isBlockedHost(`[${canonical}]`), isBlockedHost(other), blocked(canonical, 6), blocked(other, 6)], where)
        .toEqual([expected, expected, expected, expected]);
    }), {
      seed: SEED + 1,
      numRuns: 4_000,
      examples: ['::ffff:808:808', '64:ff9b::808:808', '64:ff9b::1:0:0', '2001:1::1', '2001:1::3', '2001:3::', '2001:4:112::1',
        '2001:20::', '2001:2f::', '2001:30::', '100::', 'fe00::', '3fff::'].map((t) => [parseTableV6(t), 0] as [bigint, number]),
    });
  });

  it('names are the same under both profiles', () => {
    const base = loadReference('ts');
    for (const host of ['localhost', 'localhost.', 'a.localhost', 'ip6-localhost', 'ip6-loopback', 'x.ip6-localhost', 'localhost.a']) {
      expect(isBlockedHost(host), host).toBe(ref.name(host));
      expect(ref.name(host), host).toBe(base.name(host));
    }
  });
});
