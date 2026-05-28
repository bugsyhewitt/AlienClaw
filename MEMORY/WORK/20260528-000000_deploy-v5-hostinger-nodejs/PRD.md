---
task: deploy alienclaw v5 zip to Hostinger Node.js
slug: 20260528-000000_deploy-v5-hostinger-nodejs
effort: standard
phase: complete
progress: 8/8
mode: interactive
started: 2026-05-28T00:00:00Z
updated: 2026-05-28T08:20:00Z
---

## Context

Deploy alienclaw-deploy-v5.zip to the Hostinger Node.js app for api.alienclaw.net using a Node.js Playwright script with session cookies. The upload required clicking a custom React radio button ("Upload new files"), waiting for a custom file browser component to connect (~5s), then using setInputFiles on the hidden `files-uploader__hidden-file-input` element.

### Result
- Deployment status: BUILD FAILED
- File: alienclaw-deploy-v5.zip
- Deployed: 2026-05-28 08:17 (7s deploy time)
- Root cause: `[ERR_PNPM_IGNORED_BUILDS]` — pnpm 11.x blocked build scripts for @google/genai, esbuild, protobufjs
- Fix needed: add `pnpm.onlyBuiltDependencies` or `pnpm approve-builds` config to zip

## Criteria

- [x] ISC-1: Session cookies loaded and hPanel session validated
- [x] ISC-2: api.alienclaw.net dashboard navigated via SPA click
- [x] ISC-3: Settings and redeploy page reached without Cloudflare block
- [x] ISC-4: Upload new files radio clicked and file browser connected
- [x] ISC-5: alienclaw-deploy-v5.zip set via files-uploader hidden input
- [x] ISC-6: Save and redeploy button clicked and deployment triggered
- [x] ISC-7: Build result status obtained (FAILED)
- [x] ISC-8: Full build log extracted (35 lines)

## Decisions

- Used `button.deployment-archive-source-files-card__option` nth(1) to click Upload new files (React custom radio, not HTML input)
- Waited for `text=Upload your app files` (up to 40s) to confirm file browser connected
- Used `[class*="files-uploader"] input[type=file]` for setInputFiles (NOT the env vars input)
- Navigated to build log via "Logs: collected" link on dashboard

## Verification

Build log extracted from deployment details page UUID 019e6e84-d71a-712d-bbc7-7ff4e30648f4.
Screenshot: log-03-logs.png confirms deployment details page with full 35-line build log visible.
