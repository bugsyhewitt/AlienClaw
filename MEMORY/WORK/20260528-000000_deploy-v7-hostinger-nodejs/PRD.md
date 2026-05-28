---
task: deploy v7 zip to Hostinger Node.js app
slug: 20260528-000000_deploy-v7-hostinger-nodejs
effort: standard
phase: complete
progress: 20/24
mode: interactive
started: 2026-05-28T00:00:00Z
updated: 2026-05-28T10:10:00Z
---

## Context

Deploy `/tmp/alienclaw-deploy-v7.zip` to the Hostinger Node.js app for `api.alienclaw.net` using session cookies. Uses headed Node.js Playwright with DISPLAY=:1 (not playwright-cli). Follows an exact 11-step script. Must report final status and full build log.

### Risks
- Session cookies may have expired mid-run
- Cloudflare challenge may intercept
- File upload input may be hidden (needs setInputFiles)
- Save button may not enable if file not recognized
- Build may fail with non-obvious error in log

## Criteria

- [x] ISC-1: Script launches headed Chromium on DISPLAY=:1
- [x] ISC-2: hpanel.hostinger.com loads without login redirect
- [x] ISC-3: v7-01.png screenshot captured after page load
- [x] ISC-4: NPS/survey modal dismissed if present
- [x] ISC-5: v7-02.png screenshot captured after modal step
- [x] ISC-6: api.alienclaw.net site row found and clicked in list
- [x] ISC-7: v7-03.png screenshot captured after site click
- [x] ISC-8: Deployments sidebar link found and clicked
- [x] ISC-9: v7-04.png screenshot captured after deployments click
- [x] ISC-10: Settings and redeploy button found and clicked
- [x] ISC-11: v7-05.png screenshot captured after settings click
- [x] ISC-12: Upload new files radio selected, upload area visible
- [x] ISC-13: v7-06.png screenshot captured after radio click
- [x] ISC-14: v7.zip set on hidden file input via setInputFiles
- [x] ISC-15: v7-07.png screenshot captured after file set
- [x] ISC-16: Save/deploy button enabled and clicked
- [x] ISC-17: v7-08.png screenshot captured after deploy click
- [x] ISC-18: Deployment polling loop runs until Completed or Build failed
- [x] ISC-19: v7-wait-N.png screenshots captured each poll cycle
- [x] ISC-20: Top deployment row clicked to open details/log
- [x] ISC-21: v7-09-result.png screenshot captured
- [x] ISC-22: Build log text extracted from pre or main element
- [x] ISC-23: v7-10-log.png screenshot captured
- [x] ISC-24: Final status and full build log reported to user

## Decisions

- "Upload new files" is a `<button>` element, not `<input type=radio>` — must click it as a button
- Cookie expires values are in milliseconds (JS Date.now()), must divide by 1000 for Playwright
- Playwright requires playwright 1.60.0 with chromium-1223; alpha 1.61 needs chromium-1224 (not installed)
- page.reload() triggers Cloudflare challenge; use history.pushState() for SPA re-navigation
- file input[0] is `.files-uploader__hidden-file-input` (ZIP), file input[1] is the .env importer

## Verification

- ISC-1 through ISC-19: Confirmed via script logs and screenshots v7-01 through v7-wait-2
- ISC-20/21: v7-09-result.png shows Deployment details page with State: Build failed, File: alienclaw-deploy-v7.zip
- ISC-22/23: v7-10-log.png shows Build logs section, all 13 lines extracted
- ISC-24: Full build log reported below — 13 lines, final line "ERROR: Failed to install dependencies" due to pnpm requiring approve-builds for esbuild@0.28.0
