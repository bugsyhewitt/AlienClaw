"""
SSRF core guard for agent tools that fetch URLs (urllib-based).

Scope:
  - Scheme allowlist (http + https only — rejects file, ftp, gopher, data).
  - IP block (loopback, RFC1918, link-local, metadata, multicast, reserved,
    RFC 6598 CGNAT, IPv6 ULA / site-local, IPv4-mapped IPv6, and every
    obfuscated / short-form IPv4 literal the platform resolver accepts),
    applied to EVERY address the hostname resolves to. The ranges are data: they come
    from the generated ``_blocklist_data`` (source: policy/blocklist.v1.json, shared with
    the TypeScript package), and no ``ipaddress.is_*`` property is consulted.
  - ``localhost``, ``*.localhost`` (trailing dots included) and the ip6-localhost /
    ip6-loopback aliases refused by name, before DNS (RFC 6761 §6.3).
  - Refusal messages that do not disclose what a name resolved to (the detail is on
    the exception's attributes) and that redact userinfo, query and fragment of URLs.
  - Redirect disable (raises on 3xx — Python equiv of fetch redirect:'error').
  - Checked host == connected host: HTTP clients do not reuse urlparse().
    urllib/http.client keep userinfo, percent-decode the host and split the port at
    the LAST ':' (urlparse: the FIRST); WHATWG parsers (urllib3, so requests) end the
    authority at '\\'. The guard refuses every spelling on which parsers can disagree
    (backslash, whitespace, control chars, userinfo, '%' in the host, a second ':'
    outside brackets, host chars outside [a-z0-9._-] after IDNA) and returns a
    canonical URL rebuilt from the validated parts. Callers fetch THAT URL.
  - IRIs: after the character rule, non-ASCII in the path, query and fragment is
    percent-encoded as UTF-8 (as WHATWG parsers do) BEFORE any other check, so the checks
    and the returned URL see the canonical, ASCII form; the host is IDNA-encoded.

NOT in scope:
  - Host allowlist.
  - HTTPS pin.
  - Port restriction.
  - Pinning the connection to the vetted IP: this guard resolves the name once,
    and urllib resolves it again at connect time. ``agent_tool_sandbox.pinning``
    reuses this module's single resolution and dials only the vetted addresses
    (see README, "Threat model").
"""
from __future__ import annotations

import http.client
import ipaddress
import re
import socket
import urllib.request
from typing import Final, NamedTuple
from urllib.parse import quote, urlparse, urlsplit, urlunsplit

from . import _blocklist_data as _blocklist

_ALLOWED_SCHEMES: Final[frozenset[str]] = frozenset({"http", "https"})
_DEFAULT_PORTS: Final[dict[str, int]] = {"http": 80, "https": 443}
# After IDNA a host name may only use these (underscore kept: DNS serves such names).
_HOSTNAME_CHARS: Final = re.compile(r"[a-z0-9._-]+")
# A bracketed IPv6 authority, with an optional port and nothing else around it.
_BRACKETED_NETLOC: Final = re.compile(r"\[[^\[\]]+\](?::[0-9]*)?")


