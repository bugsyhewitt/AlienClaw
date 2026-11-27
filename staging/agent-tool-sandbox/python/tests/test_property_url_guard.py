"""Property: the host the guard checks is the host every stdlib layer connects to.

Generated URLs (allowed and other schemes, IDNA / unicode hosts, IP literals in every
spelling, userinfo, edge ports, percent-encoding, backslashes, extra colons, brackets,
whitespace / control characters, non-ASCII paths, queries and fragments) go through
``assert_safe_fetch_url`` and ``resolve_and_validate``. DNS is a hostile fake: every NAME
resolves to a public address (so only the parse can refuse it) and IP literals go
through the real libc parser (``AI_NUMERICHOST``), as in production.

When the guard ACCEPTS, the canonical URL it returns must agree with the validated
(scheme, host, port) under every reading the standard library makes of it:

  (a) ``urllib.request.Request(canonical)``: ``.type`` and ``.host``;
  (b) what urllib + http.client really dial: the ``(host, port)`` handed to
      ``socket.create_connection`` by a stock opener (recorded, nothing is connected);
  (c) ``urllib.parse.urlsplit(canonical)``: ``.hostname`` and ``.port``;

the name the resolver was asked for (after the IDNA encoding ``socket.getaddrinfo``
applies) must be that host, and the canonical URL must round-trip (validating it again
returns it unchanged). When the guard REFUSES, it raises ``SsrfBlockedError``: never
``UnicodeError``, a bare ``ValueError``, ``IndexError`` or anything else.

Deterministic (``derandomize=True``, no example database). ``ATS_PROPERTY_SCALE``
multiplies ``max_examples`` for a deeper local run.
"""
from __future__ import annotations

import http.client
import ipaddress
import os
import re
import socket
import ssl
import urllib.error
import urllib.request
from unittest import mock
from urllib.parse import quote, urlsplit

import pytest

hypothesis = pytest.importorskip("hypothesis")
from hypothesis import HealthCheck, event, example, given, settings  # noqa: E402
from hypothesis import strategies as st  # noqa: E402

from agent_tool_sandbox import (  # noqa: E402
    SsrfBlockedError,
    assert_safe_fetch_url,
    resolve_and_validate,
)

_REAL_GETADDRINFO = socket.getaddrinfo  # captured at import, before any fixture patches it
PUBLIC_V4 = "93.184.216.34"
_DEFAULT_PORTS = {"http": 80, "https": 443}
_SCALE = max(1, int(os.environ.get("ATS_PROPERTY_SCALE", "1")))


def _settings(max_examples: int) -> settings:
    return settings(
        max_examples=max_examples * _SCALE,
        derandomize=True,
        database=None,
        deadline=None,  # bounded by max_examples; per-example timings flake under load
        suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow],
    )


class _HostileResolver:
    """Every name resolves publicly; IP literals go through the real libc parser."""

    def __init__(self) -> None:
        self.calls: list[object] = []

    def __call__(self, host, port, family=0, type=0, proto=0, flags=0):
        self.calls.append(host)
        try:
            return _REAL_GETADDRINFO(host, port, family, type, proto, flags | socket.AI_NUMERICHOST)
        except socket.gaierror:
            pass
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (PUBLIC_V4, port or 0))]


class _DialRecordedError(OSError):
    """Raised by the recording create_connection instead of connecting."""


_TLS = ssl.create_default_context()  # built once: HTTPSHandler would build one per opener


def _stock_opener() -> urllib.request.OpenerDirector:
    # Stock handlers only, and no ProxyHandler: the dial must be the URL's own host.
    opener = urllib.request.OpenerDirector()
    for handler in (urllib.request.HTTPHandler(), urllib.request.HTTPSHandler(context=_TLS),
                    urllib.request.HTTPDefaultErrorHandler(), urllib.request.UnknownHandler()):
        opener.add_handler(handler)
    return opener


_OPENER = _stock_opener()


