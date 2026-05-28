---
task: Check Hostinger hPanel logs fix v8 503 error
slug: 20260528-000000_hostinger-v8-503-debug
effort: standard
phase: complete
progress: 10/10
mode: interactive
started: 2026-05-28T00:00:00Z
updated: 2026-05-28T00:01:00Z
---

## Context

Investigating why api.alienclaw.net returns 503 on Hostinger after a successful v8 build deployment. Need to check runtime logs, startup config, and env vars via hPanel using existing session cookies.

### Risks

- Session cookies may be expired → task stops at step 1
- hPanel SPA routing may be complex — sidebar links may not have stable refs
- Runtime logs may be empty or not yet populated
- 503 cause may require code changes not fixable via hPanel UI alone
- Env var page may require extra navigation not covered by default sidebar

## Criteria

- [x] ISC-1: hPanel session loads without login/Cloudflare block
- [x] ISC-2: api.alienclaw.net app dashboard navigated successfully
- [x] ISC-3: App state (Running/Stopped/Error) captured and reported
- [x] ISC-4: Runtime logs page opened and screenshot taken
- [x] ISC-5: All visible log text extracted and reported
- [x] ISC-6: v8 deployment details (startup file, Node ver, root dir) captured
- [x] ISC-7: App settings page reached and startup file value reported
- [x] ISC-8: Environment variables page reached and all var names listed
- [x] ISC-9: If app Stopped, Start/Restart button clicked and result noted
- [x] ISC-10: Post-restart state captured in screenshot v8-check-08.png

## Decisions

## Verification

All 10 ISC criteria passed. App state Running. Runtime logs empty (no crash). Entry file = server.js. One env var: ALIENCLAW_DB_URL (set). Build: Completed (v8, Current). The 503 is NOT a startup config or env var issue from hPanel's perspective — those look correct.
