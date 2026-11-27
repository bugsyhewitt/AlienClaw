"""GENERATED — do not edit.

Written by policy/gen_python.py from policy/blocklist.v1.json. Edit the JSON and re-run
the generator; tests/test_blocklist_data.py fails when the two disagree. ssrf_guard reads
every block decision from here (no ipaddress.is_* property is consulted). Matching rules
and profiles: policy/README.md.
"""

from __future__ import annotations

from typing import Final

SCHEMA_VERSION: Final = 1
PROFILE: Final = "per-language"
COLUMN: Final = "python"
SOURCE_SHA256: Final = "a8ae1d4fee8fb163c7fbfae2742d5170e57a76566083e7d5282bbeee8201101a"

# Entries not in force for this column and profile: v6-ipv4-mapped, v6-nat64-wkp-decode

# IPv4 rules as (network, netmask) integers. An IPv4 address is blocked when it is in a
# block rule and in no exempt rule.
IPV4_BLOCK: Final[tuple[tuple[int, int], ...]] = (
    (0x00000000, 0xff000000),  # v4-this-network 0.0.0.0/8
    (0x0a000000, 0xff000000),  # v4-rfc1918-10 10.0.0.0/8
    (0x64400000, 0xffc00000),  # v4-cgnat 100.64.0.0/10
    (0x7f000000, 0xff000000),  # v4-loopback 127.0.0.0/8
    (0xa83f8110, 0xffffffff),  # v4-azure-wireserver 168.63.129.16/32
    (0xa9fe0000, 0xffff0000),  # v4-link-local 169.254.0.0/16
    (0xac100000, 0xfff00000),  # v4-rfc1918-172 172.16.0.0/12
    (0xc0000000, 0xffffff00),  # v4-ietf-protocol 192.0.0.0/24
    (0xc0000200, 0xffffff00),  # v4-test-net-1 192.0.2.0/24
    (0xc0a80000, 0xffff0000),  # v4-rfc1918-192 192.168.0.0/16
    (0xc6120000, 0xfffe0000),  # v4-benchmarking 198.18.0.0/15
    (0xc6336400, 0xffffff00),  # v4-test-net-2 198.51.100.0/24
    (0xcb007100, 0xffffff00),  # v4-test-net-3 203.0.113.0/24
    (0xe0000000, 0xf0000000),  # v4-multicast 224.0.0.0/4
    (0xf0000000, 0xf0000000),  # v4-reserved 240.0.0.0/4
)

IPV4_EXEMPT: Final[tuple[tuple[int, int], ...]] = (
    (0xc0000009, 0xffffffff),  # v4-ietf-pcp-anycast 192.0.0.9/32
    (0xc000000a, 0xffffffff),  # v4-ietf-turn-anycast 192.0.0.10/32
)

# IPv4 block rules the ipv4-mapped decode checks: IPV4_BLOCK without v4-azure-wireserver, v4-cgnat
IPV4_BLOCK_FOR_IPV4_MAPPED: Final[tuple[tuple[int, int], ...]] = (
    (0x00000000, 0xff000000),  # v4-this-network 0.0.0.0/8
    (0x0a000000, 0xff000000),  # v4-rfc1918-10 10.0.0.0/8
    (0x7f000000, 0xff000000),  # v4-loopback 127.0.0.0/8
    (0xa9fe0000, 0xffff0000),  # v4-link-local 169.254.0.0/16
    (0xac100000, 0xfff00000),  # v4-rfc1918-172 172.16.0.0/12
    (0xc0000000, 0xffffff00),  # v4-ietf-protocol 192.0.0.0/24
    (0xc0000200, 0xffffff00),  # v4-test-net-1 192.0.2.0/24
    (0xc0a80000, 0xffff0000),  # v4-rfc1918-192 192.168.0.0/16
    (0xc6120000, 0xfffe0000),  # v4-benchmarking 198.18.0.0/15
    (0xc6336400, 0xffffff00),  # v4-test-net-2 198.51.100.0/24
    (0xcb007100, 0xffffff00),  # v4-test-net-3 203.0.113.0/24
    (0xe0000000, 0xf0000000),  # v4-multicast 224.0.0.0/4
    (0xf0000000, 0xf0000000),  # v4-reserved 240.0.0.0/4
)