def _dial_target(url: str) -> tuple[str, int]:
    """(host, port) a stock urllib opener passes to ``socket.create_connection``."""
    dialled: list[tuple[str, int]] = []

    def create_connection(address, *args, **kwargs):
        dialled.append(address)
        raise _DialRecordedError("recorded, not connected")

    with mock.patch.object(socket, "create_connection", create_connection):
        try:
            _OPENER.open(url, timeout=1)
        except urllib.error.URLError as exc:
            assert isinstance(exc.reason, _DialRecordedError), f"failed before dialling: {exc!r}"
    assert len(dialled) == 1, dialled
    host, port = dialled[0]
    return host, port


def _bracketed(host: str) -> str:
    return f"[{host}]" if ":" in host else host


def _check(url: str) -> None:
    resolver = _HostileResolver()
    with mock.patch.object(socket, "getaddrinfo", resolver):
        try:
            canonical = assert_safe_fetch_url(url)
        except SsrfBlockedError:
            # Refused: resolve_and_validate must refuse too, with the same message.
            try:
                resolve_and_validate(url)
            except SsrfBlockedError:
                event("refused")
                return
            raise AssertionError("assert_safe_fetch_url refused, resolve_and_validate accepted")
        event("accepted")
        target = resolve_and_validate(url)
        assert target.canonical_url == canonical
        scheme, host, port = target.scheme, target.host, target.port
        assert scheme in _DEFAULT_PORTS
        assert canonical.isascii()

        # The resolver was asked for the checked host, once per validation.
        assert len(resolver.calls) == 2, resolver.calls
        asked = resolver.calls[0]
        assert asked == resolver.calls[1]
        asked_ascii = asked if ":" in asked else asked.encode("idna").decode("ascii")
        assert asked_ascii.lower() == host

        # (a) urllib.request.Request
        req = urllib.request.Request(canonical)
        assert req.type == scheme
        assert req.host in (_bracketed(host), f"{_bracketed(host)}:{port}")

        # (c) urllib.parse.urlsplit
        split = urlsplit(canonical)
        assert split.scheme == scheme
        assert split.hostname == host
        assert (split.port if split.port is not None else _DEFAULT_PORTS[scheme]) == port
        assert split.username is None and split.password is None

        # The canonical URL is a fixed point of the guard.
        assert assert_safe_fetch_url(canonical) == canonical
        assert resolve_and_validate(canonical) == target

    # (b) what urllib + http.client actually dial (outside the resolver patch: no DNS).
    assert _dial_target(canonical) == (host, port)

    # http.client's own split of Request.host agrees as well.
    conn_cls = http.client.HTTPSConnection if scheme == "https" else http.client.HTTPConnection
    kwargs = {"context": _TLS} if scheme == "https" else {}
    conn = conn_cls(req.host, **kwargs)
    assert (conn.host, conn.port) == (host, port)


# ── URL strategy ─────────────────────────────────────────────────────────────


def _joined(pieces: list[str], min_size: int, max_size: int) -> st.SearchStrategy[str]:
    """Strings made of ``pieces`` (which may be longer than one character)."""
    return st.lists(st.sampled_from(pieces), min_size=min_size, max_size=max_size).map("".join)


_SCHEMES = st.sampled_from(
    ["http", "https"] * 4 + ["HTTP", "Https", "hTtPs"] + ["ftp", "file", "ws", "", "h-ttp"]
)
_SEPARATORS = st.sampled_from(["://"] * 12 + [":/", ":", ":///", ":////", ":\\\\", ":/\\"])
_LABEL = st.from_regex(r"[A-Za-z0-9_-]{1,10}", fullmatch=True)
_DNS_NAME = st.builds(
    lambda labels, dot: ".".join(labels) + dot,
    st.lists(_LABEL, min_size=1, max_size=4),
    st.sampled_from(["", "", "", "."]),
)
# Characters IDNA maps, folds, drops or splits on: sharp s, dotted / dotless i, a ligature,
# full-width letters and digits, the three non-ASCII full stops, combining marks, U+2100.
_UNICODE_LABEL = _joined(
    list("abxyz09-_\u00df\u00fc\u00f6\u00e9\u0130\u0131\ufb01\uff21\uff41\uff11\uff12"
         "\u3002\uff0e\uff61\u034f\u0301\u2100"),
    1, 10,
)
_UNICODE_NAME = st.builds(
    lambda labels: ".".join(labels), st.lists(_UNICODE_LABEL, min_size=1, max_size=3)
)
_ANY_TEXT_HOST = st.text(
    st.characters(codec="utf-8", exclude_categories=("Cs",)), min_size=1, max_size=8
)


