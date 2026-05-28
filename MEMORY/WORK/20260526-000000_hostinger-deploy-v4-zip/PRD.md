---
task: Upload alienclaw-deploy-v4.zip to Hostinger Node.js app
slug: 20260526-000000_hostinger-deploy-v4-zip
effort: standard
phase: complete
progress: 12/12
mode: interactive
started: 2026-05-26T00:00:00Z
updated: 2026-05-26T00:00:00Z
---

## Context

Upload `/tmp/alienclaw-deploy-v4.zip` to the `api.alienclaw.net` Hostinger Node.js app via hPanel. The zip contains `.npmrc` with `approve-builds=true` to fix pnpm blocking esbuild's build script. Must use SPA navigation (deployments list → click Settings) to avoid Cloudflare redirect. Session cookies loaded from `/tmp/hostinger_session.json`.

### Risks
- Session may be expired → must detect and stop
- File input may be hidden → may need to click upload area first
- Build may fail for reasons beyond .npmrc fix
- SPA navigation may change element refs between screenshots

## Criteria

- [x] ISC-1: Session is valid, not redirected to login page
- [x] ISC-2: Deployments list page loads successfully at correct URL
- [x] ISC-3: Screenshot 60 (deployments list) saved to correct path
- [x] ISC-4: "Settings and redeploy" button found and clicked via SPA navigation
- [x] ISC-5: Settings page loads after SPA click (no Cloudflare block)
- [x] ISC-6: Screenshot 61 (settings page) saved to correct path
- [x] ISC-7: File input found and v4.zip uploaded via setInputFiles
- [x] ISC-8: Screenshot 62 (after upload) saved to correct path
- [x] ISC-9: Save/deploy button found and clicked
- [x] ISC-10: Screenshot 63 (deploying state) saved to correct path
- [x] ISC-11: Build result determined (Completed or Build failed)
- [x] ISC-12: Full build log text captured and included in report

## Decisions

### Build Log (alienclaw-deploy-v4.zip — 2026-05-26 22:43:35)

```
1  Progress: resolved 1, reused 0, downloaded 0, added 0
2  Packages: +16
3  ++++++++++++++++
4  Progress: resolved 42, reused 16, downloaded 0, added 16, done
5  
6  dependencies:
7  + mysql2 3.22.3 (3.22.4 is available)
8  + tsx 4.22.3
9  
10 [ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.0
11 
12 Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
13 ERROR: Failed to install dependencies
```

The `.npmrc` with `approve-builds=true` did NOT take effect. pnpm still blocked esbuild's build script. The error is identical to v3. The `.npmrc` fix is not being applied by the Hostinger build system, or the file was not placed at the correct path inside the zip.

## Verification

- ISC-1/2/3: Deployments page loaded at correct URL, session cookie valid, screenshot 60 captured
- ISC-4/5/6: "Settings and redeploy" clicked via `text=Settings and redeploy` selector; SPA navigated to `/deployments/settings`; screenshot 61 captured
- ISC-7/8: "Upload new files" radio clicked; waited for "Upload your app files" text; file set via `input[type=file].setInputFiles`; screenshot 62 shows "Connecting to file browser" resolved to file browser ready state
- ISC-9/10: "Save and redeploy" button became enabled (disabled=false) on attempt 1 after file upload; clicked; deploy triggered with toast "Deployment started for api.alienclaw.net. Your application is being built."; screenshot 63 shows success toasts
- ISC-11: Build result = **Build failed**. alienclaw-deploy-v4.zip deployed 2026-05-26 22:43:35, took 5s
- ISC-12: Full build log (13 lines) captured — see Decisions section
