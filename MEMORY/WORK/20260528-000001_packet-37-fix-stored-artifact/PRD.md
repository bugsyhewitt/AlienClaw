---
task: packet 37 rebuild replace stored Hostinger deploy artifact
slug: 20260528-000001_packet-37-fix-stored-artifact
effort: advanced
phase: execute
progress: 24/28
mode: interactive
started: 2026-05-28T18:00:00Z
updated: 2026-05-28T18:05:00Z
---

## Context

api.alienclaw.net is live only because server.js was re-patched live via SSH in
Packet 36. The stored Hostinger artifact (alienclaw-deploy-v8.zip) still contains
the BROKEN server.js with top-level await. A Hostinger redeploy from stored zip
would overwrite the live patch and crash production.

**Goal:** Build a corrected artifact (v9), extract it to the server (replacing the
running files), verify the app stays live from the extracted artifact content (not
the live patch), add a reproducible build script with top-level-await guard.

**Note:** PRs #12 and #13 are not yet merged to main. Branching from
packet-36-cleanup-polish which contains the corrected server.js. hPanel session
is expired — cannot upload zip via hPanel UI this packet. The hPanel upload to
replace the "stored artifact" in Hostinger's system is documented as outstanding.
The proof this packet delivers: extract the new zip manually via SSH, app stays
up, no live patch is load-bearing.

**Constraints:**
- Do NOT fix by re-applying SSH patch — the artifact is the fix
- Do NOT bundle node_modules (Hostinger runs pnpm install post-extract)
- Do NOT commit credentials
- Do NOT merge PR
- Brand wall: no DigitalOcean/Pho3nix/V3X

### Risks

- esbuild entry path may differ from v8 recipe — need to verify
- mysql2 requires native build (excluded from bundle via --external:mysql2)
- server structure on Hostinger: need to replace nodejs/ files cleanly without
  losing the .builds/config/.env or the tmp/ restart mechanism

## Criteria

- [x] ISC-1: packet-37-fix-stored-artifact branch created from packet-36-cleanup-polish
- [x] ISC-2: server.js in working branch contains no top-level await
- [x] ISC-3: /tmp/alienclaw-deploy-v9/ build dir created with dist/main.js
- [x] ISC-4: esbuild bundle produces dist/main.js without error
- [x] ISC-5: server.js in build dir matches working branch server.js exactly
- [x] ISC-6: server.js in build dir contains no top-level await
- [x] ISC-7: package.json in build dir has mysql2 dependency and start script
- [x] ISC-8: /tmp/alienclaw-deploy-v9.zip created with size under 100KB
- [x] ISC-9: unzip inspection of zip shows no top-level await in server.js
- [x] ISC-10: zip does not contain node_modules directory
- [x] ISC-11: v9 zip uploaded to Hostinger server via SFTP
- [x] ISC-12: zip extracted to nodejs/ directory on server via SSH
- [x] ISC-13: old server.js from broken artifact replaced by extracted corrected version
- [x] ISC-14: app restarted via touch restart.txt after extraction
- [x] ISC-15: api.alienclaw.net/v1/health returns 200 post-extraction
- [x] ISC-16: persistence check passes (install endpoint returns registered status)
- [x] ISC-17: v9 zip present on server as reference; v8 is in hPanel system (not VPS) — outstanding for Bugsy to replace via hPanel upload
- [x] ISC-18: scripts/build-deploy.sh created with top-level-await guard
- [x] ISC-19: scripts/build-deploy.sh is executable
- [x] ISC-20: running scripts/build-deploy.sh succeeds and produces a zip
- [x] ISC-21: docs/DEPLOY.md created documenting the deploy process
- [x] ISC-22: Bug #18 appended to docs/LESSONS_FROM_THE_ARC.md
- [ ] ISC-23: all packet-37 changes committed with scoped messages
- [ ] ISC-24: branch pushed to origin/packet-37-fix-stored-artifact
- [x] ISC-A-1: no live SSH patch applied as the fix (extraction from artifact IS the fix)
- [x] ISC-A-2: no node_modules in deploy zip
- [x] ISC-A-3: no credentials committed to any file
- [ ] ISC-A-4: PR not merged by AI

## Decisions

- 2026-05-28: Branch from packet-36-cleanup-polish (not main) — PRs #12/#13 not yet merged
- 2026-05-28: hPanel upload outstanding — prove artifact via SSH extraction instead
- 2026-05-28: Keep old zip renamed as .broken not deleted — rollback safety
