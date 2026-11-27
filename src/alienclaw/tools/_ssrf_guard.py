"""
SSRF core guard for url_fetch / http_get.

Scope (per PKT-522 rejection rationale, issues.md:4730 — PKT-577 corrective re-author):
  - Scheme allowlist (http + https only — rejects file, ftp, gopher, data).
  - IP-literal block (loopback, RFC1918, link-local, metadata, multicast,
    reserved, IPv6 ULA, IPv4-mapped IPv6, all obfuscation / short-form variants).
  - Redirect disable (raises on 3xx — Python equiv of TS redirect:'error').
  - Checked host == connected host (2026-11-26): HTTP clients do not reuse
    urlparse(). urllib/http.client keep userinfo, percent-decode the host and split
    the port at the LAST ':' (urlparse: the FIRST); WHATWG parsers (urllib3, so
    requests) end the authority at '\\'. The guard refuses every spelling on which
    parsers can disagree (backslash, whitespace, control chars, userinfo, '%' in the
    host, a second ':' outside brackets, host chars outside [a-z0-9._-] after IDNA)
    and returns a canonical URL rebuilt from the validated parts. Callers fetch THAT.

NOT in scope (deferred per rejection rationale):
  - Host allowlist (would break existing Martians/tests fetching public hosts).
  - HTTPS pin (would break existing http:// tests and non-https callers).
  - Pinning the connection to the vetted IP (DNS rebinding): the name is resolved
    again at connect time.
"""
from __future__ import annotations

import http.client
import ipaddress
import re
import socket
import urllib.request
from typing import Final
from urllib.parse import urlparse, urlsplit, urlunsplit

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
    tool layer and aborting the production Martian run.
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
                # IPv4-mapped IPv6 (::ffff:a.b.c.d) — unwrap to v4 for the block check
                mapped = addr6.ipv4_mapped
                out.append(mapped if mapped is not None else addr6)
        except (ValueError, IndexError):
            continue
    return out


def _ip_is_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """True if ip is loopback / private / link-local / metadata / reserved / multicast."""
    if (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    ):
        return True
    # IPv6 deprecated site-local (fec0::/10) — not covered by is_private in all Python versions
    if isinstance(ip, ipaddress.IPv6Address) and ip.is_site_local:
        return True
    return False


class SsrfBlockedError(ValueError):
    """Raised when the URL is rejected by the SSRF core guard."""


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
        raise SsrfBlockedError(f"Refusing malformed URL: {exc}")
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

    Uses urlsplit(): urlparse() splits ';params' off the last segment and urlunparse()
    drops an EMPTY one, so '/a;' came back as '/a', another resource.
    """
    split = urlsplit(url)
    netloc = f"[{ascii_host}]" if ":" in ascii_host else ascii_host
    if port is not None:
        netloc = f"{netloc}:{port}"
    return urlunsplit((split.scheme, netloc, split.path, split.query, split.fragment))


def assert_safe_fetch_url(raw_url: str) -> str:
    """Validate URL against the SSRF core guard.

    Returns the canonical URL on success, rebuilt from the validated parts:
    lower-case scheme and host, IDNA-encoded host, port only when one was given,
    no userinfo. Fetch the RETURNED URL, never ``raw_url``.
    Raises SsrfBlockedError on rejection (caught by tool → ok=False).
    """
    if not isinstance(raw_url, str) or not raw_url:
        raise SsrfBlockedError("Missing or non-string URL")
    _assert_unambiguous_chars(raw_url)
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
    effective_port = port if port is not None else _DEFAULT_PORTS[parsed.scheme]
    _assert_connects_to(raw_url, host, effective_port)
    ascii_host = _ascii_host(host)

    ips = _resolve_host_ips(host)
    if not ips:
        raise SsrfBlockedError(f"Refusing unresolvable hostname {host!r}")

    for ip in ips:
        if _ip_is_blocked(ip):
            raise SsrfBlockedError(f"Refusing blocked IP {ip} (resolved from {host!r})")

    canonical = _canonical_url(raw_url, ascii_host, port)
    _assert_connects_to(canonical, ascii_host, effective_port)
    return canonical


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Block all 3xx redirects — equiv of TS fetch redirect:'error'."""

    def http_error_302(self, req, fp, code, msg, headers):  # noqa: N802
        raise SsrfBlockedError(f"Redirect to {headers.get('Location')!r} blocked")

    http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302


def build_no_redirect_opener() -> urllib.request.OpenerDirector:
    """Build a urllib opener that does NOT follow redirects."""
    return urllib.request.build_opener(_NoRedirect())
