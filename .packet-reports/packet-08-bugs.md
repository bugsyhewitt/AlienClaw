# Packet 8 Bugs

## Bug 1 — Tournament test assumed sampling without replacement (FIXED)

**Phase:** 4 (selection tests)  
**What happened:** `test_k_equal_size_always_returns_max` asserted that
tournament(pop, k=3, rng) with pool size=3 always returns the max-fitness entry.
It doesn't: sampling is WITH replacement, so tournament can draw the same entry
twice, meaning not all entries appear in every tournament.

**Fix:** Changed assertion from "k=size always returns max" to "k=50 strongly
favors max" (P(not getting max) = (2/3)^50 ≈ 1e-9 — negligible).

**Lesson:** Tournament selection is always with replacement. Document this in
selection.py if non-obvious behavior arises in future tuning.

---

## No other bugs in Packet 8.

All evolution module code was written correctly on first pass.
