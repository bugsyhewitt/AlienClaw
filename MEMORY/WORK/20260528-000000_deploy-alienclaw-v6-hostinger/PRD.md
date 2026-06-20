---
task: deploy alienclaw v6 zip to hostinger nodejs
slug: 20260528-000000_deploy-alienclaw-v6-hostinger
effort: standard
phase: complete
progress: 17/19
mode: interactive
started: 2026-05-28T00:00:00Z
updated: 2026-05-28T00:00:00Z
---

## Context

Deploy `/tmp/alienclaw-deploy-v6.zip` to the Hostinger Node.js app at `api.alienclaw.net` using session cookies from `/tmp/hostinger_session.json`. Browser automation via Node.js Playwright (headed, DISPLAY=:1). Screenshots prefixed `v6-` in the packet-35 shots dir. Must report final status and full build log text.

### Risks
- Session cookies may be expired (Hostinger sessions time out)
- Cloudflare challenge may appear after navigation
- NPS/survey modals may block UI
- File input may be hidden (use setInputFiles)
- Deploy may fail due to build errors in the zip
- SPA navigation requires click-based nav, not direct goto

## Criteria

- [x] ISC-1: hpanel.hostinger.com loads (not login redirect)
- [x] ISC-2: v6-01.png screenshot captured of hpanel landing
- [x] ISC-3: api.alienclaw.net site row found and clicked
- [x] ISC-4: v6-02.png screenshot captured of site overview
- [x] ISC-5: Deployments section opened via SPA click
- [x] ISC-6: v6-03.png screenshot captured of deployments list
- [x] ISC-7: Settings/redeploy panel opened
- [x] ISC-8: v6-04.png screenshot captured of settings panel
- [x] ISC-9: "Upload new files" radio selected
- [x] ISC-10: v6-05.png screenshot captured showing upload area
- [x] ISC-11: `/tmp/alienclaw-deploy-v6.zip` set on file input (files-uploader__hidden-file-input, 419.58 KB)
- [x] ISC-12: v6-06.png screenshot captured showing file set
- [x] ISC-13: Save/deploy button clicked after becoming enabled (not disabled)
- [x] ISC-14: v6-07.png screenshot captured after deploy triggered
- [x] ISC-15: Deployment polling completes with final status (BUILD_FAILED after 2 polls)
- [x] ISC-16: v6-08-result.png screenshot captured of final status (shows deployments list)
- [x] ISC-17: Build log row visible — session expired before row click succeeded
- [x] ISC-18: v6-09-log.png screenshot captured (shows dashboard with "Build failed" state)
- [ ] ISC-19: Full build log text extracted and reported (session expired; partial from dashboard)

## Decisions

## Verification

- ISC-1 to ISC-14: All passed — session valid at deploy time, file correctly uploaded (419.58 KB shown in UI), Save and redeploy button enabled and clicked successfully.
- ISC-15: BUILD_FAILED status detected after poll 2 (40s into polling).
- ISC-16: v6-08-result.png shows full deployments list — alienclaw-deploy-v6.zip at 08:46:00 with "Build failed" status.
- ISC-17/18: v6-09-log.png captured dashboard showing "State: Build failed, Deployed: 2026-05-28 08:46 · 21s, File: alienclaw-deploy-v6.zip, Logs: collected".
- ISC-19: PARTIAL — session expired before full build log could be extracted. Dashboard text shows deployment metadata but not the full build log contents. The "collected" link is a Vue Router link with no href, requires live session to click.
