# Packet 29 — README Audit

Audit date: 2026-05-16. Clean clone at /tmp/alienclaw-audit-20260516-170016.

## Does a README exist?

**Yes.** `README.md` — 3640 bytes, approximately 100 lines of rendered content.
Markdown renders on GitHub. Structure is clear: title, tagline, "What is AlienClaw"
section, architecture diagram, Quick Start, project structure, docs links,
contributing, license.

---

## Content assessment

| Element | Present? | Quality | Notes |
|---------|----------|---------|-------|
| One-line "what is this" | **Yes** | Adequate | "Open-source agent infrastructure built around an evolutionary genome system" — accurate but abstract. A stranger reads it and thinks "OK but what would I use this for?" |
| Why it exists / problem it solves | **Partial** | Weak | The README explains *what* AlienClaw does (coordinate agents, evolve Martians) but not *why a stranger would want this instead of just using Claude/GPT directly*. No motivation from the user's perspective. |
| Visual (screenshot, diagram, demo gif) | **Partial** | Weak | There is a text architecture diagram using ASCII arrows. No screenshot, no demo gif, no terminal recording, no visual of what the user actually sees when they run it. |
| Quick install instructions | **Yes** | Has gaps | 4-step Quick Start exists. Gaps: (1) no Node.js version requirement stated; (2) `openclaw configure` is described as "follow the prompts" with zero guidance on what it asks or what API keys are needed; (3) no API key mention at all. |
| Quick "hello world" / first run | **Partial** | Weak | Step 4 says `openclaw chat`. No example of what to type to BossBot. No example output. No "you'll see something like this." |
| What the user sees when it works | **No** | Missing | Entirely absent. A stranger cannot picture success. |
| Link to deeper docs | **Yes** | Adequate | Links to VISION.md, ROADMAP.md, CLAUDE.md, SECURITY.md. |
| How to contribute | **Yes** | Adequate | Links to CONTRIBUTING.md with one-line summary. |
| License statement | **Yes (misleading)** | Critical gap | Says "See [LICENSE](./LICENSE)" — but the LICENSE file contains only a single newline byte. The license statement links to nothing. The website footer also claims "MIT" but the file is empty. |
| Badges (CI, version, license) | **No** | Missing | No CI status badge, no npm version badge, no license badge. A stranger has no way to know CI is currently broken. |

---

## Stranger-perspective walk-through

**30 seconds:** "AI agents that evolve from every run — OK, interesting hook. It's some kind of multi-agent framework where Martians do tool work via 256-char genomes. Architecture looks clear. Quick Start has 4 steps, let me see if I can try this."

**2 minutes:** The stranger reads the Quick Start and hits friction immediately.

Step 1 (`npm install -g openclaw`) — fine, openclaw is on npm.

Step 2 (`openclaw configure`) — the stranger opens a terminal and types this. An interactive wizard starts. What provider? What API key format? How long does this take? Is there a way to configure without the wizard? The README says only "follow the prompts." The stranger either has an Anthropic or OpenAI key and guesses, or gets stuck.

Step 3 (git clone + cd) — fine.

Step 4 (`bash install.sh`) — runs, appears to complete if openclaw is configured. Output is colorful and clear.

Step 5 (`openclaw chat`) — a chat prompt opens. The stranger types "Hello." BossBot responds... somehow. But what should they ask? What is a "campaign"? The README never gave them an example goal to try.

**Bounce point:** Most likely at step 2 (`openclaw configure`) if the stranger doesn't know what API key to use, or at step 5 when they don't know what to say or what to expect. Some strangers will bounce at the hero text — the "why would I use this" question is never answered.

---

## Specific gaps

1. **No Node.js version requirement.** The CI and package.json both use Node 22. Install.sh uses Node inline. A stranger on Node 18 or 20 might hit version-specific issues with no diagnostic message. (adoption-multiplier)

2. **`openclaw configure` is a black box.** The Quick Start says "follow the prompts" but doesn't say what the prompts ask for, which providers are supported (Anthropic, OpenAI, Gemini, etc.), or where to get an API key. A stranger who has never used OpenClaw has no idea what `openclaw configure` does. (launch-blocker — blocks first run for most strangers)

3. **No API key mention.** The entire README never mentions that you need an LLM API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.) to use this. The `.env.example` exists but isn't linked from the README. A stranger who doesn't know to set an API key will install everything and get a runtime error. (launch-blocker)

4. **No hello-world example output.** After `openclaw chat`, the stranger sees... what? A prompt? A menu? An error? The README never shows them what success looks like. (adoption-multiplier)

5. **LICENSE is empty.** "See LICENSE" links to a 1-byte file containing only a newline. The website claims MIT. The repository has no actual license text. (launch-blocker — see legal audit)

6. **No use-case motivation.** The README explains the architecture but not the user value proposition. "What would I use this for instead of just opening Claude.ai?" is never answered. (adoption-multiplier)

7. **Status unclear.** "Status: active development. Core architecture is in place. Genome evolution loop and community network are in flight." — a stranger cannot tell what works and what doesn't. ROADMAP.md clarifies but isn't linked from the Quick Start. (adoption-multiplier)

8. **No badges.** No CI status badge. Strangers who check would see no badge at all; if they dig into Actions, they'd find CI is failing. (standard-hygiene)

## Severity summary

| Gap | Severity |
|-----|----------|
| LICENSE empty | launch-blocker |
| No API key guidance | launch-blocker |
| `openclaw configure` unexplained | launch-blocker |
| No hello-world output example | adoption-multiplier |
| No use-case motivation | adoption-multiplier |
| Node.js version not stated | adoption-multiplier |
| Status/what-works clarity | adoption-multiplier |
| No badges | standard-hygiene |
