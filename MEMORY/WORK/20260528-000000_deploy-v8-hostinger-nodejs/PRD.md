---
task: deploy v8 zip to Hostinger Node.js app
slug: 20260528-000000_deploy-v8-hostinger-nodejs
effort: standard
phase: execute
progress: 0/10
mode: interactive
started: 2026-05-28T00:00:00Z
updated: 2026-05-28T00:01:00Z
---

## Context

Deploy alienclaw-deploy-v8.zip to Hostinger Node.js app for api.alienclaw.net.
v8 pre-compiles everything — pnpm only needs mysql2 (no esbuild, no tsx build scripts needed).
v7 failed: `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.0` + tsx present.
Using session cookies from /tmp/hostinger_session.json (65 cookies).
Node.js 22.x, Framework: Other, Build and output settings: Custom.

### Risks

- Session cookies may have expired since v7 run
- Cloudflare challenge could block the panel
- Upload file input may be hidden/not visible until radio selected
- Save button timing may vary
- Build log may require scrolling to see full content

## Criteria

- [ ] ISC-1: Browser launches and hpanel.hostinger.com loads without login redirect
- [ ] ISC-2: api.alienclaw.net website is found and clicked in panel
- [ ] ISC-3: Deployments section opens in left sidebar
- [ ] ISC-4: Settings and redeploy page loads without Cloudflare block
- [ ] ISC-5: Upload new files option selected successfully
- [ ] ISC-6: v8.zip file uploaded via file input without error
- [ ] ISC-7: Save/Deploy button clicked after upload
- [ ] ISC-8: Deployment polling completes with Completed or Build failed status
- [ ] ISC-9: Build log text extracted and logged to console
- [ ] ISC-10: App URL confirmed if deployment succeeded

## Decisions

Using Node.js Playwright with DISPLAY=:1 headed chromium.
Script at /tmp/deploy-v8.mjs polls every 20s up to 8 min.

## Verification
