"""
test_server_martian_type_guard.py — PKT-809 regression suite

Verifies that bridge/server.py::handle() summon arm REJECTS malformed
martian_type values at the parse boundary, returning MALFORMED_REQUEST
instead of crashing the subprocess with TypeError (unhashable type)
or silently falling through to UNKNOWN_MARTIAN_TYPE.

Live defect at HEAD 83ca4b87:
  martian_type = []   → TypeError: unhashable list  (subprocess crash)
  martian_type = {}   → TypeError: unhashable dict  (subprocess crash)
  martian_type = True → UNKNOWN_MARTIAN_TYPE (misleading — should be MALFORMED_REQUEST)
  martian_type = 123  → UNKNOWN_MARTIAN_TYPE (misleading)
  martian_type = None → UNKNOWN_MARTIAN_TYPE (misleading)
  martian_type = ""   → UNKNOWN_MARTIAN_TYPE (misleading — empty string is not "unknown")

Symmetric to PKT-799/800 subprocess-crash class (output-side json.dumps TypeError).
Mirrors the live-evo guard at server.py:261 and the summon-from-population
guard at server.py:322 — only the summon arm at L229 was missing the guard.

This file asserts the FIXED behavior. RED on HEAD 83ca4b87; GREEN after
applying the §4 src diff to server.py:229.
"""
from __future__ import annotations

import json
import random

import pytest

from alienclaw.bridge.server import handle
from alienclaw.genome.operators import random_genome


@pytest.fixture
def good_genome() -> str:
    return random_genome(random.Random(42), "COMPUT01")


def _summon_envelope(martian_type, genome: str) -> bytes:
    return json.dumps({
        "bridge_version": "1.0",
        "request_id": "pkt809-verify",
        "request": {
            "kind": "summon",
            "genome": genome,
            "martian_type": martian_type,
            "inputs": {"input": "1+1"},
            "timeout_ms": 30000,
        },
    }).encode()


class TestMartianTypeSummonGuard:
    """PKT-809: malformed martian_type must return MALFORMED_REQUEST, not crash."""

    # ── Reject (MALFORMED_REQUEST, no subprocess crash) ──────────────────────

    @pytest.mark.parametrize("bad_type", [[], {}])
    def test_martian_type_unhashable_returns_malformed(self, good_genome, bad_type):
        """martian_type = [] or {} → was TypeError; fix → MALFORMED_REQUEST.

        Live on HEAD 83ca4b87:
          TypeError: cannot use 'list' as a dict key (unhashable type: 'list')
          TypeError: cannot use 'dict' as a dict key (unhashable type: 'dict')

        The bridge subprocess crashes with rc=1, no stdout — caller sees only
        "bridge subprocess did not return a response" (PKT-799/800 class).
        """
        resp = handle(_summon_envelope(bad_type, good_genome))
        assert resp["response"]["ok"] is False
        assert resp["response"]["error"]["code"] == "MALFORMED_REQUEST"
        assert "martian_type" in resp["response"]["error"]["message"].lower()

    @pytest.mark.parametrize("bad_type", [True, False, 123])
    def test_martian_type_non_string_scalar_returns_malformed(self, good_genome, bad_type):
        """martian_type = bool/int → was UNKNOWN_MARTIAN_TYPE (misleading);
        fix → MALFORMED_REQUEST. Defense-in-depth: hashable scalars should still
        be rejected at the type guard, not silently passed to registry.has()."""
        resp = handle(_summon_envelope(bad_type, good_genome))
        assert resp["response"]["ok"] is False
        assert resp["response"]["error"]["code"] == "MALFORMED_REQUEST"
        assert "martian_type" in resp["response"]["error"]["message"].lower()

    def test_martian_type_none_returns_malformed(self, good_genome):
        """martian_type = None → was UNKNOWN_MARTIAN_TYPE; fix → MALFORMED_REQUEST."""
        resp = handle(_summon_envelope(None, good_genome))
        assert resp["response"]["ok"] is False
        assert resp["response"]["error"]["code"] == "MALFORMED_REQUEST"

    def test_martian_type_empty_string_returns_malformed(self, good_genome):
        """martian_type = '' → was UNKNOWN_MARTIAN_TYPE (misleading — empty
        string is not 'unknown'); fix → MALFORMED_REQUEST."""
        resp = handle(_summon_envelope("", good_genome))
        assert resp["response"]["ok"] is False
        assert resp["response"]["error"]["code"] == "MALFORMED_REQUEST"

    # ── Regression: existing happy paths still work ─────────────────────────

    def test_martian_type_valid_string_succeeds(self, good_genome):
        """Regression: 'compute' is a registry alias — should still succeed."""
        resp = handle(_summon_envelope("compute", good_genome))
        assert resp["response"]["ok"] is True

    def test_martian_type_unknown_string_returns_unknown(self, good_genome):
        """Regression: unknown string still returns UNKNOWN_MARTIAN_TYPE
        (not MALFORMED_REQUEST — that comes only for malformed types)."""
        resp = handle(_summon_envelope("definitely_not_registered", good_genome))
        assert resp["response"]["ok"] is False
        assert resp["response"]["error"]["code"] == "UNKNOWN_MARTIAN_TYPE"
