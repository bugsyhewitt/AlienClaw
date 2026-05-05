# Packet 9 Report — alienclaw.net Rebuild

**Started from:** commit 6b0bb9bc (chore: packet-08 final report artifacts)  
**Completed:** 2026-05-06  
**Commits in packet:** 5

---

## Phases completed

| Phase | Deliverable | Commit |
| --- | --- | --- |
| 1.5 | rule5-channel-isolation fix — `AgentChannel.history()` bidirectional | `cb73a1b5` |
| 3+4 | Static site (5 pages + stylesheet + favicon) + deploy scripts | `e865ac0e` |
| 7 | LESSONS_FROM_THE_ARC.md — Packet 8 neutral-evolution research note | `6cda9088` |
| 8 | CI — site structural integrity check + anti-tracking guardrail | `ab988fa6` |

---

## Phase 6 — PENDING Bugsy's input

Production deploy to alienclaw.net is the only remaining work. Blocked on:

1. **Hostinger SSH credentials** — `ALIENCLAW_DEPLOY_HOST`, `ALIENCLAW_DEPLOY_USER`, `ALIENCLAW_DEPLOY_PATH`, optionally `ALIENCLAW_DEPLOY_PORT` and `ALIENCLAW_DEPLOY_SSH_KEY`
2. **Bugsy's review** of the new site via local preview before production

To deploy once credentials are available:

```bash
# Set env vars (do NOT commit these)
export ALIENCLAW_DEPLOY_HOST=...
export ALIENCLAW_DEPLOY_USER=...
export ALIENCLAW_DEPLOY_PATH=...

# Local preview
./scripts/local-preview.sh
# → Open http://localhost:8000, review all 5 pages

# Staging deploy
./scripts/deploy.sh --staging
# → Review at staging URL

# Production (after Bugsy approval)
./scripts/deploy.sh
```

The deploy log (`packet-09-deploy-log.md`) will be written after production deploy.

---

## New files

**Site:**
- `site/index.html` — elevator pitch, status, how-it-works ASCII diagram
- `site/about.html` — architecture diagram, genome format, environmental thesis, OSS rationale
- `site/api.html` — api.alienclaw.net placeholder, planned endpoints, coming with Packet 10
- `site/leaderboard.html` — placeholder tables, Packet 10 wires data
- `site/donate.html` — GitHub Sponsors link, "I made this thing" tone
- `site/styles.css` — single stylesheet, black/green palette, system fonts, mobile-first
- `site/favicon.ico` — minimal 16×16 green-on-black A icon (894 bytes)

**Scripts:**
- `scripts/deploy.sh` — SSH + rsync deploy; --dry-run; --staging; credentials from env
- `scripts/local-preview.sh` — python3 -m http.server on site/
- `scripts/README.md` — setup checklist, env var reference, security notes

**Modified:**
- `src/alienclaw/comms/agent-channel.ts` — history() bidirectional fix
- `test/rule5-channel-isolation.test.ts` — updated to match correct bidirectional contract
- `docs/LESSONS_FROM_THE_ARC.md` — Packet 8 neutral-evolution research note added
- `.github/workflows/ci.yml` — site structural check added

---

## Visual review checklist

- [x] All 5 pages serve HTTP 200 locally
- [x] Doctype present on all HTML files
- [x] No bare `#` hrefs
- [x] No external script src or CSS href
- [x] Total site size: 25 KB (under 50 KB target)
- [x] h1 appears once per page; headings are logically nested
- [x] Black/green (#00ff88) palette inherited from existing live page
- [ ] Mobile viewport at 375/768/1280 — requires browser; not yet done; CSS is mobile-first
- [ ] Production HTTP 200 — pending Phase 6 deploy

---

## Rule5 fix summary

`AgentChannel.history(agentA, agentB)` was filtering unidirectionally (only
`from===A && to===B`). The spec intent is bidirectional. This was bug #7 in the
arc, outstanding since Packet 6. Fixed in Phase 1.5. All 251 TypeScript tests
now pass. All 360 Python tests pass.

---

## Pre-existing facts confirmed unchanged

- `src/alienclaw/` — zero modifications
- `seed/`, `installer/`, `docs/specs/` — zero modifications
- No credentials committed (verified: `git log --all -p | grep -iE 'PRIVATE|RSA|BEGIN'` returns nothing)
