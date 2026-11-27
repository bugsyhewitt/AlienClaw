#!/usr/bin/env node
/**
 * Generate the TypeScript block-list module from blocklist.v1.json.
 *
 *   node gen-ts.mjs           write ../ts/src/blocklist-data.ts
 *   node gen-ts.mjs --check   write nothing; exit 1 if the committed module differs
 *
 * No dependencies. The resolution (profiles, block / exempt / decode, embedded
 * matchers) is the one gen_python.py implements for the Python package; README.md
 * next to this file documents it. Change both together. gen_python.py also
 * validates the schema in full (tests/test_blocklist_data.py runs it); this
 * script refuses anything it cannot render.
 *
 * Exports render(jsonText), load and resolve for test/blocklist-data.test.ts.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('./blocklist.v1.json', import.meta.url));
const TARGET = fileURLToPath(new URL('../ts/src/blocklist-data.ts', import.meta.url));
const LANG = 'ts';

const SCHEMA_VERSION = 1;
const PROFILES = ['per-language', 'strictest-wins'];
const FAMILIES = ['ipv4', 'ipv6', 'name'];
const EFFECTS = ['block', 'exempt', 'decode'];
// Embedded-IPv4 matchers, in evaluation order (same table as gen_python.py MATCHERS).
const MATCHERS = [['ipv4-mapped', '::ffff:0:0/96'], ['nat64-embedded', '64:ff9b::/96']];

function fail(message) {
  throw new Error(`blocklist.v1.json: ${message}`);
}

/** [network, netmask, bits] for a CIDR; IPv6 uses plain lower-case hex groups only. */
function parseCidr(cidr, family) {
  if (typeof cidr !== 'string') fail(`bad cidr ${JSON.stringify(cidr)}`);
  const slash = cidr.indexOf('/');
  const addr = cidr.slice(0, slash);
  const prefixText = cidr.slice(slash + 1);
  if (slash < 0 || !/^\d{1,3}$/.test(prefixText)) fail(`bad cidr ${cidr}`);
  const prefix = Number(prefixText);
  let value;
  let bits;
  if (family === 'ipv4') {
    bits = 32;
    const parts = addr.split('.');
    if (parts.length !== 4 || !parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255)) {
      fail(`bad IPv4 cidr ${cidr}`);
    }
    value = parts.reduce((acc, p) => (acc << 8n) | BigInt(p), 0n);
  } else if (family === 'ipv6') {
    bits = 128;
    if (!/^[0-9a-f:]+$/.test(addr)) fail(`bad IPv6 cidr ${cidr} (lower-case hex groups only)`);
    const halves = addr.split('::');
    if (halves.length > 2) fail(`bad IPv6 cidr ${cidr}`);
    const groups = (s) => (s === '' ? [] : s.split(':'));
    const head = groups(halves[0]);
    const tail = halves.length === 2 ? groups(halves[1]) : [];
    const fill = 8 - head.length - tail.length;
    if ((halves.length === 2 ? fill < 1 : fill !== 0) ||
        ![...head, ...tail].every((g) => /^[0-9a-f]{1,4}$/.test(g))) {
      fail(`bad IPv6 cidr ${cidr}`);
    }
    const all = [...head, ...new Array(fill).fill('0'), ...tail];
    value = all.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g, 16)), 0n);
  } else {
    fail(`cidr on family ${family}`);
  }
  if (prefix > bits) fail(`bad prefix in ${cidr}`);
  const full = (1n << BigInt(bits)) - 1n;
  const mask = (full << BigInt(bits - prefix)) & full;
  if ((value & ~mask & full) !== 0n) fail(`host bits set in ${cidr}`);
  return [value, mask, bits];
}

export function load(text) {
  const doc = JSON.parse(text);
  const keys = Object.keys(doc ?? {});
  if (keys.join() !== 'schema_version,profile,description,entries') fail('unexpected top-level keys');
  if (doc.schema_version !== SCHEMA_VERSION) fail(`schema_version must be ${SCHEMA_VERSION}`);
  if (!PROFILES.includes(doc.profile)) fail(`profile must be one of ${PROFILES.join(', ')}`);
  if (!Array.isArray(doc.entries) || doc.entries.length === 0) fail('entries must be a non-empty list');
  for (const e of doc.entries) {
    if (!FAMILIES.includes(e.family) || !EFFECTS.includes(e.effect)) fail(`entry ${e.id}: family/effect`);
    if (typeof e.applies?.python !== 'boolean' || typeof e.applies?.ts !== 'boolean') {
      fail(`entry ${e.id}: applies must be {python: bool, ts: bool}`);
    }
    if (e.family !== 'name') parseCidr(e.cidr, e.family);
    if (e.effect === 'decode' && !MATCHERS.some(([m, c]) => m === e.matcher && c === e.cidr)) {
      fail(`entry ${e.id}: decode needs a known matcher and its cidr`);
    }
  }
  return doc;
}

