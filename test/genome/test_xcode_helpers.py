"""Tests for Xcode encoding helpers (Packet 15)."""

from __future__ import annotations

import pytest

from alienclaw.genome.codec import (
    XCODE_MAX,
    decode_xcode,
    encode_xcode,
    param_value_to_xcode,
    xcode_to_param_value,
)
from alienclaw.genome.operators import random_genome
import random


_WEB_GENOME = random_genome(random.Random(0), "WEB00001")


class TestEncodeXcode:
    def test_zero(self) -> None:
        assert encode_xcode(0) == "00"

    def test_max(self) -> None:
        assert encode_xcode(3843) == "zz"

    def test_sixty_two(self) -> None:
        assert encode_xcode(62) == "10"

    def test_sixty_one(self) -> None:
        assert encode_xcode(61) == "0z"

    def test_below_zero_raises(self) -> None:
        with pytest.raises(ValueError):
            encode_xcode(-1)

    def test_above_max_raises(self) -> None:
        with pytest.raises(ValueError):
            encode_xcode(XCODE_MAX + 1)


class TestDecodeXcode:
    def test_slot_0_xcode_0_reads_bytes_1_2(self) -> None:
        # Build a genome where chars 1-2 are known
        g = list(_WEB_GENOME)
        g[1], g[2] = "1", "0"  # value = 62
        gs = "".join(g)
        assert decode_xcode(gs, 0, 0) == 62

    def test_slot_1_xcode_0_reads_bytes_65_66(self) -> None:
        g = list(_WEB_GENOME)
        g[65], g[66] = "0", "z"  # value = 61
        gs = "".join(g)
        assert decode_xcode(gs, 1, 0) == 61

    def test_slot_2_xcode_0_reads_bytes_129_130(self) -> None:
        g = list(_WEB_GENOME)
        g[129], g[130] = "z", "z"  # value = 3843
        gs = "".join(g)
        assert decode_xcode(gs, 2, 0) == 3843

    def test_slot_index_out_of_range(self) -> None:
        with pytest.raises(ValueError):
            decode_xcode(_WEB_GENOME, 4, 0)
        with pytest.raises(ValueError):
            decode_xcode(_WEB_GENOME, -1, 0)

    def test_xcode_index_out_of_range(self) -> None:
        with pytest.raises(ValueError):
            decode_xcode(_WEB_GENOME, 0, 31)
        with pytest.raises(ValueError):
            decode_xcode(_WEB_GENOME, 0, -1)


class TestRoundTrip:
    @pytest.mark.parametrize("v", [0, 1, 1922, 3842, 3843])
    def test_encode_decode_via_genome(self, v: int) -> None:
        chars = encode_xcode(v)
        # Build a synthetic genome substring
        g = list("0" * 256)
        g[1], g[2] = chars[0], chars[1]
        gs = "".join(g)
        assert decode_xcode(gs, 0, 0) == v


class TestXcodeToParamValue:
    def test_low_bound(self) -> None:
        assert xcode_to_param_value(0, 1, 5) == 1

    def test_high_bound(self) -> None:
        assert xcode_to_param_value(3843, 1, 5) == 5

    def test_monotonic(self) -> None:
        prev = xcode_to_param_value(0, 1, 5)
        for x in (1000, 2000, 3000, 3843):
            cur = xcode_to_param_value(x, 1, 5)
            assert cur >= prev
            prev = cur

    def test_binary_range_split(self) -> None:
        # range [0,1]: half xcode space → 0, other → 1
        below = xcode_to_param_value(1921, 0, 1)
        at = xcode_to_param_value(1922, 0, 1)
        assert below == 0
        assert at == 1

    def test_invalid_range_raises(self) -> None:
        with pytest.raises(ValueError):
            xcode_to_param_value(0, 5, 1)


class TestParamValueToXcode:
    @pytest.mark.parametrize("v,rmin,rmax", [
        (1, 1, 5), (5, 1, 5), (3, 1, 5),
        (0, 0, 1), (1, 0, 1),
        (1, 1, 3), (2, 1, 3), (3, 1, 3),
    ])
    def test_round_trip(self, v: int, rmin: int, rmax: int) -> None:
        x = param_value_to_xcode(v, rmin, rmax)
        assert xcode_to_param_value(x, rmin, rmax) == v

    def test_param_value_out_of_range_raises(self) -> None:
        with pytest.raises(ValueError):
            param_value_to_xcode(6, 1, 5)
        with pytest.raises(ValueError):
            param_value_to_xcode(0, 1, 5)