# IPv6 rules as (network, netmask) integers. An IPv6 address outside every embedded
# matcher (below) is blocked when it is in a block rule and in no exempt rule.
IPV6_BLOCK: Final[tuple[tuple[int, int], ...]] = (
    # v6-ipv4-compatible ::/96
    (0x00000000000000000000000000000000, 0xffffffffffffffffffffffff00000000),
    # v6-ipv4-translated ::ffff:0:0:0/96
    (0x0000000000000000ffff000000000000, 0xffffffffffffffffffffffff00000000),
    # v6-nat64-wkp 64:ff9b::/96
    (0x0064ff9b000000000000000000000000, 0xffffffffffffffffffffffff00000000),
    # v6-nat64-local-use 64:ff9b:1::/48
    (0x0064ff9b000100000000000000000000, 0xffffffffffff00000000000000000000),
    # v6-reserved-0000 ::/8
    (0x00000000000000000000000000000000, 0xff000000000000000000000000000000),
    # v6-reserved-0100 100::/8
    (0x01000000000000000000000000000000, 0xff000000000000000000000000000000),
    # v6-discard 100::/64
    (0x01000000000000000000000000000000, 0xffffffffffffffff0000000000000000),
    # v6-reserved-0200 200::/7
    (0x02000000000000000000000000000000, 0xfe000000000000000000000000000000),
    # v6-reserved-0400 400::/6
    (0x04000000000000000000000000000000, 0xfc000000000000000000000000000000),
    # v6-reserved-0800 800::/5
    (0x08000000000000000000000000000000, 0xf8000000000000000000000000000000),
    # v6-reserved-1000 1000::/4
    (0x10000000000000000000000000000000, 0xf0000000000000000000000000000000),
    # v6-ietf-2001-23 2001::/23
    (0x20010000000000000000000000000000, 0xfffffe00000000000000000000000000),
    # v6-teredo 2001::/32
    (0x20010000000000000000000000000000, 0xffffffff000000000000000000000000),
    # v6-documentation 2001:db8::/32
    (0x20010db8000000000000000000000000, 0xffffffff000000000000000000000000),
    # v6-6to4 2002::/16
    (0x20020000000000000000000000000000, 0xffff0000000000000000000000000000),
    # v6-documentation-3fff 3fff::/20
    (0x3fff0000000000000000000000000000, 0xfffff000000000000000000000000000),
    # v6-reserved-4000 4000::/3
    (0x40000000000000000000000000000000, 0xe0000000000000000000000000000000),
    # v6-reserved-6000 6000::/3
    (0x60000000000000000000000000000000, 0xe0000000000000000000000000000000),
    # v6-reserved-8000 8000::/3
    (0x80000000000000000000000000000000, 0xe0000000000000000000000000000000),
    # v6-reserved-a000 a000::/3
    (0xa0000000000000000000000000000000, 0xe0000000000000000000000000000000),
    # v6-reserved-c000 c000::/3
    (0xc0000000000000000000000000000000, 0xe0000000000000000000000000000000),
    # v6-reserved-e000 e000::/4
    (0xe0000000000000000000000000000000, 0xf0000000000000000000000000000000),
    # v6-reserved-f000 f000::/5
    (0xf0000000000000000000000000000000, 0xf8000000000000000000000000000000),
    # v6-reserved-f800 f800::/6
    (0xf8000000000000000000000000000000, 0xfc000000000000000000000000000000),
    # v6-ula fc00::/7
    (0xfc000000000000000000000000000000, 0xfe000000000000000000000000000000),
    # v6-reserved-fe00 fe00::/9
    (0xfe000000000000000000000000000000, 0xff800000000000000000000000000000),
    # v6-link-local fe80::/10
    (0xfe800000000000000000000000000000, 0xffc00000000000000000000000000000),
    # v6-site-local fec0::/10
    (0xfec00000000000000000000000000000, 0xffc00000000000000000000000000000),
    # v6-multicast ff00::/8
    (0xff000000000000000000000000000000, 0xff000000000000000000000000000000),
)

IPV6_EXEMPT: Final[tuple[tuple[int, int], ...]] = (
    # v6-pcp-anycast 2001:1::1/128
    (0x20010001000000000000000000000001, 0xffffffffffffffffffffffffffffffff),
    # v6-turn-anycast 2001:1::2/128
    (0x20010001000000000000000000000002, 0xffffffffffffffffffffffffffffffff),
    # v6-amt 2001:3::/32
    (0x20010003000000000000000000000000, 0xffffffff000000000000000000000000),
    # v6-as112 2001:4:112::/48
    (0x20010004011200000000000000000000, 0xffffffffffff00000000000000000000),
    # v6-orchidv2 2001:20::/28
    (0x20010020000000000000000000000000, 0xfffffff0000000000000000000000000),
    # v6-drone-det 2001:30::/28
    (0x20010030000000000000000000000000, 0xfffffff0000000000000000000000000),
)

# Embedded-IPv4 matchers, checked before the IPv6 rules, as (matcher, network, netmask,
# mode, IPv4 block rules). mode 'block': the whole prefix is blocked. 'decode': the low
# 32 bits alone decide, against those IPv4 block rules and IPV4_EXEMPT. 'ranges': the
# IPv6 rules decide.
IPV6_EMBEDDED: Final[tuple[tuple[str, int, int, str, tuple[tuple[int, int], ...]], ...]] = (
    # ipv4-mapped ::ffff:0:0/96: decode, from v6-ipv4-mapped-decode
    (
        "ipv4-mapped",
        0x00000000000000000000ffff00000000,
        0xffffffffffffffffffffffff00000000,
        "decode",
        IPV4_BLOCK_FOR_IPV4_MAPPED,
    ),
    # nat64-embedded 64:ff9b::/96: block, from v6-nat64-wkp
    (
        "nat64-embedded",
        0x0064ff9b000000000000000000000000,
        0xffffffffffffffffffffffff00000000,
        "block",
        (),
    ),
)

# True when ipv4-mapped is a decode: _resolve_host_ips then unwraps mapped DNS answers
# to IPv4 before the check (and the IPv4 is what gets dialled).
UNWRAP_IPV4_MAPPED: Final = True

# Host names refused before DNS, after IDNA and with trailing dots removed.
LOOPBACK_NAMES: Final[frozenset[str]] = frozenset({"localhost", "ip6-localhost", "ip6-loopback"})
LOOPBACK_SUFFIXES: Final[tuple[str, ...]] = (".localhost",)