/** Same rule as gen_python.is_on. */
function isOn(entry, lang, profile) {
  const { applies } = entry;
  if (profile === 'per-language') return applies[lang];
  if (entry.effect === 'exempt') return applies.python && applies.ts;
  return applies.python || applies.ts;
}

/** Same rule as gen_python.excluded. */
function excluded(entry, lang, profile) {
  const ex = entry.decode_excludes ?? {};
  if (profile === 'per-language') return new Set(ex[lang] ?? []);
  const ts = new Set(ex.ts ?? []);
  return new Set((ex.python ?? []).filter((id) => ts.has(id)));
}

/** Same result as gen_python.resolve. */
export function resolve(doc, lang) {
  const { profile, entries } = doc;
  const on = entries.filter((e) => isOn(e, lang, profile));
  const rules = (family, effect) => on
    .filter((e) => e.family === family && e.effect === effect)
    .map((e) => {
      const [network, netmask] = parseCidr(e.cidr, family);
      return { id: e.id, cidr: e.cidr, network, netmask };
    });
  const ipv4Block = rules('ipv4', 'block');
  const ipv6Block = rules('ipv6', 'block');
  const embedded = MATCHERS.map(([matcher, cidr]) => {
    const [network, netmask] = parseCidr(cidr, 'ipv6');
    const whole = ipv6Block.filter((r) => r.network === network && r.netmask === netmask).map((r) => r.id);
    const decode = on.filter((e) => e.effect === 'decode' && e.matcher === matcher);
    const skip = decode.length > 0 ? excluded(decode[0], lang, profile) : new Set();
    const mode = whole.length > 0 ? 'block' : decode.length > 0 ? 'decode' : 'ranges';
    return {
      matcher, cidr, network, netmask, mode,
      why: whole.length > 0 ? whole : decode.length > 0 ? [decode[0].id] : [],
      skip: [...skip].sort(),
      ipv4Block: mode === 'decode' ? ipv4Block.filter((r) => !skip.has(r.id)) : [],
    };
  });
  return {
    profile,
    off: entries.filter((e) => !isOn(e, lang, profile)).map((e) => e.id),
    ipv4Block,
    ipv4Exempt: rules('ipv4', 'exempt'),
    ipv6Block,
    ipv6Exempt: rules('ipv6', 'exempt'),
    embedded,
    names: on.filter((e) => e.family === 'name' && e.name !== undefined).map((e) => e.name),
    suffixes: on.filter((e) => e.family === 'name' && e.name_suffix !== undefined).map((e) => e.name_suffix),
  };
}

const MAX_LINE = 120;

function wrap(prefix, words, indent = '') {
  const lines = [];
  let line = `${indent}// ${prefix}`;
  words.forEach((word, i) => {
    const piece = word + (i < words.length - 1 ? ',' : '');
    if (line.length + 1 + piece.length > MAX_LINE) {
      lines.push(line);
      line = `${indent}//  `;
    }
    line += ` ${piece}`;
  });
  lines.push(line);
  return lines;
}

const hex = (value, bits) => `0x${value.toString(16).padStart(bits / 4, '0')}`;

