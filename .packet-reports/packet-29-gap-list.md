# Packet 29 — Launch-Readiness Gap List

The honest, prioritized list of what stands between AlienClaw's current state
and "a stranger can clone it and play with it."

---

## Audit summary

| Area | Verdict |
|------|---------|
| Environment | Audited on Kali Linux, Node 22.22.1, npm 9.2.0 |
| Clean clone | **SUCCEEDED** — github.com/AlienTool/AlienClaw is public and cloneable |
| README | **WORKS-WITH-GAPS** — exists, structured, Quick Start present; missing API key guidance and examples |
| Install | **WORKS-WITH-FRICTION** — bash install.sh works; `openclaw configure` step is undocumented |
| Hello-world | **WEAK** — `openclaw chat` is stated; no example goal, no example output, API key undisclosed |
| Leaderboard | **MISSING (functionally)** — placeholder UI exists, api.alienclaw.net is unreachable, no data ever shown |
| License | **MISSING** — LICENSE file is 1 byte (newline only); website claims MIT falsely |
| Hygiene | 7 of 9 standard files present; CI failing; no GitHub topics |

---

## LAUNCH-BLOCKERS

*Gaps where a stranger genuinely cannot use the project.*

| # | Gap | Stranger impact | Fix scope |
|---|-----|-----------------|-----------|
| L1 | **LICENSE file is empty** | Legally cannot use, copy, fork, or contribute. Website claims MIT but file has no text. | Add MIT license text to LICENSE file; 5 min |
| L2 | **No API key guidance in README** | Stranger installs everything, runs `openclaw chat`, and gets a runtime error with no diagnostic about why | Add one sentence + link to .env.example in Quick Start; 15 min |
| L3 | **`openclaw configure` completely undocumented** | The interactive wizard at step 2 of Quick Start is a black box. What does it ask? Which providers? What key format? A stranger who doesn't use OpenClaw already cannot complete this step. | Add a 3-5 line description in README explaining what `openclaw configure` asks and which API key to have ready; 20 min |
| L4 | **`npm install` triggers `bash install.sh` (CI broken)** | CI has been failing since 2026-05-10 — both TypeScript and unit test jobs fail at `npm install`. No green CI runs exist. Developer contributors cannot set up a working dev environment by running `npm install`. | Remove or rename `"install"` in package.json scripts; add a `"setup"` script or document that `npm install` must be run with `--ignore-scripts`; 30 min |
| L5 | **Leaderboard is entirely placeholder** | The core community hook (genome competition, rank feedback) does not function. api.alienclaw.net is unreachable. The Leaderboard nav link shows only "Data coming with Packet 10" — but Packet 10 is listed as done. | Deploy api.alienclaw.net; connect leaderboard.html to live data; multi-day effort |

---

## ADOPTION-MULTIPLIERS

*Gaps where the project works but conversion from visitor to participant is
needlessly low.*

| # | Gap | Impact | Fix scope |
|---|-----|--------|-----------|
| A1 | **No example goal for BossBot** | Stranger runs `openclaw chat` and doesn't know what to say. Drops off. | Add one example like "Try: 'Summarize the top 3 results for X'" to README Quick Start; 10 min |
| A2 | **No example output** | No screenshot, no terminal recording, no text showing what BossBot looks like responding. Stranger cannot picture success. | Add a screenshot or text example of BossBot session to README; 30 min |
| A3 | **No use-case motivation** | README explains architecture but not user value proposition. "Why would I use this instead of Claude.ai directly?" is unanswered. | Add 2-3 sentences explaining the user benefit; 20 min |
| A4 | **Node.js version unspecified** | A stranger on an older Node might hit version-specific errors with no diagnostic. CI pins Node 22. | Add `node: ">=22"` to package.json engines field; 5 min |
| A5 | **`.env.example` not linked** | The file exists and documents all needed API keys, but the README doesn't reference it. Stranger won't find it unless they explore the repo. | Add one line to README Quick Start; 5 min |
| A6 | **GitHub topics: empty** | Zero discoverability via GitHub's topic search. Nobody searching "multi-agent", "llm", "ai-agent", "genome", etc. will find AlienClaw. | Add 5-10 relevant topics in GitHub repo settings; 5 min |
| A7 | **Repo description uses "Meeseeks"** | The GitHub description says "evolving Meeseeks genomes" — but the codebase completed a Meeseeks→Martian rename. Inconsistent terminology for a stranger. | Update description in GitHub repo settings; 2 min |
| A8 | **`.packet-reports/` visible to strangers** | A stranger cloning the repo sees a `.packet-reports/` directory at the root — 40+ internal audit files from the development process. Not harmful, but confusing. | Add `.packet-reports/` to `.gitignore`, or keep internal history (judgment call); 5 min |
| A9 | **OpenClaw version untested** | Bugsy's machine has 2026.4.22; npm current is 2026.5.12. AlienClaw has been tested against one version; a stranger gets another. | Test against current npm version; document minimum version; day or less |
| A10 | **Status section is vague** | README says "active development" but doesn't say what actually works. A stranger can't tell if they'd get a functional BossBot session. | Update README status section with explicit "what works today"; 20 min |

