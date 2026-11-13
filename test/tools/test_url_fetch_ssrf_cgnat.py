"""PKT-1367 — CGNAT 100.64.0.0/10 must be blocked by the Python SSRF guard."""
from __future__ import annotations

import pytest
from alienclaw.tools.url_fetch import run as url_fetch_run


@pytest.mark.parametrize("url", [
    "http://100.64.0.1/",          # CGNAT 100.64/10 low
    "http://100.64.0.255/",        # CGNAT 100.64/10 /24
    "http://100.127.255.255/",     # CGNAT 100.64/10 high
    "http://100.100.100.100/",     # CGNAT midpoint
    "http://100.64.0.1:8080/",     # CGNAT with explicit port
    "http://100.64.0.1/path?q=1",  # CGNAT with path + query
])
def test_url_fetch_blocks_cgnat(url: str) -> None:
    r = url_fetch_run({"url": url})
    assert r.ok is False
    assert r.correctness == 0.0
    err = (r.error or "").lower()
    assert "refusing" in err or "blocked" in err, (
        f"CGNAT URL {url!r} was not blocked by the SSRF guard: {r.error!r}"
    )


@pytest.mark.parametrize("url", [
    "http://100.63.0.1/",          # just below CGNAT (100.63.0.0/16)
    "http://100.128.0.1/",         # just above CGNAT (100.128.0.0/9)
])
def test_url_fetch_does_not_block_adjacent_to_cgnat(url: str) -> None:
    import signal
    class _Timeout(Exception): pass
    def _handler(signum, frame): raise _Timeout()
    signal.signal(signal.SIGALRM, _handler)
    signal.alarm(2)
    try:
        r = url_fetch_run({"url": url})
    except _Timeout:
        return  # not blocked — guard passed it through to urllib
    finally:
        signal.alarm(0)
    if r.error:
        err = r.error.lower()
        assert "refusing" not in err, f"Adjacent-to-CGNAT {url!r} was blocked: {r.error!r}"
        assert "blocked" not in err, f"Adjacent-to-CGNAT {url!r} was blocked: {r.error!r}"
