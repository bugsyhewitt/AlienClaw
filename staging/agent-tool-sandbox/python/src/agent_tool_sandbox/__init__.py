"""agent-tool-sandbox: an SSRF guard and a filesystem-boundary jail for agent tools."""
from __future__ import annotations

from .boundary import assert_inside_boundary, assert_no_symlink
from .ssrf_guard import SsrfBlockedError, assert_safe_fetch_url, build_no_redirect_opener

__all__ = [
    "SsrfBlockedError",
    "assert_inside_boundary",
    "assert_no_symlink",
    "assert_safe_fetch_url",
    "build_no_redirect_opener",
]

__version__ = "0.0.0.dev0"
