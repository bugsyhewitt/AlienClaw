"""
SSRF core guard for url_fetch / http_get.

Scope (per PKT-522 rejection rationale, issues.md:4730 — PKT-577 corrective re-author):
  - Scheme allowlist (http + https only — rejects file, ftp, gopher, data).
  - IP-literal block (loopback, RFC1918, link-local, metadata, multicast,
    reserved, IPv6 ULA, IPv4-mapped IPv6, all obfuscation / short-form variants).
  - Redirect disable (raises on 3xx — Python equiv of TS redirect:'error').

NOT in scope (deferred per rejection rationale):
  - Host allowlist (would break existing Martians/tests fetching public hosts).
  - HTTPS pin (would break existing http:// tests and non-https callers).
"""
from __future__ import annotations

import ipaddress
import socket
import urllib.request
from typing import Final
from urllib.parse import urlparse

_ALLOWED_SCHEMES: Final[frozenset[str]] = frozenset({"http", "https"})


def _resolve_host_ips(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    """Resolve host (name or literal) to all IPs. Catches DNS and numeric obfuscation."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
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


def assert_safe_fetch_url(raw_url: str) -> str:
    """Validate URL against the SSRF core guard.

    Returns the canonical URL on success.
    Raises SsrfBlockedError on rejection (caught by tool → ok=False).
    """
    if not isinstance(raw_url, str) or not raw_url:
        raise SsrfBlockedError("Missing or non-string URL")
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

    ips = _resolve_host_ips(host)
    if not ips:
        raise SsrfBlockedError(f"Refusing unresolvable hostname {host!r}")

    for ip in ips:
        if _ip_is_blocked(ip):
            raise SsrfBlockedError(f"Refusing blocked IP {ip} (resolved from {host!r})")

    return raw_url


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Block all 3xx redirects — equiv of TS fetch redirect:'error'."""

    def http_error_302(self, req, fp, code, msg, headers):  # noqa: N802
        raise SsrfBlockedError(f"Redirect to {headers.get('Location')!r} blocked")

    http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302


def build_no_redirect_opener() -> urllib.request.OpenerDirector:
    """Build a urllib opener that does NOT follow redirects."""
    return urllib.request.build_opener(_NoRedirect())