---

## STANDARD-HYGIENE

*Expected files/practices that don't block use but signal project maturity.*

| # | Gap | Fix scope |
|---|-----|-----------|
| H1 | **No CODE_OF_CONDUCT.md** | Add Contributor Covenant; 5 min |
| H2 | **No CHANGELOG.md** | ROADMAP.md substitutes partly; a conventional CHANGELOG.md is also expected | Start a CHANGELOG with current state; 30 min |
| H3 | **No CI badge in README** | Add GitHub Actions badge; 5 min (but fix CI first — a red badge is worse than no badge) |
| H4 | **`@mariozechner/pi-ai` license unverified** | Check the license of this dev dependency; confirm compatibility with MIT intent; 15 min |

---

## Recommended follow-up packet sequence

### Packet 30: Launch-blocker fixes
Close L1, L2, L3, L4. In priority order:
1. L1 (LICENSE) — 5 minutes, legally required
2. L4 (npm install fix) — 30 min, unblocks CI and contributors
3. L2 + L3 (README API key + openclaw configure guidance) — 45 min
4. Verify CI goes green after the npm fix

Packet 30 does NOT need to fix L5 (leaderboard deployment). L5 is a
multi-day backend effort that deserves its own packet.

### Packet 31: Leaderboard deployment
Close L5: deploy api.alienclaw.net, connect leaderboard.html to live data,
implement the submission-to-rank feedback loop. This is the core community
hook; nothing else matters for community growth until this works.

### Packet 32: README and onboarding polish
Close A1, A2, A3, A5, A10. The README needs a hello-world example with output,
a motivation paragraph, and a link to .env.example. This is the adoption
improvement pass after the blockers are cleared.

### Packet 33: GitHub hygiene and discoverability
Close A4, A6, A7, H1, H2, H3, H4. GitHub topics, repo description fix,
badges, CODE_OF_CONDUCT, CHANGELOG. Quick tasks, done in one packet.

### Packet 34 (if needed): OpenClaw version compatibility
Close A8, A9. Test against current openclaw npm version; document engine
requirements; decide on `.packet-reports/` visibility.

---

## The honest bottom line

AlienClaw is further from "people can play with it" than the repo being public
might suggest. Two launch-blockers are fixable in an afternoon (the empty
LICENSE and the broken CI), but the third blocker — the missing API key
guidance — and the biggest one — the non-functional leaderboard — require
more thought. A stranger who finds AlienClaw today, reads the README, and
tries to install it will get stuck at `openclaw configure` (no guidance), or
will get through installation only to face a blank leaderboard and no idea
what to say to BossBot.

The good news: the install.sh is solid, the site is live, the repo structure
is real, and CONTRIBUTING.md and SECURITY.md are unusually thorough for a
project this early. The foundation is there. The gap between "foundation exists"
and "strangers can use it" is roughly Packet 30 (one afternoon) plus Packet 31
(backend deployment, multi-day). After those two packets, the project would be
genuinely usable by a stranger with an API key.
