"""Tests for persistent rate limiter — verifies state survives restart."""
from __future__ import annotations

import time
from pathlib import Path

import pytest

from alienclaw.api.rate_limit import RateLimiter

INSTALL_ID = "a" * 64  # sha256-like hash


@pytest.fixture
def rate_dir(tmp_path: Path):
    return tmp_path / "rate_data"


def make_limiter(rate_dir: Path, limit: int = 100, window: int = 3600) -> RateLimiter:
    return RateLimiter(limit=limit, window_seconds=window, data_root=rate_dir)


class TestPersistence:
    def test_state_persists_across_new_instance(self, rate_dir):
        """Simulating server restart: second RateLimiter reads first's state."""
        rl1 = make_limiter(rate_dir, limit=3)
        rl1.check(INSTALL_ID)  # 1
        rl1.check(INSTALL_ID)  # 2
        rl1.check(INSTALL_ID)  # 3

        # Simulate restart — new instance, same data_root
        rl2 = make_limiter(rate_dir, limit=3)
        allowed, _ = rl2.check(INSTALL_ID)
        assert not allowed, "4th submission should be rejected after restart"

    def test_limit_of_100_persists_across_restart(self, rate_dir):
        rl1 = make_limiter(rate_dir, limit=100)
        for _ in range(100):
            allowed, _ = rl1.check(INSTALL_ID)
            assert allowed

        rl2 = make_limiter(rate_dir, limit=100)
        allowed, retry_after = rl2.check(INSTALL_ID)
        assert not allowed
        assert retry_after > 0

    def test_allowed_submissions_before_limit(self, rate_dir):
        rl = make_limiter(rate_dir, limit=5)
        for i in range(5):
            allowed, _ = rl.check(INSTALL_ID)
            assert allowed, f"Submission {i+1} should be allowed"

    def test_101st_returns_429_style_reject(self, rate_dir):
        rl = make_limiter(rate_dir, limit=100)
        for _ in range(100):
            rl.check(INSTALL_ID)
        allowed, retry_after = rl.check(INSTALL_ID)
        assert not allowed
        assert isinstance(retry_after, int)
        assert retry_after >= 1

    def test_file_created_in_correct_path(self, rate_dir):
        rl = make_limiter(rate_dir)
        rl.check(INSTALL_ID)
        expected = rate_dir / "rate_limit" / INSTALL_ID[:2] / f"{INSTALL_ID}.json"
        assert expected.exists(), f"Rate limit file not found at {expected}"

    def test_file_contents_valid_json_with_timestamps(self, rate_dir):
        import json
        rl = make_limiter(rate_dir)
        rl.check(INSTALL_ID)
        path = rate_dir / "rate_limit" / INSTALL_ID[:2] / f"{INSTALL_ID}.json"
        data = json.loads(path.read_text())
        assert data["install_id"] == INSTALL_ID
        assert isinstance(data["window_timestamps"], list)
        assert len(data["window_timestamps"]) == 1

    def test_pruning_removes_expired_timestamps(self, rate_dir):
        import json
        # Use very short window so entries expire immediately
        rl = make_limiter(rate_dir, limit=5, window=1)
        rl.check(INSTALL_ID)
        rl.check(INSTALL_ID)
        time.sleep(1.1)  # let timestamps expire

        # New instance with same short window — should allow again
        rl2 = make_limiter(rate_dir, limit=5, window=1)
        allowed, _ = rl2.check(INSTALL_ID)
        assert allowed, "Expired entries should be pruned; submission should be allowed"

        # File should only contain the new (non-expired) timestamp
        path = rate_dir / "rate_limit" / INSTALL_ID[:2] / f"{INSTALL_ID}.json"
        data = json.loads(path.read_text())
        assert len(data["window_timestamps"]) == 1

    def test_different_installs_independent(self, rate_dir):
        rl = make_limiter(rate_dir, limit=2)
        install_a = "a" * 64
        install_b = "b" * 64
        rl.check(install_a)
        rl.check(install_a)
        # install_a exhausted
        assert not rl.check(install_a)[0]
        # install_b still fresh
        assert rl.check(install_b)[0]

    def test_remaining_decrements(self, rate_dir):
        rl = make_limiter(rate_dir, limit=10)
        assert rl.remaining(INSTALL_ID) == 10
        rl.check(INSTALL_ID)
        assert rl.remaining(INSTALL_ID) == 9
        rl.check(INSTALL_ID)
        assert rl.remaining(INSTALL_ID) == 8

    def test_no_data_root_falls_back_to_in_memory(self):
        """Without data_root, limiter works in-memory (original behavior)."""
        rl = RateLimiter(limit=3)
        assert rl.check(INSTALL_ID)[0]
        assert rl.check(INSTALL_ID)[0]
        assert rl.check(INSTALL_ID)[0]
        assert not rl.check(INSTALL_ID)[0]

    def test_retry_after_is_positive_integer(self, rate_dir):
        rl = make_limiter(rate_dir, limit=1)
        rl.check(INSTALL_ID)
        allowed, retry_after = rl.check(INSTALL_ID)
        assert not allowed
        assert isinstance(retry_after, int)
        assert retry_after > 0
