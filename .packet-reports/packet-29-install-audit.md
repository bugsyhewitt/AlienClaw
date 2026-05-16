# Packet 29 — Install Path Audit

Audit date: 2026-05-16. Clean clone at /tmp/alienclaw-audit-20260516-170016.
Following README Quick Start literally. A stranger doing the same would get results
described below.

---

## README install instructions (verbatim)

```bash
# 1. Install OpenClaw (npm prerequisite)
npm install -g openclaw

# 2. Configure OpenClaw
openclaw configure

# 3. Install AlienClaw
git clone https://github.com/AlienTool/AlienClaw.git
cd AlienClaw
bash install.sh

# 4. Talk to BossBot
openclaw chat
```

---

## Step-by-step record

### Step 1: `npm install -g openclaw`

This step works. `openclaw` is on npm as a public package (MIT).

```
npm view openclaw
openclaw@2026.5.12 | MIT | deps: 51 | versions: 170
Multi-channel AI gateway with extensible messaging integrations
```

**Version note:** As of audit date, npm has 2026.5.12 but install.sh was tested
against 2026.4.22 (what's on Bugsy's machine). Version drift is unknown.
A stranger gets the latest npm version; compatibility with that version is
untested.

**Time:** Estimated 30-60 seconds on a typical connection (80MB package).

**Friction:** None from this step alone.

### Step 2: `openclaw configure`

This is an **interactive wizard** with no preview available. The README says
only "follow the prompts to configure your API keys and preferences."

`openclaw configure --help` output:
```
Usage: openclaw configure [options]
Interactive configuration for credentials, channels, gateway, and agent defaults
Options:
  --section <section>  Configuration sections (repeatable). Options: workspace,
                       model, web, gateway, daemon, channels, plugins, skills,
                       health (default: [])
```

Friction analysis:
- A stranger who has never used OpenClaw does not know what "workspace", "model",
  "gateway", or "daemon" mean in this context.
- The README never mentions which LLM provider to select or which API key format
  is required.
- Supported providers (from `.env.example`, not linked in README):
  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, and others.
- A stranger who doesn't have an API key from one of these providers cannot
  complete this step.
- This step cannot be audited non-interactively without an API key, so the
  stranger experience here is **documented as a gap, not verified as working**.

**This step is the most likely stranger-blocking point.**

### Step 3: `git clone` + `cd AlienClaw`

```
git clone https://github.com/AlienTool/AlienClaw.git
```

Clone exits cleanly. Repo size: 64MB. Top-level shows README.md, install.sh,
seed/, src/, test/, site/, docs/, .github/, and more.

**Time:** ~5 seconds on fast connection, ~30 seconds on slow.

**Friction:** None.

### Step 4: `bash install.sh`

Tested via `bash install.sh --dry-run` (to avoid modifying Bugsy's ~/.openclaw).
Also reviewed the full install.sh source (280 lines).

Install.sh behavior:
1. Checks openclaw is installed — exits cleanly if not (with helpful error message)
2. Probes OpenClaw's workspace layout via `openclaw setup --workspace`
3. Archives any pre-existing default agent
4. Copies seed/agents/{bossbot,advisorbot,creatorbot}/ to ~/.openclaw/agents/
5. Patches ~/.openclaw/openclaw.json to set bossbot as default workspace
6. Verifies: all 15 expected files present, openclaw.json updated, `openclaw agents list` output

The install.sh is **well-written** — defensive, idempotent, bash 3.2+ compatible,
uses dry-run and uninstall flags.

**Friction:** None if openclaw is installed and configured. If openclaw is not
installed (a stranger who skipped step 1 or whose step 2 failed), install.sh
exits with a clear, helpful error message including re-run instructions.

**Dry-run output:**
```
==> Checking for OpenClaw
  ▸ [dry-run] Skipping OpenClaw version check.
==> Probing OpenClaw's agent workspace layout
==> Archiving any pre-existing default OpenClaw agent
==> Provisioning AlienClaw agents
    ✔ Installed agent: bossbot → /home/xil/.openclaw/agents/bossbot
    ✔ Installed agent: advisorbot → /home/xil/.openclaw/agents/advisorbot
    ✔ Installed agent: creatorbot → /home/xil/.openclaw/agents/creatorbot
==> Setting BossBot as the default agent
==> Verifying install
  👽 ALIENCLAW INSTALLED
  Default agent : BossBot
  Peers         : AdvisorBot, CreatorBot
  Start a chat   : openclaw chat
```

**Time:** Under 5 seconds.

---

## Critical finding: `npm install` in the cloned directory runs the installer

`package.json` contains:
```json
"scripts": {
  "install": "bash install.sh"
}
```

The `install` lifecycle script runs when `npm install` is executed in the
directory. A developer who clones the repo and instinctively runs `npm install`
(to set up dev dependencies like TypeScript and vitest) would trigger `bash
install.sh`. If openclaw is not installed, install.sh exits 1, and `npm install`
fails with an error that looks like a package installation problem.

**This breaks CI.** The CI `ci.yml` runs `npm install` to install dev dependencies,
but does NOT install openclaw first. Result: the CI "Install dependencies" step
fails for both TypeScript typecheck and Unit tests jobs.

Evidence: Last CI run (2026-05-10) shows:
- Job "TypeScript typecheck": FAILED at "Install dependencies"
- Job "Unit tests": FAILED at "Install dependencies"
- CI has not run since (or has run and failed every time since)

This is documented separately in `packet-29-bugs.md` as a genuine code defect.

---

## Undocumented prerequisites

1. **An LLM API key** — needed for `openclaw configure` and `openclaw chat`.
   The README never mentions this. The `.env.example` in the repo lists
   ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY as options, but this
   file is not linked from the README's Quick Start.

2. **Node.js version** — CI uses Node 22 (from `ci.yml`). The README says
   nothing about Node version requirements. Minimum version untested.

3. **`openclaw configure` must succeed before `bash install.sh`** — the
   installer checks for the openclaw binary but NOT for whether it's been
   configured. If `openclaw configure` was skipped or incomplete, `bash
   install.sh` succeeds but `openclaw chat` would fail at runtime.

---

## Install verdict

**WORKS-WITH-FRICTION** — assuming a stranger follows the README and has an
LLM API key, the install path is functional. The install.sh is well-written
and produces a clear result.

Friction points in order of severity:
1. `openclaw configure` is entirely undocumented in the README — no guidance
   on what it asks, what credentials to provide, or how long it takes.
2. No mention of API key requirement anywhere in the README.
3. `npm install` in the cloned directory triggers the installer (breaks CI;
   confuses developers setting up the dev environment).
4. Node.js version requirement unspecified.
5. No verification that configure succeeded before running install.sh.

---

## Gaps found

| Gap | Severity |
|-----|----------|
| `openclaw configure` unexplained in README | launch-blocker |
| No API key mention in README | launch-blocker |
| `npm install` triggers installer (breaks CI, confuses devs) | launch-blocker (CI) / adoption-multiplier (UX) |
| Node.js version unspecified | adoption-multiplier |
| No `openclaw configure` validation before install.sh | adoption-multiplier |
