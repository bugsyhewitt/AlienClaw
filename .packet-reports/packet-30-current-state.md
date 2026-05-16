# Packet 30 — Current State Baseline

Captured at start of Packet 30. Starting commit: cf2376b1.

---

## L1 — LICENSE

```
Size: 1 byte
Content: 0x0A (newline only — effectively empty)
```

Website claims MIT. README says "See LICENSE." LICENSE has nothing.

---

## L2 — README (API key section)

README.md has no section documenting an LLM API key requirement.
The Quick Start says `openclaw configure` but gives zero guidance on
what provider/key to use. A `.env.example` file exists but is not
linked in the README.

---

## L3 — README (openclaw configure)

README Quick Start step 2: `openclaw configure` — described only as
"follow the prompts." No information on what prompts appear, what to
answer, or what happens if configuration is skipped.

---

## L4 — install.sh / package.json / CI

### package.json scripts section:
```json
{
  "install": "bash install.sh",
  "typecheck": "tsc --noEmit"
}
```

The `"install"` lifecycle script fires on `npm install`, triggering
`bash install.sh`. Since openclaw is not installed in CI, install.sh
exits 1, breaking `npm install`.

### CI state:
Last CI run: 2026-05-10T00:13 (run 25615274523) — FAILURE
- Job "TypeScript typecheck": FAILED at "Install dependencies" (npm install)
- Job "Unit tests": FAILED at "Install dependencies" (npm install)
- Job "Python lint + test": FAILED at "Lint Python files" (ruff, decoder.py)
- Job "Shell script lint": success
- Job "Install smoke test": success (installs openclaw before running install.sh)

CI has only been running the "Stale" bot workflow since May 10.
No pushes to main since cf2376b1 (Packet 29 local commit, not yet pushed).

### Python lint root cause:
In the committed state (3bdcc90f), ruff fails on `src/alienclaw/brains/decoder.py`:
- I001: import block unsorted
- E501: line too long (107 chars) — import line with 4 identifiers

The LOCAL version of decoder.py (unstaged modifications from Packets 14+) already
passes ruff — the local changes fixed the formatter issues. Including the locally
modified decoder.py in the CI commit will fix the Python ruff job.

---

## D1 — GitHub topics

Current GitHub topics: NONE (repositoryTopics: null)

---

## D2 — GitHub description

Current: "Five-layer multi-agent governance system built on top of OpenClaw.
Preset hierarchy, evolving Meeseeks genomes, and a community leaderboard."

Issues:
- "Meeseeks" is stale terminology (renamed to Martian in Packet 17)
- "Five-layer" is not current language
- Description is otherwise reasonably accurate

---

## Summary: what needs to change

| Fix | File(s) to change |
|-----|------------------|
| L1 | `LICENSE` |
| L2 | `README.md` — add API key section |
| L3 | `README.md` — add openclaw configure walkthrough |
| L4 | `package.json` — rename/remove `"install"` script; include decoder.py fix |
| D1 | GitHub repo settings (gh CLI) |
| D2 | GitHub repo settings (gh CLI) |