def _resolve_host_ips(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    """Resolve host (name or literal) to all IPs. Catches DNS and IDNA errors.

    Catches ``socket.gaierror`` (DNS failure) and ``UnicodeError`` (idna codec
    rejection of overlong / empty / IDNA-illegal labels — base ``UnicodeError``
    on Python ≤3.12, ``UnicodeEncodeError`` on 3.13+). Both are treated as
    unresolvable so the guard surfaces SsrfBlockedError instead of crashing the
    calling tool.
    """
    try:
        infos = socket.getaddrinfo(host, None)
    except (socket.gaierror, UnicodeError):
        return []
    out: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    for fam, *_rest, sockaddr in infos:
        try:
            if fam == socket.AF_INET:
                out.append(ipaddress.IPv4Address(sockaddr[0]))
            elif fam == socket.AF_INET6:
                addr6 = ipaddress.IPv6Address(sockaddr[0])
                # IPv4-mapped IPv6 (::ffff:a.b.c.d) — unwrap to v4 for the block check, while
                # the policy judges mapped addresses by their IPv4 (its ipv4-mapped decode)
                mapped = addr6.ipv4_mapped if _blocklist.UNWRAP_IPV4_MAPPED else None
                out.append(mapped if mapped is not None else addr6)
        except (ValueError, IndexError):
            continue
    return out


_Rules = tuple[tuple[int, int], ...]  # (network, netmask) integer pairs


def _matches(value: int, rules: _Rules) -> bool:
    return any(value & netmask == network for network, netmask in rules)


def _ipv4_is_blocked(value: int, block: _Rules) -> bool:
    return _matches(value, block) and not _matches(value, _blocklist.IPV4_EXEMPT)


def _ip_is_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """True if ip is in the block list (loopback, private, link-local, metadata, reserved,
    CGNAT, multicast, documentation, transition prefixes; see policy/blocklist.v1.json).

    Every rule comes from ``_blocklist_data``. IPv4: in a block rule and in no exempt rule.
    IPv6: the embedded-IPv4 matchers first (IPv4-mapped, NAT64), each of which blocks its
    whole prefix, judges the embedded IPv4 alone, or defers to the IPv6 rules; then the IPv6
    block and exempt rules. A zone ID (``fe80::1%eth0``) is ignored for the match.
    """
    value = int(ip)
    if isinstance(ip, ipaddress.IPv4Address):
        return _ipv4_is_blocked(value, _blocklist.IPV4_BLOCK)
    for _matcher, network, netmask, mode, ipv4_block in _blocklist.IPV6_EMBEDDED:
        if value & netmask == network:
            if mode == "block":
                return True
            if mode == "decode":
                return _ipv4_is_blocked(value & 0xFFFFFFFF, ipv4_block)
            break  # "ranges": the matcher prefixes do not overlap
    return _matches(value, _blocklist.IPV6_BLOCK) and not _matches(
        value, _blocklist.IPV6_EXEMPT
    )


class SsrfBlockedError(ValueError):
    """Raised when the URL is rejected by the SSRF core guard.

    ``str(exc)`` is safe to hand back to an agent: it never names an address the guard
    learned from DNS (a name that resolves internally and a name that does not resolve
    read the same), and any URL in it has its userinfo, query and fragment redacted.
    For logs, the exception also carries:

    - ``detail``: the full reason, which may name the resolved address
      (``Refusing blocked IP 10.0.0.1 (resolved from 'db.corp')``); the same as
      ``str(exc)`` when nothing was withheld;
    - ``blocked_address``: the ``IPv4Address``/``IPv6Address`` that was refused, or ``None``;
    - ``hostname``: the host that was checked, or ``None``.
    """

    def __init__(
        self,
        message: str = "",
        *,
        detail: str | None = None,
        blocked_address: ipaddress.IPv4Address | ipaddress.IPv6Address | None = None,
        hostname: str | None = None,
    ) -> None:
        super().__init__(message)
        self.detail = message if detail is None else detail
        self.blocked_address = blocked_address
        self.hostname = hostname


_REDACTED: Final = "REDACTED"
# An authority ("//" after an optional scheme) up to the first "/"; "\\" is NOT a stop, so
# "a\\@host" redacts as userinfo (WHATWG parsers end the authority there, urllib does not).
_AUTHORITY: Final = re.compile(r"^((?:[A-Za-z][A-Za-z0-9+.\-]*:)?//)([^/]*)")


def _redact_url(url: str | None) -> str | None:
    """``url`` with its userinfo, query and fragment replaced by ``REDACTED``.

    Used for every URL that goes into an error message: a redirect ``Location`` or a
    request URL can carry credentials (``user:pw@``) or tokens (``?code=``, ``#access_token=``).
    Non-strings (a missing ``Location``) are returned unchanged.
    """
    if not isinstance(url, str):
        return url
    cuts = [i for i in (url.find("?"), url.find("#")) if i >= 0]
    cut = min(cuts) if cuts else len(url)
    head, tail = url[:cut], url[cut:]
    match = _AUTHORITY.match(head)
    if match and "@" in match.group(2):
        host = match.group(2).rpartition("@")[2]
        head = f"{match.group(1)}{_REDACTED}@{host}{head[match.end():]}"
    if tail.startswith("?"):
        tail = f"?{_REDACTED}" + (f"#{_REDACTED}" if "#" in tail else "")
    elif tail:
        tail = f"#{_REDACTED}"
    return head + tail


def _secret_parts(url: str) -> list[str]:
    """What ``_redact_url`` hides: the userinfo (and each half), the query, the fragment."""
    parts: list[str] = []
    fragment_at = url.find("#")
    if fragment_at >= 0:
        parts.append(url[fragment_at + 1:])
        url = url[:fragment_at]
    query_at = url.find("?")
    if query_at >= 0:
        parts.append(url[query_at + 1:])
        url = url[:query_at]
    match = _AUTHORITY.match(url)
    if match and "@" in match.group(2):
        userinfo = match.group(2).rpartition("@")[0]
        parts += [userinfo, *userinfo.split(":")]
    return [part for part in parts if part]


def _scrub(text: str, url: object) -> str:
    """``text`` (an exception message about ``url``) made safe to quote.

    Copies of the whole URL are replaced by its redacted form. If any secret part still
    shows (http.client quotes fragments, e.g. "nonnumeric port: 'pw@host'"), the text is
    withheld in favour of the redacted URL.
    """
    if not isinstance(url, str) or not url:
        return text
    redacted = str(_redact_url(url))
    text = text.replace(repr(url), repr(redacted)).replace(url, redacted)
    if any(part in text for part in _secret_parts(url)):
        return f"{redacted!r} (details withheld: they would quote credentials or a query)"
    return text


def _refused(host: str) -> str:
    """The one message for a post-DNS refusal: blocked address and no address read the same."""
    return f"Refusing hostname {host!r}: not an allowed destination"


# RFC 6761 §6.3: "localhost" and every name under ".localhost" are loopback, and stub
# resolvers (systemd-resolved, browsers) answer them without asking DNS. The two Debian
# /etc/hosts aliases are refused too, as the TypeScript twin does. The names are the
# block list's "name" entries (_blocklist_data.LOOPBACK_NAMES / LOOPBACK_SUFFIXES).


def _is_loopback_name(ascii_host: str) -> bool:
    name = ascii_host.rstrip(".")
    return name in _blocklist.LOOPBACK_NAMES or name.endswith(_blocklist.LOOPBACK_SUFFIXES)


def _assert_unambiguous_chars(raw_url: str) -> None:
    """Refuse characters that URL parsers treat differently.

    urlsplit() silently drops tab/CR/LF that urllib keeps, and WHATWG parsers
    (urllib3, so requests) end the authority at '\\' where urlparse() does not.
    """
    for ch in raw_url:
        if ch == "\\" or ch.isspace() or not ch.isprintable():
            raise SsrfBlockedError(
                f"Refusing URL containing {ch!r}: backslash, whitespace and control "
                "characters are parsed differently by different HTTP clients"
            )


# What comes before the path: an optional scheme and an optional "//" authority, which
# ends at the first '/', '?' or '#' (urlsplit's rule; '\\' is already refused).
_BEFORE_PATH: Final = re.compile(r"(?:[A-Za-z][A-Za-z0-9+.\-]*:)?(?://[^/?#]*)?")
_NON_ASCII: Final = re.compile(r"[^\x00-\x7f]+")


def _percent_encode_non_ascii(url: str) -> str:
    """Percent-encode, as UTF-8, every non-ASCII character of the path, query and fragment.

    What a WHATWG URL parser does to them (and what the TS twin sends): ``/café`` becomes
    ``/caf%C3%A9``; existing ``%XX`` escapes and ASCII are left exactly as they are.
    http.client cannot put non-ASCII in a request line (it raised ``UnicodeEncodeError``).
    The scheme and authority are left alone: the guard IDNA-encodes the host or refuses
    it. Run ``_assert_unambiguous_chars`` first, on the URL as given, so that encoding
    cannot turn whitespace or a control character into an accepted ``%XX``.
    """
    if url.isascii():
        return url
    head = _BEFORE_PATH.match(url)
    cut = head.end() if head else 0
    return url[:cut] + _NON_ASCII.sub(lambda m: quote(m.group(0), safe=""), url[cut:])


def _assert_plain_authority(netloc: str) -> None:
    """Refuse authority spellings that URL parsers split differently.

    urlparse() takes userinfo up to the LAST '@' and splits the port at the FIRST
    ':'; http.client splits the port at the LAST ':' and urllib percent-decodes the
    host (http://a.x.tld:b.x.tld:80/ is checked as a.x.tld, connected as a.x.tld:b.x.tld).
    """
    if "@" in netloc:
        raise SsrfBlockedError("Refusing URL with userinfo (credentials before '@')")
    if netloc.startswith("["):
        if not _BRACKETED_NETLOC.fullmatch(netloc):
            raise SsrfBlockedError(f"Refusing malformed IPv6 authority {netloc!r}")
        return
    if "[" in netloc or "]" in netloc or netloc.count(":") > 1:
        raise SsrfBlockedError(
            f"Refusing authority {netloc!r}: only a bracketed IPv6 literal may contain "
            "brackets or more than one ':'"
        )
    if "%" in netloc:
        raise SsrfBlockedError(f"Refusing percent-encoded authority {netloc!r}")


def _ascii_host(host: str) -> str:
    """IDNA-encode a host name (IPv6 literals pass through) and allowlist its characters.

    The IDNA codec is the one getaddrinfo applies to a str host, so the result
    names exactly what gets resolved.
    """
    if ":" in host:  # IPv6 literal: urlparse() stripped the brackets and urlsplit validated it
        return host
    try:
        ascii_host = host.encode("idna").decode("ascii")
    except UnicodeError:
        raise SsrfBlockedError(f"Refusing unresolvable hostname {host!r}")
    if not _HOSTNAME_CHARS.fullmatch(ascii_host):
        raise SsrfBlockedError(
            f"Refusing hostname {host!r}: characters outside [a-z0-9._-] after IDNA"
        )
    return ascii_host


class _HttpsPortProbe(http.client.HTTPConnection):
    """HTTPConnection with HTTPSConnection's default port, without building an SSL context."""

    default_port = http.client.HTTPS_PORT


def _connect_target(url: str) -> tuple[str, int]:
    """(host, port) urllib hands to the socket layer for ``url``, computed without any I/O.

    Replays urllib's own parse: Request splits the authority with its own regex
    (userinfo kept, percent-escapes decoded), then http.client splits the port at
    the last ':', strips IPv6 brackets and rejects control characters.
    """
    try:
        req = urllib.request.Request(url)
        probe = _HttpsPortProbe if req.type == "https" else http.client.HTTPConnection
        conn = probe(req.host)
    except (ValueError, http.client.HTTPException) as exc:
        raise SsrfBlockedError(f"Refusing malformed URL: {_scrub(str(exc), url)}")
    return conn.host.lower(), conn.port


def _assert_connects_to(url: str, host: str, port: int) -> None:
    target = _connect_target(url)
    if target != (host, port):
        raise SsrfBlockedError(
            f"Refusing URL whose connect target {target!r} differs from "
            f"checked target {(host, port)!r}"
        )


def _canonical_url(url: str, ascii_host: str, port: int | None) -> str:
    """Rebuild the URL from validated parts: no userinfo, IDNA host, the given port.

    The path is urlsplit()'s: urlparse() splits ';params' off the last segment and
    urlunparse() then drops an EMPTY one, so '/a;' came back as '/a', another resource
    (fixed 2026-11-26). An empty '?' query or '#' fragment is still dropped.
    """
    split = urlsplit(url)
    netloc = f"[{ascii_host}]" if ":" in ascii_host else ascii_host
    if port is not None:
        netloc = f"{netloc}:{port}"
    return urlunsplit((split.scheme, netloc, split.path, split.query, split.fragment))


class _ValidatedUrl(NamedTuple):
    """Everything the guard established about one URL, from ONE resolution."""

    scheme: str
    host: str  # ASCII host as http.client sees it: IDNA name, or IPv6 literal unbracketed
    port: int  # effective port (scheme default filled in)
    canonical_url: str
    ips: list[ipaddress.IPv4Address | ipaddress.IPv6Address]  # every one passed the check


def assert_safe_fetch_url(raw_url: str) -> str:
    """Validate URL against the SSRF core guard.

    Returns the canonical URL on success, rebuilt from the validated parts:
    lower-case scheme and host, IDNA-encoded host, port only when one was given,
    no userinfo. Fetch the RETURNED URL, never ``raw_url``.
    Raises SsrfBlockedError on rejection.
    """
    return _validate_fetch_url(raw_url).canonical_url


def _validate_fetch_url(raw_url: str) -> _ValidatedUrl:
    """The guard proper. Same checks, order and messages as ``assert_safe_fetch_url``."""
    if not isinstance(raw_url, str) or not raw_url:
        raise SsrfBlockedError("Missing or non-string URL")
    _assert_unambiguous_chars(raw_url)
    # An IRI's path, query and fragment become UTF-8 %XX here, before anything else looks
    # at them, so every check below and the returned URL see the canonical form.
    raw_url = _percent_encode_non_ascii(raw_url)
    try:
        parsed = urlparse(raw_url)
    except Exception as exc:
        raise SsrfBlockedError(f"Refusing malformed URL: {exc}")

    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise SsrfBlockedError(
            f"Refusing non-http(s) scheme {parsed.scheme!r} (allowed: {sorted(_ALLOWED_SCHEMES)})"
        )
    host = parsed.hostname
    if not host:
        raise SsrfBlockedError("Refusing URL with no hostname")

    # HTTP clients connect to the host THEY parse, not to urlparse().hostname: refuse
    # every URL on which parsers can disagree, before resolving anything.
    _assert_plain_authority(parsed.netloc)
    try:
        port = parsed.port
    except ValueError as exc:
        raise SsrfBlockedError(f"Refusing malformed URL: {exc}")
    # urlparse accepts port 0, and a client that reads 0 as "use the default" (Node's
    # http module does) dials 80. Nothing listens on 0, so refuse it.
    if port is not None and not 1 <= port <= 65535:
        raise SsrfBlockedError(f"Refusing URL with port {port}: ports must be 1-65535")
    effective_port = port if port is not None else _DEFAULT_PORTS[parsed.scheme]
    _assert_connects_to(raw_url, host, effective_port)
    ascii_host = _ascii_host(host)
    if _is_loopback_name(ascii_host):  # before DNS: a resolver may answer anything for it
        raise SsrfBlockedError(
            f"Refusing hostname {host!r}: reserved loopback name (RFC 6761)", hostname=host
        )

    # From here on the verdict depends on what DNS answered, so str(exc) is the same for
    # every outcome and only ``detail`` / ``blocked_address`` say which (PR-03).
    ips = _resolve_host_ips(host)
    if not ips:
        raise SsrfBlockedError(
            _refused(host), detail=f"Refusing unresolvable hostname {host!r}", hostname=host
        )

    for ip in ips:
        if _ip_is_blocked(ip):
            raise SsrfBlockedError(
                _refused(host),
                detail=f"Refusing blocked IP {ip} (resolved from {host!r})",
                blocked_address=ip,
                hostname=host,
            )

    canonical = _canonical_url(raw_url, ascii_host, port)
    _assert_connects_to(canonical, ascii_host, effective_port)
    return _ValidatedUrl(parsed.scheme, ascii_host, effective_port, canonical, ips)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Block all 3xx redirects — equiv of fetch redirect:'error'."""

    def http_error_302(self, req, fp, code, msg, headers):  # noqa: N802
        raise SsrfBlockedError(f"Redirect to {_redact_url(headers.get('Location'))!r} blocked")

    http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302


def build_no_redirect_opener() -> urllib.request.OpenerDirector:
    """Build a urllib opener that does NOT follow redirects."""
    return urllib.request.build_opener(_NoRedirect())
