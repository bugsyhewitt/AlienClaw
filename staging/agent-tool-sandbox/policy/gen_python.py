#!/usr/bin/env python3
"""Generate the Python block-list module from blocklist.v1.json.

    python3 gen_python.py           write ../python/src/agent_tool_sandbox/_blocklist_data.py
    python3 gen_python.py --check   write nothing; exit 1 if the committed module differs

Stdlib only. ``ipaddress`` is used to PARSE the CIDRs, never to classify an address: every
decision the guard makes comes from the rules this script writes. The semantics (profiles,
block / exempt / decode, embedded matchers) are in README.md next to this file, and
gen-ts.mjs implements the same resolution for the TypeScript package. Change both together.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import re
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "blocklist.v1.json"
TARGET = HERE.parent / "python" / "src" / "agent_tool_sandbox" / "_blocklist_data.py"
LANG = "python"

SCHEMA_VERSION = 1
LANGS = ("python", "ts")
PROFILES = ("per-language", "strictest-wins")
FAMILIES = ("ipv4", "ipv6", "name")
EFFECTS = ("block", "exempt", "decode")
# Embedded-IPv4 matchers, in evaluation order: name -> the prefix it applies to. Both embed
# the IPv4 in the low 32 bits (RFC 4291 §2.5.5.2; RFC 6052 §2.1, the /96 format).
MATCHERS = {"ipv4-mapped": "::ffff:0:0/96", "nat64-embedded": "64:ff9b::/96"}
TOP_KEYS = ("schema_version", "profile", "description", "entries")
ENTRY_KEYS = frozenset({
    "id", "family", "effect", "cidr", "name", "name_suffix", "matcher", "decode_excludes",
    "rationale", "refs", "applies",
})
REQUIRED_KEYS = ("id", "family", "effect", "rationale", "refs", "applies")
ID_PATTERN = re.compile(r"[a-z0-9][a-z0-9.-]*[a-z0-9]")
NAME_PATTERN = re.compile(r"[a-z0-9][a-z0-9.-]*")
MAX_LINE = 100


class PolicyError(ValueError):
    """blocklist.v1.json breaks the schema; the message lists every problem."""


def _no_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise PolicyError(f"duplicate key {key!r}")
        out[key] = value
    return out


def _network(cidr: object, family: str) -> ipaddress.IPv4Network | ipaddress.IPv6Network:
    """Parse a CIDR the way gen-ts.mjs does: strict, plain hex groups for IPv6 (no dots)."""
    if not isinstance(cidr, str) or "/" not in cidr:
        raise ValueError("cidr must be a string 'address/prefix'")
    if family == "ipv6" and not re.fullmatch(r"[0-9a-f:]+/[0-9]{1,3}", cidr):
        raise ValueError("an IPv6 cidr uses lower-case hex groups only (no dotted IPv4 tail)")
    if family == "ipv4" and not re.fullmatch(r"[0-9.]+/[0-9]{1,2}", cidr):
        raise ValueError("an IPv4 cidr is dotted decimal")
    net = ipaddress.ip_network(cidr, strict=True)  # host bits set -> ValueError
    if net.version != (4 if family == "ipv4" else 6):
        raise ValueError(f"cidr is not {family}")
    return net


def load(text: str) -> dict[str, Any]:
    """Parse and validate the policy. Raises PolicyError listing every problem."""
    try:
        doc = json.loads(text, object_pairs_hook=_no_duplicate_keys)
    except json.JSONDecodeError as exc:
        raise PolicyError(f"not JSON: {exc}") from None
    problems: list[str] = []
    if not isinstance(doc, dict) or tuple(doc) != TOP_KEYS:
        raise PolicyError(f"top level must be an object with exactly the keys {TOP_KEYS}, in order")
    if doc["schema_version"] != SCHEMA_VERSION:
        problems.append(f"schema_version must be {SCHEMA_VERSION}")
    if doc["profile"] not in PROFILES:
        problems.append(f"profile must be one of {PROFILES}")
    if not isinstance(doc["description"], str):
        problems.append("description must be a string")
    entries = doc["entries"]
    if not isinstance(entries, list) or not entries:
        raise PolicyError("entries must be a non-empty list")
    seen_ids: set[str] = set()
    seen_rules: set[tuple[str, str, str]] = set()
    decoders: set[str] = set()
    ipv4_block_ids = {
        e.get("id") for e in entries
        if isinstance(e, dict) and e.get("family") == "ipv4" and e.get("effect") == "block"
    }
    matcher_nets = {m: ipaddress.ip_network(c) for m, c in MATCHERS.items()}
    for index, e in enumerate(entries):
        where = f"entries[{index}]"
        if not isinstance(e, dict):
            problems.append(f"{where}: not an object")
            continue
        where = f"entries[{index}] ({e.get('id')!r})"
        unknown = set(e) - ENTRY_KEYS
        missing = [k for k in REQUIRED_KEYS if k not in e]
        if unknown or missing:
            problems.append(f"{where}: unknown keys {sorted(unknown)}, missing {missing}")
            continue
        eid, family, effect = e["id"], e["family"], e["effect"]
        if not isinstance(eid, str) or not ID_PATTERN.fullmatch(eid):
            problems.append(f"{where}: id must match {ID_PATTERN.pattern}")
        elif eid in seen_ids:
            problems.append(f"{where}: duplicate id")
        seen_ids.add(eid)
        if family not in FAMILIES or effect not in EFFECTS:
            problems.append(f"{where}: family must be one of {FAMILIES}, effect one of {EFFECTS}")
            continue
        applies = e["applies"]
        if (not isinstance(applies, dict) or tuple(sorted(applies)) != LANGS
                or not all(isinstance(applies[k], bool) for k in LANGS)):
            problems.append(f"{where}: applies must be {{\"python\": bool, \"ts\": bool}}")
        if not isinstance(e["rationale"], str) or not e["rationale"].strip():
            problems.append(f"{where}: rationale must be a non-empty string")
        refs = e["refs"]
        if not isinstance(refs, list) or not refs or not all(
            isinstance(r, str) and r.strip() for r in refs
        ):
            problems.append(f"{where}: refs must be a non-empty list of strings")
        if family == "name":
            keys = [k for k in ("name", "name_suffix") if k in e]
            stray = {"cidr", "matcher", "decode_excludes"} & set(e)
            if effect != "block" or len(keys) != 1 or stray:
                problems.append(f"{where}: a name entry is a block with exactly one of name, "
                                "name_suffix")
                continue
            value = e[keys[0]]
            body = value[1:] if keys[0] == "name_suffix" and isinstance(value, str) else value
            if (not isinstance(value, str) or not NAME_PATTERN.fullmatch(body or "")
                    or (keys[0] == "name_suffix" and not value.startswith("."))):
                problems.append(f"{where}: {keys[0]} must be a lower-case DNS name"
                                + (" starting with '.'" if keys[0] == "name_suffix" else ""))
            rule = (family, keys[0], value)
            if rule in seen_rules:
                problems.append(f"{where}: duplicate rule")
            seen_rules.add(rule)
            continue
        if {"name", "name_suffix"} & set(e):
            problems.append(f"{where}: name / name_suffix belong to family 'name'")
        try:
            net = _network(e.get("cidr"), family)
        except ValueError as exc:
            problems.append(f"{where}: bad cidr {e.get('cidr')!r}: {exc}")
            continue
        if effect == "decode":
            matcher = e.get("matcher")
            if family != "ipv6" or matcher not in MATCHERS or net != matcher_nets[matcher]:
                problems.append(f"{where}: a decode entry is ipv6 with matcher in "
                                f"{sorted(MATCHERS)} and that matcher's cidr {MATCHERS}")
                continue
            if matcher in decoders:
                problems.append(f"{where}: second decode entry for matcher {matcher!r}")
            decoders.add(matcher)
            excludes = e.get("decode_excludes", {})
            if (not isinstance(excludes, dict) or not set(excludes) <= set(LANGS)
                    or not all(isinstance(v, list) and set(v) <= ipv4_block_ids
                               for v in excludes.values())):
                problems.append(f"{where}: decode_excludes must map python/ts to lists of "
                                "ipv4 block entry ids")
        elif "matcher" in e or "decode_excludes" in e:
            problems.append(f"{where}: matcher / decode_excludes belong to decode entries")
        if family == "ipv6" and effect != "decode":
            for matcher, mnet in matcher_nets.items():
                if net != mnet and net.subnet_of(mnet):
                    problems.append(f"{where}: inside the {matcher} prefix only the whole "
                                    "prefix may be listed; list the IPv4 range instead")
        rule = (family, effect, str(net))
        if rule in seen_rules:
            problems.append(f"{where}: duplicate rule {rule}")
        seen_rules.add(rule)
    if problems:
        raise PolicyError("\n".join(problems))
    return doc


def is_on(entry: dict[str, Any], lang: str, profile: str) -> bool:
    """Whether an entry is in force for ``lang``. strictest-wins: a block or decode entry is
    on if EITHER column is true; an exemption only if BOTH are (so no exemption survives
    that one language does not grant)."""
    applies = entry["applies"]
    if profile == "per-language":
        return applies[lang]
    if entry["effect"] == "exempt":
        return applies["python"] and applies["ts"]
    return applies["python"] or applies["ts"]


def excluded(entry: dict[str, Any], lang: str, profile: str) -> set[str]:
    """IPv4 block ids a decode entry skips. strictest-wins skips only what both skip."""
    ex = entry.get("decode_excludes", {})
    if profile == "per-language":
        return set(ex.get(lang, ()))
    return set(ex.get("python", ())) & set(ex.get("ts", ()))


def resolve(doc: dict[str, Any], lang: str) -> dict[str, Any]:
    """The rules ``lang`` enforces under the document's profile."""
    profile = doc["profile"]
    entries = doc["entries"]
    on = [e for e in entries if is_on(e, lang, profile)]

    def rules(family: str, effect: str) -> list[tuple[str, str, int, int]]:
        out = []
        for e in on:
            if e["family"] == family and e["effect"] == effect:
                net = ipaddress.ip_network(e["cidr"])
                out.append((e["id"], e["cidr"], int(net.network_address), int(net.netmask)))
        return out

    ipv4_block = rules("ipv4", "block")
    ipv6_block = rules("ipv6", "block")
    embedded = []
    for matcher, prefix in MATCHERS.items():
        net = ipaddress.ip_network(prefix)
        whole = [r[0] for r in ipv6_block if ipaddress.ip_network(r[1]) == net]
        decode = [e for e in on if e["effect"] == "decode" and e["matcher"] == matcher]
        skip = excluded(decode[0], lang, profile) if decode else set()
        mode = "block" if whole else "decode" if decode else "ranges"
        embedded.append({
            "matcher": matcher,
            "cidr": prefix,
            "network": int(net.network_address),
            "netmask": int(net.netmask),
            "mode": mode,
            "why": whole if whole else [decode[0]["id"]] if decode else [],
            "skip": sorted(skip),
            "ipv4_block": [r for r in ipv4_block if r[0] not in skip] if mode == "decode" else [],
        })
    return {
        "profile": profile,
        "off": [e["id"] for e in entries if not is_on(e, lang, profile)],
        "ipv4_block": ipv4_block,
        "ipv4_exempt": rules("ipv4", "exempt"),
        "ipv6_block": ipv6_block,
        "ipv6_exempt": rules("ipv6", "exempt"),
        "embedded": embedded,
        "names": [e["name"] for e in on if e["family"] == "name" and "name" in e],
        "suffixes": [e["name_suffix"] for e in on if e["family"] == "name" and "name_suffix" in e],
    }


