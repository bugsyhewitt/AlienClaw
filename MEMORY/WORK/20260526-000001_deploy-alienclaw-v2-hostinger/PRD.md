---
task: Deploy v2 zip to Hostinger Node.js app
slug: 20260526-000001_deploy-alienclaw-v2-hostinger
effort: standard
phase: execute
progress: 0/12
mode: interactive
started: 2026-05-26T00:00:01Z
updated: 2026-05-26T00:00:10Z
---

## Context

Deploy alienclaw-deploy-v2.zip to the api.alienclaw.net Node.js app on Hostinger hpanel. The v2 zip includes the pnpm onlyBuiltDependencies fix. After deployment, set ALIENCLAW_DB_URL env var. Also delete 3 accidental junk temp sites.

### Risks
- Session may be expired (hpanel sessions can be short-lived)
- Deployment UI may differ from previous attempts
- File upload input may be hidden/dynamic requiring extra interaction
- Deployment may fail with pnpm errors despite the fix
- Junk site deletion may require confirmation dialogs

## Criteria

- [ ] ISC-1: Session cookie loads successfully without login redirect
- [ ] ISC-2: Screenshot 25-api-dashboard.png saved showing dashboard
- [ ] ISC-3: Screenshot 26-deployments.png saved showing deployments page
- [ ] ISC-4: Zip file uploaded via file input on deployments page
- [ ] ISC-5: Screenshot 27-upload-triggered.png saved after upload
- [ ] ISC-6: Deployment completes with "Completed" or "Success" status
- [ ] ISC-7: Screenshot 28-deployment-done.png saved after completion
- [ ] ISC-8: ALIENCLAW_DB_URL env var added on environment variables page
- [ ] ISC-9: Screenshot 29-env-vars.png and 30-env-saved.png saved
- [ ] ISC-10: Junk site api-alienclaw-net-844062 deleted
- [ ] ISC-11: Junk site api-alienclaw-net-168238 deleted
- [ ] ISC-12: Junk site api-alienclaw-net-366472 deleted

## Decisions

## Verification
