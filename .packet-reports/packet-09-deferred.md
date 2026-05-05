# Packet 9 Deferred

| Item | Deferred to | Rationale |
| --- | --- | --- |
| GitHub Sponsors enrollment | Bugsy's action | Must be done by Bugsy on github.com — not a code change; donate.html links to the repo as placeholder |
| Production deploy to Hostinger | Phase 6 (PENDING Bugsy's credentials) | Requires ALIENCLAW_DEPLOY_HOST/USER/PATH env vars from Bugsy; deploy script is ready |
| Donate.html Sponsors URL | After enrollment | Update href in donate.html from repo link to https://github.com/sponsors/<username> |
| Privacy-respecting analytics | Future | GoatCounter or Plausible-self-hosted; not in v1.0; would need CI anti-tracking exemption |
| Contact form / mailing list | Out of scope | Discord link in README is the community channel |
| Blog / changelog | Out of scope | Static HTML hand-edited; no CMS needed for current content volume |
| Logo / brand asset upgrade | Packet 11+ | Current favicon is a minimal 16×16 placeholder; proper logo when project has broader community |
| Hostinger SSH key setup docs | scripts/README.md expanded | High-level notes are there; Hostinger-specific steps depend on their control panel UI |
| Packet 8.5 — tool-runner sensitivity audit | Before Packet 10 | Documented in LESSONS_FROM_THE_ARC.md; blocks Packet 10 meaningful use |
| api.alienclaw.net server | Packet 10 | api.html is a placeholder; server doesn't exist yet |
| Leaderboard data feed | Packet 10 | leaderboard.html has placeholder tables; data source is api.alienclaw.net/v1/genomes/top |
| CreatorBot 3-4 day leaderboard sync | Packet 10 | Governance layer doesn't touch leaderboard yet |
