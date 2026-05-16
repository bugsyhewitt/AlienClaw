# Packet 29 — Hello-World Audit

Audit date: 2026-05-16. Clean clone at /tmp/alienclaw-audit-20260516-170016.

---

## The first thing a stranger runs

Per the README Quick Start, the sequence ends with:

```bash
openclaw chat
```

This is the entry point. No further guidance is given in the README.

---

## What the stranger encounters

### Is there a clear "first thing to run"?

**Partially.** `openclaw chat` is stated in the Quick Start. But the README
gives no example of what to type, what to expect, or what a successful first
interaction looks like.

### Timing estimate (clone to first interaction)

| Step | Estimated time |
|------|---------------|
| npm install -g openclaw | 30-90 sec |
| openclaw configure (interactive, unknown) | 2-10 min |
| git clone | 5-30 sec |
| bash install.sh | <10 sec |
| openclaw chat | Immediate |
| **Total: clone to prompt** | **~5-15 minutes** |

**Can a stranger get from clone to "wow" in ~10 minutes?**

If they have an API key ready and the configure wizard goes smoothly: **maybe**.
If they get stuck at `openclaw configure` (which most will, given zero guidance):
**no**.

### What does `openclaw chat` actually show?

Cannot be tested in this audit session without running `openclaw chat` interactively
(it requires a terminal TTY). However, based on what's known:

- openclaw chat opens an interactive session with BossBot
- BossBot is configured via SOUL.md and AGENTS.md in the seed files
- BossBot would respond to natural-language goals
- No example goal is provided in the README
- No example output is shown

A stranger who types `openclaw chat` sees a chat prompt and has no idea what
to say. The README never gives an example goal like "Ask BossBot to summarize
a web page" or "Give BossBot a task and watch it delegate."

### Does it produce a visible payoff?

**Unknown from README alone.** The architecture description in the README is
compelling, but there is no:
- Screenshot of BossBot responding
- Example of Martian evolution happening
- Terminal recording showing the governance flow
- Even a text example like "BossBot said: 'I've engaged AdvisorBot...'"

A stranger who gets to `openclaw chat` and types something will see SOME
response from BossBot. Whether that response demonstrates the AlienClaw
value proposition (Martians evolving, AdvisorBot consulted, etc.) is unknown
without running it.

### Does it require an API key or external service?

**Yes — and this is not stated in the README.**

- `openclaw configure` requires at minimum one LLM API key
  (Anthropic, OpenAI, Gemini, or OpenRouter)
- `openclaw chat` will fail at runtime if no provider is configured
- The `.env.example` lists ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY
  as the primary options — but `.env.example` is not linked in the README

A stranger who doesn't already have an LLM API key cannot complete the
hello-world experience at all. They would need to:
1. Discover that an API key is needed (not from the README — from the error)
2. Sign up for Anthropic/OpenAI/etc.
3. Get an API key (potentially paid)
4. Re-run `openclaw configure`

This is a **complete blocker** for strangers without an existing API key.

---

## Hello-world verdict

**WEAK** — the path exists (openclaw chat is stated), but:

1. API key requirement is undisclosed — blocks strangers without one entirely
2. No example of what to say to BossBot
3. No example output showing success
4. `openclaw configure` is a guess-based process with no README guidance
5. Time-to-payoff is 5-15+ minutes, heavily dependent on `openclaw configure`

A stranger with a pre-existing LLM API key and some OpenClaw experience could
get to a working BossBot session in ~10 minutes. A stranger without these
would not get there without help.

---

## Gaps found

| Gap | Severity |
|-----|----------|
| API key requirement not disclosed | launch-blocker |
| No example goal for BossBot in README | adoption-multiplier |
| No example output showing success | adoption-multiplier |
| `openclaw configure` blocks path for most strangers | launch-blocker |
| Time-to-payoff exceeds 10 min for most strangers | adoption-multiplier |