def _ipv4_spellings(ip: ipaddress.IPv4Address) -> st.SearchStrategy[str]:
    v = int(ip)
    a, b, c, d = ip.packed
    return st.sampled_from([
        str(ip), str(v), hex(v), f"0{v:o}", f"{a}.{(b << 16) | (c << 8) | d}",
        f"{a}.{b}.{(c << 8) | d}", f"{a:#x}.{b:#x}.{c:#x}.{d:#x}", f"0{a:o}.{b}.{c}.0{d:o}",
        f"{a}.{b}.{c}.{d}.", f"{a:#X}.{b}.{c}.{d}",
    ])


_IPV4_INTERESTING = st.sampled_from([
    "127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "93.184.216.34",
    "8.8.8.8", "168.63.129.16", "192.0.0.9", "255.255.255.255", "1.1.1.1",
]).map(ipaddress.IPv4Address)
_IPV4_LITERAL = st.one_of(_IPV4_INTERESTING, st.ip_addresses(v=4)).flatmap(_ipv4_spellings)


def _ipv6_spellings(ip: ipaddress.IPv6Address) -> st.SearchStrategy[str]:
    forms = [str(ip), ip.exploded, ip.exploded.upper(), str(ip).upper()]
    if ip.ipv4_mapped is not None:
        forms.append(f"::ffff:{ip.ipv4_mapped}")
    return st.sampled_from(forms).flatmap(
        lambda s: st.sampled_from([
            f"[{s}]", f"[{s}]", f"[{s}%25eth0]", f"[{s}%eth0]", s, f"[{s}", f"{s}]",
            f"[[{s}]]", f"[{s}]x",
        ])
    )


_IPV6_INTERESTING = st.sampled_from([
    "::1", "::", "::ffff:127.0.0.1", "::ffff:93.184.216.34", "64:ff9b::a00:1", "fe80::1",
    "fd00:ec2::254", "2606:2800:220:1:248:1893:25c8:1946", "2002:7f00:1::",
    "2001:4860:4860::8888",
]).map(ipaddress.IPv6Address)
_IPV6_LITERAL = st.one_of(_IPV6_INTERESTING, st.ip_addresses(v=6)).flatmap(_ipv6_spellings)
_IPVFUTURE = st.sampled_from(["[v1.public]", "[v7.::1]", "[V1.x]", "[v1.]", "[vz.a]"])
_NASTY_HOST = _joined(
    list("ab1.:%[]@\\/ #?\t\x00\r\n-_~;=\u3002") + ["%2e", "%31", "%5b"], 1, 12
)
_HOSTS = st.one_of(
    _DNS_NAME, _DNS_NAME, _UNICODE_NAME, _ANY_TEXT_HOST, _IPV4_LITERAL, _IPV6_LITERAL,
    _IPVFUTURE, _NASTY_HOST,
    st.sampled_from(["", "localhost", "LOCALHOST.", "a.localhost", "ip6-localhost",
                     "\uff4c\uff4f\uff43\uff41\uff4c\uff48\uff4f\uff53\uff54",
                     "local\u034fhost"]),
)
_USERINFO = st.one_of(
    st.none(), st.none(), st.none(),
    st.sampled_from(["user", "u:p", "", "a%40b", "user@evil", "x:y:z", "\u00fc",
                     "93.184.216.34"]),
)
_PORTS = st.one_of(
    st.none(), st.none(),
    st.integers(0, 70000).map(str),
    st.sampled_from(["", "0", "1", "80", "443", "65535", "65536", "99999", "080", "0000080",
                     "-1", "+1", "1e2", "0x50", "\u0668\u0660", "\uff18\uff10", "80 ", "8_0",
                     "\u00b2", "80:80"]),
)
_PART = list("abz09/.%:@;=&+-_~!$'()*,\u00e9\u00fc\u20ac\U0001F600\u3002\\ \t?#") + [
    "%2F", "%23", "%00", "%zz", "..",
]
_PATHS = st.one_of(st.just(""), _joined(_PART, 0, 12).map(lambda s: "/" + s), _joined(_PART, 0, 8))
_QUERY = st.one_of(st.none(), st.none(), _joined(_PART, 0, 8))
_FRAGMENT = st.one_of(st.none(), st.none(), _joined(_PART, 0, 8))


