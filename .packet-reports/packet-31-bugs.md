# Packet 31 — Bugs

## No new bugs discovered.

The API changes (leaderboard_name field) required updating 13 existing API tests
that passed submission bodies without the new required field — this is expected
scope-widening, not a bug.

One test naming issue: initial tests used `TESTBOT1` which contains a digit,
violating the ^[A-Z]{8}$ constraint. Fixed by using `TESTBOTA`.

One test fixture naming issue: `TOPRANKER` (9 chars) used in the leaderboard
test fixture. Fixed to `TOPRANKR` (8 chars).

Both are test-only issues, not production code defects.
