# Packet 30 — Architectural Defaults

Five architectural calls made before work began:

1. **Fold the trivial discoverability fixes (D1, D2) into this packet.** Packet 29's gap list put GitHub topics and the stale description in "adoption-multipliers"/"hygiene," recommended for Packet 33. But they're minutes of work and pure-win for discoverability. They fold into Packet 30. Substantive adoption-multiplier work (examples, output, motivation) stays in Packet 32.

2. **MIT license, matching the website's existing claim.** The website already claims MIT. Changing the license to something else would contradict the public claim and potentially affect anyone who engaged under the MIT assumption. The fix makes reality match the existing claim.

3. **L4 fix verified by CI going green, not just by local success.** The install.sh repair isn't done when it works locally — it's done when CI passes. CI being red since May 10 is the symptom; CI green is the cure.

4. **Documentation fixes (L2, L3) written for a literal stranger.** The README additions assume zero prior knowledge. L2 explains which providers work, exactly which env var, exactly how to set it, and what error appears if missing. L3 walks through openclaw configure's actual wizard structure.

5. **No scope creep into Packets 31-33.** This packet does L1-L4 + D1-D2 and stops. No leaderboard (P31), no README onboarding polish beyond install docs (P32), no remaining hygiene (P33).
