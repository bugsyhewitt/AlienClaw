# Packet 9 — Existing Site Audit

**Audited:** 2026-05-06

---

## DNS state

```
alienclaw.net        → 147.79.120.242 (Hostinger IP)
www.alienclaw.net    → www.alienclaw.net.cdn.hstgr.net (Hostinger CDN)
                       147.79.120.247, 148.135.128.168
api.alienclaw.net    → (not resolved — Packet 10)
```

## Current served content

- **HTTP status:** 200 OK
- **Server:** Hostinger (security headers present: CSP, CORP, COOP, HSTS)
- **Content-Type:** text/html; charset=UTF-8
- **Size:** 415 lines (single-file page)
- **Last-Modified:** not sent (dynamic header absent)

## What the current page is

Single HTML file with inline `<style>` and inline `<script>`. Design: black background (#0a0a0a), green text (#00FF88), monospace font ("Courier New"). Has:

- Hero: "🛸 ALIENCLAW — AI agents that evolve from every run."
- Donate link (href="#" — placeholder, not wired to anything)
- Leaderboard section with JavaScript that fetches from `/api/v1/leaderboard/tags`
  and `/api/v1/leaderboard?toolTag=...` — both return 404 (API not yet built)
- Empty-state message: "Select a tool tag to view the leaderboard."

The page is visually polished but functionally broken (leaderboard data doesn't load).
No external CSS, no external JS imports. Self-contained.

## Replacement approach (Packet 9)

Rebuild as 5 separate HTML pages + one stylesheet. Keep the black/green aesthetic
that's already live. Preserve the existing "AI agents that evolve from every run" tagline.
Drop the broken `/api/v1` JS calls — replace with a placeholder table and "Coming with Packet 10."

## Hostinger access

**PENDING Bugsy's input for Phase 6 (production deploy):**

- SSH hostname: `ALIENCLAW_DEPLOY_HOST` (not yet provided)
- SSH username: `ALIENCLAW_DEPLOY_USER` (not yet provided)
- Remote path: `ALIENCLAW_DEPLOY_PATH` — likely `~/public_html/` or `~/domains/alienclaw.net/public_html/`
- SSH key: `ALIENCLAW_DEPLOY_SSH_KEY` (not yet provided)

The deploy script (Phase 4) reads these from environment variables. Phase 6 gates on Bugsy providing them.

## GitHub Sponsors URL

**PENDING Bugsy's input:**

The donate page links to `https://github.com/sponsors/BUGSY-GITHUB-USERNAME`. Bugsy provides their GitHub username. If Sponsors aren't set up yet, the page links to the GitHub repo instead (with a note to set up Sponsors).

## Decisions made during Phase 2

- Keep black/green (#00FF88) aesthetic — it's already live and polished
- 5 separate HTML pages (not single-file) for nav clarity and Packet 10 swappability
- styles.css reuses the color palette from the current page
- Deploy script uses rsync --delete-after to atomically swap the site