def _wrap(prefix: str, words: list[str], indent: str = "") -> list[str]:
    """Comment lines ``# <prefix> w1, w2, ...`` wrapped at MAX_LINE."""
    lines, line = [], f"{indent}# {prefix}"
    for i, word in enumerate(words):
        piece = word + ("," if i < len(words) - 1 else "")
        if len(line) + 1 + len(piece) > MAX_LINE:
            lines.append(line)
            line = f"{indent}#  "
        line += " " + piece
    lines.append(line)
    return lines


def _hex(value: int, bits: int) -> str:
    return f"0x{value:0{bits // 4}x}"


def render(text: str) -> str:
    """The module text for policy JSON ``text`` (deterministic: same input, same bytes)."""
    doc = load(text)
    t = resolve(doc, LANG)
    sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    out = [
        '"""GENERATED — do not edit.',
        "",
        "Written by policy/gen_python.py from policy/blocklist.v1.json. Edit the JSON and re-run",
        "the generator; tests/test_blocklist_data.py fails when the two disagree. ssrf_guard reads",
        "every block decision from here (no ipaddress.is_* property is consulted). Matching rules",
        "and profiles: policy/README.md.",
        '"""',
        "",
        "from __future__ import annotations",
        "",
        "from typing import Final",
        "",
        f"SCHEMA_VERSION: Final = {doc['schema_version']}",
        f'PROFILE: Final = "{t["profile"]}"',
        f'COLUMN: Final = "{LANG}"',
        f'SOURCE_SHA256: Final = "{sha}"',
        "",
    ]
    out += _wrap("Entries not in force for this column and profile:", t["off"] or ["(none)"])
    out.append("")

    def table(name: str, rows: list[tuple[str, str, int, int]], bits: int, doc_lines: list[str],
              ) -> None:
        out.extend(doc_lines)
        if not rows:
            out.append(f"{name}: Final[tuple[tuple[int, int], ...]] = ()")
            out.append("")
            return
        out.append(f"{name}: Final[tuple[tuple[int, int], ...]] = (")
        for rid, cidr, net, mask in rows:
            if bits == 32:
                out.append(f"    ({_hex(net, bits)}, {_hex(mask, bits)}),  # {rid} {cidr}")
            else:  # a 128-bit pair leaves no room for the comment
                out.append(f"    # {rid} {cidr}")
                out.append(f"    ({_hex(net, bits)}, {_hex(mask, bits)}),")
        out.append(")")
        out.append("")

    table("IPV4_BLOCK", t["ipv4_block"], 32, [
        "# IPv4 rules as (network, netmask) integers. An IPv4 address is blocked when it is in a",
        "# block rule and in no exempt rule.",
    ])
    table("IPV4_EXEMPT", t["ipv4_exempt"], 32, [])
    decode_tables = {}
    for m in t["embedded"]:
        if m["mode"] == "decode" and m["skip"]:
            name = "IPV4_BLOCK_FOR_" + m["matcher"].upper().replace("-", "_")
            decode_tables[m["matcher"]] = name
            table(name, m["ipv4_block"], 32, _wrap(
                f"IPv4 block rules the {m['matcher']} decode checks: IPV4_BLOCK without",
                m["skip"],
            ))
    table("IPV6_BLOCK", t["ipv6_block"], 128, [
        "# IPv6 rules as (network, netmask) integers. An IPv6 address outside every embedded",
        "# matcher (below) is blocked when it is in a block rule and in no exempt rule.",
    ])
    table("IPV6_EXEMPT", t["ipv6_exempt"], 128, [])
    out += [
        "# Embedded-IPv4 matchers, checked before the IPv6 rules, as (matcher, network, netmask,",
        "# mode, IPv4 block rules). mode 'block': the whole prefix is blocked. 'decode': the low",
        "# 32 bits alone decide, against those IPv4 block rules and IPV4_EXEMPT. 'ranges': the",
        "# IPv6 rules decide.",
        "IPV6_EMBEDDED: Final[tuple[tuple[str, int, int, str, tuple[tuple[int, int], ...]], ...]]"
        " = (",
    ]
    for m in t["embedded"]:
        v4 = decode_tables.get(m["matcher"], "IPV4_BLOCK") if m["mode"] == "decode" else "()"
        out += _wrap(f"{m['matcher']} {m['cidr']}: {m['mode']}, from", m["why"] or ["(no entry)"],
                     indent="    ")
        out += [
            "    (",
            f'        "{m["matcher"]}",',
            f"        {_hex(m['network'], 128)},",
            f"        {_hex(m['netmask'], 128)},",
            f'        "{m["mode"]}",',
            f"        {v4},",
            "    ),",
        ]
    mapped = next(m for m in t["embedded"] if m["matcher"] == "ipv4-mapped")
    out += [
        ")",
        "",
        "# True when ipv4-mapped is a decode: _resolve_host_ips then unwraps mapped DNS answers",
        "# to IPv4 before the check (and the IPv4 is what gets dialled).",
        f"UNWRAP_IPV4_MAPPED: Final = {mapped['mode'] == 'decode'}",
        "",
        "# Host names refused before DNS, after IDNA and with trailing dots removed.",
        "LOOPBACK_NAMES: Final[frozenset[str]] = frozenset({"
        + ", ".join(f'"{n}"' for n in t["names"]) + "})",
        "LOOPBACK_SUFFIXES: Final[tuple[str, ...]] = ("
        + "".join(f'"{s}", ' for s in t["suffixes"]).rstrip() + ")",
    ]
    text_out = "\n".join(out) + "\n"
    too_long = [line for line in text_out.splitlines() if len(line) > MAX_LINE]
    if too_long:
        raise PolicyError(f"generated lines over {MAX_LINE} characters: {too_long}")
    return text_out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="exit 1 if the module is out of date")
    ap.add_argument("--source", type=Path, default=SOURCE, help=argparse.SUPPRESS)
    ap.add_argument("--target", type=Path, default=TARGET, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    try:
        wanted = render(args.source.read_bytes().decode("utf-8"))  # no newline translation
    except PolicyError as exc:
        print(f"{args.source}: {exc}", file=sys.stderr)
        return 2
    current = args.target.read_bytes().decode("utf-8") if args.target.exists() else None
    if args.check:
        if current != wanted:
            print(f"{args.target} is out of date: run policy/gen_python.py", file=sys.stderr)
            return 1
        return 0
    if current != wanted:
        args.target.write_bytes(wanted.encode("utf-8"))
        print(f"wrote {args.target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
