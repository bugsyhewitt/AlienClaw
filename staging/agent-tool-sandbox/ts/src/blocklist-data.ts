// GENERATED — do not edit.
//
// Written by policy/gen-ts.mjs from policy/blocklist.v1.json. Edit the JSON and re-run the
// generator; test/blocklist-data.test.ts fails when the two disagree. hardened-fetch.ts reads
// every block decision from here. Matching rules and profiles: policy/README.md.

export const SCHEMA_VERSION = 1;
export const PROFILE = 'per-language';
export const COLUMN = 'ts';
export const SOURCE_SHA256 = 'a8ae1d4fee8fb163c7fbfae2742d5170e57a76566083e7d5282bbeee8201101a';

// Entries not in force for this column and profile: v4-ietf-pcp-anycast, v4-ietf-turn-anycast, v4-test-net-1,
//   v4-test-net-2, v4-test-net-3, v6-ipv4-mapped-decode, v6-nat64-wkp, v6-reserved-0000, v6-reserved-0100, v6-discard,
//   v6-reserved-0200, v6-reserved-0400, v6-reserved-0800, v6-reserved-1000, v6-ietf-2001-23, v6-documentation,
//   v6-documentation-3fff, v6-reserved-4000, v6-reserved-6000, v6-reserved-8000, v6-reserved-a000, v6-reserved-c000,
//   v6-reserved-e000, v6-reserved-f000, v6-reserved-f800, v6-reserved-fe00

/** [network, netmask] of an IPv4 rule, as unsigned 32-bit integers. */
export type Ipv4Rule = readonly [network: number, netmask: number];
/** [network, netmask] of an IPv6 rule, as 128-bit integers. */
export type Ipv6Rule = readonly [network: bigint, netmask: bigint];
/**
 * An embedded-IPv4 matcher. mode 'block': the whole prefix is blocked. 'decode': the low 32
 * bits alone decide, against ipv4Block and IPV4_EXEMPT. 'ranges': the IPv6 rules decide.
 */
export interface EmbeddedRule {
  readonly matcher: string;
  readonly network: bigint;
  readonly netmask: bigint;
  readonly mode: 'block' | 'decode' | 'ranges';
  readonly ipv4Block: readonly Ipv4Rule[];
}

/** IPv4: blocked when in a block rule and in no exempt rule. */
export const IPV4_BLOCK: readonly Ipv4Rule[] = [
  [0x00000000, 0xff000000],  // v4-this-network 0.0.0.0/8
  [0x0a000000, 0xff000000],  // v4-rfc1918-10 10.0.0.0/8
  [0x64400000, 0xffc00000],  // v4-cgnat 100.64.0.0/10
  [0x7f000000, 0xff000000],  // v4-loopback 127.0.0.0/8
  [0xa83f8110, 0xffffffff],  // v4-azure-wireserver 168.63.129.16/32
  [0xa9fe0000, 0xffff0000],  // v4-link-local 169.254.0.0/16
  [0xac100000, 0xfff00000],  // v4-rfc1918-172 172.16.0.0/12
  [0xc0000000, 0xffffff00],  // v4-ietf-protocol 192.0.0.0/24
  [0xc0a80000, 0xffff0000],  // v4-rfc1918-192 192.168.0.0/16
  [0xc6120000, 0xfffe0000],  // v4-benchmarking 198.18.0.0/15
  [0xe0000000, 0xf0000000],  // v4-multicast 224.0.0.0/4
  [0xf0000000, 0xf0000000],  // v4-reserved 240.0.0.0/4
];

export const IPV4_EXEMPT: readonly Ipv4Rule[] = [];

/** IPv6 outside every embedded matcher: blocked when in a block rule and in no exempt rule. */
export const IPV6_BLOCK: readonly Ipv6Rule[] = [
  [0x00000000000000000000000000000000n, 0xffffffffffffffffffffffff00000000n],  // v6-ipv4-compatible ::/96
  [0x00000000000000000000ffff00000000n, 0xffffffffffffffffffffffff00000000n],  // v6-ipv4-mapped ::ffff:0:0/96
  [0x0000000000000000ffff000000000000n, 0xffffffffffffffffffffffff00000000n],  // v6-ipv4-translated ::ffff:0:0:0/96
  [0x0064ff9b000100000000000000000000n, 0xffffffffffff00000000000000000000n],  // v6-nat64-local-use 64:ff9b:1::/48
  [0x20010000000000000000000000000000n, 0xffffffff000000000000000000000000n],  // v6-teredo 2001::/32
  [0x20020000000000000000000000000000n, 0xffff0000000000000000000000000000n],  // v6-6to4 2002::/16
  [0xfc000000000000000000000000000000n, 0xfe000000000000000000000000000000n],  // v6-ula fc00::/7
  [0xfe800000000000000000000000000000n, 0xffc00000000000000000000000000000n],  // v6-link-local fe80::/10
  [0xfec00000000000000000000000000000n, 0xffc00000000000000000000000000000n],  // v6-site-local fec0::/10
  [0xff000000000000000000000000000000n, 0xff000000000000000000000000000000n],  // v6-multicast ff00::/8
];

export const IPV6_EXEMPT: readonly Ipv6Rule[] = [
  [0x20010001000000000000000000000001n, 0xffffffffffffffffffffffffffffffffn],  // v6-pcp-anycast 2001:1::1/128
  [0x20010001000000000000000000000002n, 0xffffffffffffffffffffffffffffffffn],  // v6-turn-anycast 2001:1::2/128
  [0x20010003000000000000000000000000n, 0xffffffff000000000000000000000000n],  // v6-amt 2001:3::/32
  [0x20010004011200000000000000000000n, 0xffffffffffff00000000000000000000n],  // v6-as112 2001:4:112::/48
  [0x20010020000000000000000000000000n, 0xfffffff0000000000000000000000000n],  // v6-orchidv2 2001:20::/28
  [0x20010030000000000000000000000000n, 0xfffffff0000000000000000000000000n],  // v6-drone-det 2001:30::/28
];

/** Embedded-IPv4 matchers, checked before the IPv6 rules. */
export const IPV6_EMBEDDED: readonly EmbeddedRule[] = [
  // ipv4-mapped ::ffff:0:0/96: block, from v6-ipv4-mapped
  {
    matcher: 'ipv4-mapped',
    network: 0x00000000000000000000ffff00000000n,
    netmask: 0xffffffffffffffffffffffff00000000n,
    mode: 'block',
    ipv4Block: [],
  },
  // nat64-embedded 64:ff9b::/96: decode, from v6-nat64-wkp-decode
  {
    matcher: 'nat64-embedded',
    network: 0x0064ff9b000000000000000000000000n,
    netmask: 0xffffffffffffffffffffffff00000000n,
    mode: 'decode',
    ipv4Block: IPV4_BLOCK,
  },
];

/** Host names refused before DNS, lower case, with trailing dots removed. */
export const LOOPBACK_NAMES: ReadonlySet<string> = new Set(['localhost', 'ip6-localhost', 'ip6-loopback']);
export const LOOPBACK_SUFFIXES: readonly string[] = ['.localhost'];
