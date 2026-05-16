# Packet 29 — Architectural Defaults

Five architectural calls made before work began:

1. **Audit-only. No fixes in flight.** The packet finds and documents; it does not patch. Even tempting one-line fixes are deferred to follow-up packets. The reason is methodological: fixing while auditing means losing the honest baseline. The gap list is the deliverable.

2. **Clean-clone from the GitHub remote, not the local working copy.** The audit clones github.com/AlienTool/AlienClaw fresh into /tmp/. It does NOT audit ~/Desktop/alienclaw. The local working copy has uncommitted files, accumulated state, and Bugsy-specific configuration that a stranger would never have.

3. **Follow the README literally.** The auditor does exactly what the README says, in order, with no extrapolation. If the README says "run `npm install`" but the project actually needs `pnpm`, that's a gap — recorded as a gap rather than silently doing the right thing.

4. **Gap severity classification is fixed: launch-blocker / adoption-multiplier / standard-hygiene.** Launch-blocker = a stranger genuinely cannot use the project. Adoption-multiplier = the project works but conversion from visitor to participant is needlessly low. Standard-hygiene = expected files that don't block use but signal project maturity.

5. **No assumptions about what's already there.** Bugsy explicitly said "I don't know if anything works." The audit assumes nothing. Every finding is established by direct observation in the clean environment.
