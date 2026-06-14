---
task: packet 37.1 close hPanel stored-slot gap
slug: 20260528-000002_packet-37-1-hpanel-stored-slot
effort: advanced
phase: complete
progress: 31/31
mode: interactive
started: 2026-05-28T19:00:00Z
updated: 2026-05-28T19:00:00Z
---

## Context

Packet 37 proved the v9 artifact is correct by extracting it via SFTP and restarting
the app — health returned 200 with uptime_seconds: 0. However the hPanel-managed
deployment slot (Node.js Apps → Deployments in hpanel.hostinger.com) still holds the
broken v8 zip. If a developer clicks "Redeploy" in hPanel, it pulls from the managed
slot, deploys v8, and crashes production.

**Goal:** Use the hPanel panel UI to upload v9 to the managed deployment slot and
trigger a managed redeploy through the panel itself. The proof gate is health 200 AFTER
a hPanel-panel-initiated redeploy. SFTP-path redeploys and SSH restarts do NOT satisfy
the proof.

**Base branch:** packet-37-fix-stored-artifact (PRs #12/#13/#14 not yet merged to main)
**PR target:** packet-37-fix-stored-artifact → PR #15 in merge sequence

**Security constraints:**
- Do NOT commit .env.hostinger or any production credentials. Ever.
- Do NOT paste credentials into chat, PR body, verdict, or any committed file.
- Do NOT proceed past a credential-in-history finding — surface for Bugsy decision.
- Do NOT reference DigitalOcean, Pho3nix, or V3X anywhere in committed files.

### Risks

- Cloudflare may block headless Playwright login to hPanel — need real session strategy
- hPanel deployment model is unknown — must discover what "managed slot" means in UI
- Managed redeploy may briefly take app down — cannot SSH-patch if it crashes (constraint)
- hPanel session may expire mid-packet again (seen in packet-36)
- hPanel UI may have changed since last visit

## Criteria

- [x] ISC-1: branch packet-37.1-hpanel-stored-slot created from packet-37-fix-stored-artifact
- [x] ISC-2: .packet-reports/packet-37.1-screenshots/ directory exists
- [x] ISC-3: scripts/build-deploy.sh runs without error on current branch
- [x] ISC-4: /tmp/alienclaw-deploy.zip created with size under 100KB
- [x] ISC-5: zip contains dist/main.js
- [x] ISC-6: zip contains server.js with no top-level await
- [x] ISC-7: zip contains package.json with mysql2 dependency
- [x] ISC-8: browser session opened to hpanel.hostinger.com
- [x] ISC-9: api.alienclaw.net Node.js Apps page reached in browser
- [x] ISC-10: deployment section identified and screenshotted
- [x] ISC-11: hPanel deployment model documented (zip upload flow understood)
- [x] ISC-12: v9 zip uploaded to hPanel deployment slot via panel UI (not SFTP)
- [x] ISC-13: screenshot captured confirming v9 upload accepted by hPanel
- [x] ISC-14: v9 artifact visible in hPanel deployment UI after upload
- [x] ISC-15: managed redeploy triggered through hPanel panel (not SSH restart)
- [x] ISC-16: hPanel redeploy operation completes with outcome recorded
- [x] ISC-17: screenshot captured showing hPanel post-redeploy state
- [x] ISC-18: api.alienclaw.net/v1/health returns 200 after managed redeploy
- [x] ISC-19: uptime_seconds in health response confirms post-redeploy process start
- [x] ISC-20: /v1/install persistence endpoint returns registered status after redeploy
- [x] ISC-21: Bug #18.1 appended to docs/LESSONS_FROM_THE_ARC.md
- [x] ISC-22: DEPLOY.md updated with hPanel managed-slot upload steps
- [x] ISC-23: all packet-37.1 changes committed with scoped messages
- [x] ISC-24: branch pushed to origin/packet-37.1-hpanel-stored-slot
- [x] ISC-25: PR #15 opened against packet-37-fix-stored-artifact base
- [x] ISC-26: .packet-reports/packet-37.1-verdict.md written with GREEN/RED status
- [x] ISC-A-1: proof from hPanel-panel-initiated redeploy (not SFTP/SSH path)
- [x] ISC-A-2: no SSH patch applied if managed redeploy crashes
- [x] ISC-A-3: no credentials committed to any file
- [x] ISC-A-4: PR not merged by AI
- [x] ISC-A-5: no DigitalOcean/Pho3nix/V3X references in committed files

## Decisions

- 2026-05-28: Branch from packet-37-fix-stored-artifact — PRs #12/#13/#14 not yet merged
- 2026-05-28: hPanel upload is the primary proof gate; SSH verification is secondary
