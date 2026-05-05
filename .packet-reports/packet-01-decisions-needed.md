# Decisions Needed for Packet 2

---

## D1 — Architecture canonicalization

- **Evidence:** `packet-01-architecture-finding.md` — the core code (`src/alienclaw/`) is already canonical. The README accurately describes the canonical architecture. Drift is in the surrounding OpenClaw-imported content (skills/, docs/, VISION.md, workflows, CHANGELOG.md).
- **Options:**
  - A: Treat current code as correct, move all OpenClaw-imported content to `archive/`
  - B: Review each OpenClaw-imported section individually, keep what's useful
  - C: Delete OpenClaw-imported content entirely (no archive)
- **Recommendation:** None — Bugsy decides.
- **Default if no decision:** Stop and ask. Scope of Packet 2 depends entirely on this.

---

## D2 — OpenClaw imported content: which of these 6 areas to address in Packet 2

The following areas contain OpenClaw content. Each is an independent decision:

### D2a — `skills/` (52 directories)
- **What:** OpenClaw skills (1password, apple-notes, discord, slack, etc.). Each is a `SKILL.md`.
- **Options:** Archive all | Delete all | Curate (keep AlienClaw-relevant ones) | Leave for now
- **Note:** If AlienClaw ever ships skills, these may be starting points — but none currently describe Martian or governance-specific behavior.

### D2b — `docs/` (44 entries)
- **What:** OpenClaw documentation website source files (channels, plugins, gateway, auth, etc.).
- **Options:** Archive all | Delete all | Replace with AlienClaw-specific docs | Leave for now
- **Note:** `docs.alienclaw.ai` is referenced. Does Bugsy want a docs website?

### D2c — `VISION.md`
- **What:** OpenClaw vision (iOS/Android companion apps, ClawHub, mcporter, multi-provider).
- **Options:** Replace with AlienClaw-specific vision statement | Archive | Delete
- **Note:** This is the most visible drift document; it completely misrepresents what AlienClaw is.

### D2d — `CHANGELOG.md` (652KB)
- **What:** OpenClaw's full changelog, reskinned. Almost certainly not AlienClaw's history.
- **Options:** Delete | Archive | Replace with AlienClaw changelog (starting from v0.1.0)
- **Note:** The actual AlienClaw history is in `git log`. A new CHANGELOG.md for AlienClaw-specific milestones is probably appropriate.

### D2e — `.github/workflows/`
- **What:** CI workflows describe OpenClaw's build (pnpm, apps/android, apps/macos, apps/ios, Docker release).
- **Options:**
  - Replace ci.yml with minimal AlienClaw-specific CI (typecheck + install-smoke)
  - Archive the OpenClaw CI files, start fresh
  - Leave broken workflows for now (they'll fail on every push)
- **Note:** Currently ci.yml will fail on every push because `pnpm build` is not defined and `apps/macos/` doesn't exist. The broken CI is actively harmful.

### D2f — `alienclaw-HANDOFF-v0.9.md`
- **What:** 25KB document describing the old vendor+reskin architecture. Already has a disclaimer at the top.
- **Options:** Archive (move to archive/) | Delete | Keep as historical reference
- **Note:** Low urgency but contributes to confusion for any new contributor.

---

## D3 — `installer/scripts/` dead code

- **Evidence:** `installer/scripts/copy-dist.sh` references `openclaw/` vendor dir (doesn't exist). `installer/scripts/reskin.sh` is for the old vendor+build pipeline (gone).
- **Options:** Delete both | Archive both | Leave (they're not executed by install.sh)
- **Default if no decision:** Leave for Packet 3. Not blocking.

---

## D4 — 8 open PRs disposition

All 8 PRs are from `dependabot[bot]`. Recommended dispositions:

| PR | Title | Disposition | Reason |
|----|-------|-------------|--------|
| #1 | bump swift-testing in /Swabble | CLOSE-STALE | Swabble/ doesn't exist in main |
| #2 | bump menubarextraaccess in /apps/macos | CLOSE-STALE | apps/macos/ doesn't exist in main |
| #3 | bump actions/setup-node from 4.4.0 to 6.3.0 | CLOSE-STALE | Depends on D2e CI decision; if CI is rebuilt, these are moot |
| #4 | bump actions/upload-artifact from 4 to 7 | CLOSE-STALE | Same as #3 |
| #5 | bump docker/login-action from 3 to 4 | CLOSE-STALE | Same as #3 |
| #6 | bump actions/checkout from 4 to 6 | CLOSE-STALE | Same as #3 |
| #7 | bump actions/create-github-app-token | CLOSE-STALE | Same as #3 |
| #10 | bump uiautomator in /apps/android | CLOSE-STALE | apps/android/ doesn't exist in main |

- **Recommended bulk action:** Close all 8. None can be merged (target paths don't exist in main).
- **Bugsy decision needed:** Confirm close-all, or review any PR individually before closing.
- **Default if no decision:** Leave open (they're not blocking, just noisy).

---

## D5 — GitHub migration timing

- **Context:** Bugsy hasn't selected a personal GitHub username yet. The repo is currently at `github.com/AlienTool/AlienClaw`. CLAUDE.md and README reference this URL.
- **Options:** Migrate now (to personal GitHub) | Stay at AlienTool/AlienClaw | Defer to Packet 10
- **Implications:** api.alienclaw.net DNS is currently missing; the server repo URL will need to go somewhere when Packet 10 provisions it.
- **Default if no decision:** Defer to Packet 10. Local-only work for Packets 2-9 is fine.

---

## D6 — `alienclaw.net` landing page content

- **Context:** `alienclaw.net` is LIVE (HTTP 200, Hostinger, last modified 2026-03-22). Something is being served. The current content wasn't inspected (no browser). `api.alienclaw.net` has no DNS record.
- **Decision needed:** Does the existing alienclaw.net content need to be replaced before Packet 9, or does Packet 9 start from scratch?
- **Default if no decision:** Defer to Packet 9. No action needed now.

---

## D7 — `seed/agents/*/TOOLS.md` corrections

- **Context:** BossBot's TOOLS.md says "standard OpenClaw tool set". CreatorBot's TOOLS.md says "file write tool only, writes to ~/.openclaw/agents/creatorbot/specialists/".
- **Options:** Fix now in Packet 2 (tiny edits) | Defer to Packet 3 (spec phase) | Leave
- **Default if no decision:** Leave for Packet 3 — not blocking anything.

---

## D8 — CI rebuild scope

- **Immediate problem:** `ci.yml` will fail on every push because `pnpm build`, `apps/macos/`, `apps/android/` don't exist.
- **Minimum viable fix:** Replace ci.yml with AlienClaw-specific CI: `npm run typecheck` + `bash install.sh --dry-run` + `bash install.sh --uninstall` smoke test.
- **Decision needed:** Should Packet 2 include CI rebuild, or is this deferred?
- **Recommendation:** Packet 2 should include at minimum a ci.yml that doesn't fail on push.
- **Default if no decision:** Stop and ask. Broken CI is actively harmful.