@st.composite
def _urls(draw: st.DrawFn) -> str:
    url = draw(_SCHEMES) + draw(_SEPARATORS)
    userinfo = draw(_USERINFO)
    if userinfo is not None:
        url += userinfo + "@"
    url += draw(_HOSTS)
    port = draw(_PORTS)
    if port is not None:
        url += ":" + port
    url += draw(_PATHS)
    query, fragment = draw(_QUERY), draw(_FRAGMENT)
    if query is not None:
        url += "?" + query
    if fragment is not None:
        url += "#" + fragment
    return url


_ANY_URLS = st.one_of(_urls(), _urls(), _urls(), st.text(max_size=40),
                      st.text(max_size=20).map(lambda s: "http://" + s))


# ── Properties ───────────────────────────────────────────────────────────────


@_settings(1000)
@given(url=_ANY_URLS)
@example(url="http://public.example/")
@example(url="HTTP://Public.Example:080/a;p?q=1#f")
@example(url="https://bücher.example/café?q=ü#é")
@example(url="http://[2606:2800:220:1:248:1893:25c8:1946]:8443/")
@example(url="http://[::ffff:93.184.216.34]/")
@example(url="http://0x5d.0xb8.0xd8.0x22/")
@example(url="http://[v1.public]/")
# IPvFuture with ':' skips the host character allowlist and is resolved as a NAME; checked
# and connected host still agree. Documented: vectors/DIFFERENCES.md, v6url-ipvfuture (allow).
@example(url="http://[v1.fe80::a+en1]/")
@example(url="http://public.example/a;?q")  # bug 1: the empty ';' params was dropped
@example(url="http://a\u3002b/")
@example(url="http://public.example:/")
@example(url="http://public.example:0000080/")
@example(url="http://%31%32%37.0.0.1/")
@example(url="http://a.example:b.example:80/")
@example(url="http://169.254.169.254\\@public.example/")
@example(url="http://user@public.example/")
@example(url="http://local\u034fhost/")
@example(url="http://\u2100.example/")
def test_checked_host_is_the_connected_host(url: str) -> None:
    _check(url)


@_settings(300)
@given(host=st.one_of(_DNS_NAME, _UNICODE_NAME, _IPV4_LITERAL, _IPV6_LITERAL),
       scheme=st.sampled_from(["http", "https"]),
       port=st.one_of(st.none(), st.integers(1, 65535)),
       path=_PATHS)
def test_well_formed_urls_check_and_connect_alike(host, scheme, port, path) -> None:
    """The same property on a population that is mostly ACCEPTED, so (a)-(c) get exercised."""
    _check(f"{scheme}://{host}" + ("" if port is None else f":{port}") + path)


