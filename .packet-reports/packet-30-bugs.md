# Packet 30 — Bugs Discovered

No new bugs discovered in this packet beyond those inherited.

## Inherited issue (from Packet 29 commit)

The Packet 29 commit (cf2376b1) accidentally included partially-complete TypeScript
governance files from Packets 13-28 development arc that were already staged in
the git index. These files (governance/common/governance-loop.ts, subagent.ts,
and related) have TypeScript compile errors in the committed state because their
dependencies (subagent/ directory modules, types.ts updates) were not included.

This is not a new bug but an incomplete commit state that blocks CI from going
fully green. Resolution: commit the complete Packets 13-28 arc in a follow-up
(Packet 31 scope or dedicated patch packet).

## Bridge test failures

Pre-existing CI failure: `test/bridge/ts-bridge-fixture.test.ts` cases fail in
the committed state because the bridge runner code was restructured in Packets
13-28 but those changes are not yet pushed. The committed bridge tests expect
behavior from the new bridge, but the committed bridge code is the old version.
Same resolution: commit the complete development arc.
