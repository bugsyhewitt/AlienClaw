# Packet 31 — Architectural Defaults

1. **Hostinger capability audit before deployment design.** Phase 2 inventoried
   what the Hostinger plan supports (MySQL + Deployments + Environment variables).
   Deployment designed against real capability: MySQL + Python/Node.js hosting.

2. **The trust model is enforced in code, not documentation.** Pull-only is
   structural (no listener). Inert-data is enforced by whitelist validation that
   throws on unexpected fields. File-mediated is enforced by submitFromFile being
   a separate function. Name-constrained is at 3 code points + DB CHECK.

3. **Trust-the-number for v1; re-verification deferred.** API accepts submitted
   fitness values. Documented as gameable. Server-side re-verification is a
   named future packet with sketched architecture.

4. **The leaderboard check is a CreatorBot custodial routine.** Per the locked
   workflow: CreatorBot does custodial work. leaderboardCheck() is called on
   CreatorBot's schedule. Not a Subagent campaign, not a Martian task.

5. **MySQL replaces Postgres.** Hostinger plan has MySQL (confirmed from screenshot),
   not Postgres. MySQL provides the same migration-managed persistence with the
   same discipline. Schema in migrations/001_leaderboard.sql.

6. **Fetch is defensively hardened.** Size limit, timeout, whitelist validation,
   no executable deserialization, defense-in-depth name re-validation.