# A clean population the guard must ACCEPT (so a guard that refuses everything fails), with
# the canonical form written out independently: lower-case scheme and host, the port only
# when given, non-ASCII in the path percent-encoded as UTF-8 (as WHATWG parsers do).
_CLEAN_LABEL = st.from_regex(r"[a-z0-9]([a-z0-9-]{0,8}[a-z0-9])?", fullmatch=True)
# The last label starts with a letter: a numeric one makes an IPv4 literal ('0.0' is
# 0.0.0.0). '.localhost' names are refused by name.
_CLEAN_TLD = st.from_regex(r"[a-z]([a-z0-9-]{0,6}[a-z0-9])?", fullmatch=True).filter(
    lambda tld: tld != "localhost"
)
_CLEAN_NAME = st.builds(lambda labels, tld: ".".join([*labels, tld]),
                        st.lists(_CLEAN_LABEL, min_size=1, max_size=3), _CLEAN_TLD)
_PUBLIC_LITERALS = st.sampled_from(["93.184.216.34", "8.8.8.8", "[2606:4700:4700::1111]",
                                    "[2001:4860:4860::8888]"])
_CLEAN_PATH = _joined(list("abz09-._~!$&'()*+,;=:@/") + ["%2F", "\u00e9", "\u20ac"], 0, 10)


def _encoded(path: str) -> str:
    return re.sub(r"[^\x00-\x7f]+", lambda m: quote(m.group(0), safe=""), path)


@_settings(300)
@given(scheme=st.sampled_from(["http", "https", "HTTP", "Https"]),
       host=st.one_of(_CLEAN_NAME, _CLEAN_NAME.map(str.upper), _PUBLIC_LITERALS),
       dot=st.sampled_from(["", "."]),
       port=st.one_of(st.none(), st.integers(1, 65535)),
       path=_CLEAN_PATH)
@example(scheme="https", host="public.example", dot="", port=None, path="")
@example(scheme="http", host="public.example", dot="", port=None, path="a;")  # bug 1
@example(scheme="http", host="public.example", dot="", port=None, path=";")   # bug 1
@example(scheme="HTTP", host="PUBLIC.EXAMPLE", dot=".", port=65535, path="caf" + "\u00e9")
def test_clean_urls_are_accepted_in_canonical_form(scheme, host, dot, port, path) -> None:
    if host.startswith("["):
        dot = ""
    authority = host + dot + ("" if port is None else f":{port}")
    url = f"{scheme}://{authority}/{path}"
    expected = f"{scheme.lower()}://{authority.lower()}/{_encoded(path)}"
    with mock.patch.object(socket, "getaddrinfo", _HostileResolver()):
        assert assert_safe_fetch_url(url) == expected
    _check(url)


# ── Regression: found by test_clean_urls_are_accepted_in_canonical_form ──────
# Bug 1 (2026-11-26): the canonical URL was rebuilt with urlparse()/urlunparse(), which split
# ';params' off the last path segment and then dropped an EMPTY one: 'http://h/a;' came back
# as 'http://h/a', another resource ('/a;?q' as '/a?q'). The path is now kept whole.
# Bug 2 (2026-11-26 security review, F2): urlsplit()/urlunsplit() also dropped an empty '?'
# or '#', so '/a?' was requested as '/a'. Everything after the authority is now kept as given.


@pytest.mark.parametrize(("rest", "canonical_rest"), [
    ("/a;", "/a;"), ("/;", "/;"), ("/a;?q", "/a;?q"), ("/a;#f", "/a;#f"), ("/x/a;", "/x/a;"),
    ("/a;b;", "/a;b;"), ("/a;b", "/a;b"),
    ("/a?", "/a?"), ("/a#", "/a#"), ("/a?#", "/a?#"), ("?", "?"), ("#", "#"),  # F2: kept
])
def test_canonical_url_keeps_the_path_whole(rest: str, canonical_rest: str) -> None:
    with mock.patch.object(socket, "getaddrinfo", _HostileResolver()):
        assert assert_safe_fetch_url("HTTP://Public.Example" + rest) == (
            "http://public.example" + canonical_rest
        )
        assert resolve_and_validate("http://public.example:8080" + rest).canonical_url == (
            "http://public.example:8080" + canonical_rest
        )