/** The module text for policy JSON `text` (deterministic: same input, same bytes). */
export function render(text) {
  const doc = load(text);
  const t = resolve(doc, LANG);
  const sha = createHash('sha256').update(text, 'utf8').digest('hex');
  const out = [
    '// GENERATED — do not edit.',
    '//',
    '// Written by policy/gen-ts.mjs from policy/blocklist.v1.json. Edit the JSON and re-run the',
    '// generator; test/blocklist-data.test.ts fails when the two disagree. hardened-fetch.ts reads',
    '// every block decision from here. Matching rules and profiles: policy/README.md.',
    '',
    `export const SCHEMA_VERSION = ${doc.schema_version};`,
    `export const PROFILE = '${t.profile}';`,
    `export const COLUMN = '${LANG}';`,
    `export const SOURCE_SHA256 = '${sha}';`,
    '',
    ...wrap('Entries not in force for this column and profile:', t.off.length > 0 ? t.off : ['(none)']),
    '',
    '/** [network, netmask] of an IPv4 rule, as unsigned 32-bit integers. */',
    'export type Ipv4Rule = readonly [network: number, netmask: number];',
    '/** [network, netmask] of an IPv6 rule, as 128-bit integers. */',
    'export type Ipv6Rule = readonly [network: bigint, netmask: bigint];',
    '/**',
    " * An embedded-IPv4 matcher. mode 'block': the whole prefix is blocked. 'decode': the low 32",
    " * bits alone decide, against ipv4Block and IPV4_EXEMPT. 'ranges': the IPv6 rules decide.",
    ' */',
    'export interface EmbeddedRule {',
    '  readonly matcher: string;',
    '  readonly network: bigint;',
    '  readonly netmask: bigint;',
    "  readonly mode: 'block' | 'decode' | 'ranges';",
    '  readonly ipv4Block: readonly Ipv4Rule[];',
    '}',
    '',
  ];
  const table = (name, type, rows, bits, docLines) => {
    out.push(...docLines);
    if (rows.length === 0) {
      out.push(`export const ${name}: readonly ${type}[] = [];`, '');
      return;
    }
    out.push(`export const ${name}: readonly ${type}[] = [`);
    const n = bits === 128 ? 'n' : '';
    for (const r of rows) {
      out.push(`  [${hex(r.network, bits)}${n}, ${hex(r.netmask, bits)}${n}],  // ${r.id} ${r.cidr}`);
    }
    out.push('];', '');
  };
  table('IPV4_BLOCK', 'Ipv4Rule', t.ipv4Block, 32, [
    '/** IPv4: blocked when in a block rule and in no exempt rule. */',
  ]);
  table('IPV4_EXEMPT', 'Ipv4Rule', t.ipv4Exempt, 32, []);
  const decodeTables = new Map();
  for (const m of t.embedded) {
    if (m.mode === 'decode' && m.skip.length > 0) {
      const name = `IPV4_BLOCK_FOR_${m.matcher.toUpperCase().replace(/-/g, '_')}`;
      decodeTables.set(m.matcher, name);
      table(name, 'Ipv4Rule', m.ipv4Block, 32,
        wrap(`IPv4 block rules the ${m.matcher} decode checks: IPV4_BLOCK without`, m.skip));
    }
  }
  table('IPV6_BLOCK', 'Ipv6Rule', t.ipv6Block, 128, [
    '/** IPv6 outside every embedded matcher: blocked when in a block rule and in no exempt rule. */',
  ]);
  table('IPV6_EXEMPT', 'Ipv6Rule', t.ipv6Exempt, 128, []);
  out.push('/** Embedded-IPv4 matchers, checked before the IPv6 rules. */');
  out.push('export const IPV6_EMBEDDED: readonly EmbeddedRule[] = [');
  for (const m of t.embedded) {
    const v4 = m.mode === 'decode' ? (decodeTables.get(m.matcher) ?? 'IPV4_BLOCK') : '[]';
    out.push(...wrap(`${m.matcher} ${m.cidr}: ${m.mode}, from`, m.why.length > 0 ? m.why : ['(no entry)'], '  '));
    out.push(
      '  {',
      `    matcher: '${m.matcher}',`,
      `    network: ${hex(m.network, 128)}n,`,
      `    netmask: ${hex(m.netmask, 128)}n,`,
      `    mode: '${m.mode}',`,
      `    ipv4Block: ${v4},`,
      '  },',
    );
  }
  out.push(
    '];',
    '',
    '/** Host names refused before DNS, lower case, with trailing dots removed. */',
    `export const LOOPBACK_NAMES: ReadonlySet<string> = new Set([${t.names.map((s) => `'${s}'`).join(', ')}]);`,
    `export const LOOPBACK_SUFFIXES: readonly string[] = [${t.suffixes.map((s) => `'${s}'`).join(', ')}];`,
  );
  const result = `${out.join('\n')}\n`;
  const tooLong = result.split('\n').filter((line) => line.length > MAX_LINE);
  if (tooLong.length > 0) fail(`generated lines over ${MAX_LINE} characters: ${tooLong.join(' | ')}`);
  return result;
}

function main(argv) {
  const check = argv.includes('--check');
  const wanted = render(readFileSync(SOURCE, 'utf8'));
  const current = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : undefined;
  if (check) {
    if (current !== wanted) {
      process.stderr.write(`${TARGET} is out of date: run policy/gen-ts.mjs\n`);
      return 1;
    }
    return 0;
  }
  if (current !== wanted) {
    writeFileSync(TARGET, wanted, 'utf8');
    process.stdout.write(`wrote ${TARGET}\n`);
  }
  return 0;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolvePath(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
