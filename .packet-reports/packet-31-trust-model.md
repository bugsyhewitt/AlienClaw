# Packet 31 — Leaderboard Trust Model

The leaderboard connects operators' machines to a server Bugsy controls. This
document states each architectural guarantee and the exact code that enforces it.
A skeptic can verify each guarantee by reading the cited file.

---

## Guarantee 1: Pull-only

**alienclaw.net never initiates contact with an operator's machine.** There is no
inbound endpoint, listener, or push channel on the operator side. CreatorBot's
`leaderboardCheck` routine fetches on CreatorBot's own schedule.

**Enforced by:**
- `src/alienclaw/governance/common/leaderboard.ts`: `leaderboardCheck()` is a
  plain async function — no `http.createServer()`, no listener, no socket.
- The function is called by CreatorBot on a schedule. alienclaw.net has no
  channel to invoke it.
- Verification: `grep -rn "createServer\|listen\|socket" src/alienclaw/governance/common/leaderboard.ts`
  returns nothing. The absence of listener code is the guarantee.

---

## Guarantee 2: Inert data

**The leaderboard API returns only numbers and 8-letter names. No field is ever
interpreted as a command, prompt, or code.**

**Enforced by:**
- `validateLeaderboardResponse()` in `leaderboard.ts`:
  - Only allows fields: `martian_type`, `genomes`, `total_for_type` at top level
  - Only allows fields: `leaderboard_name`, `fitness`, `martian_type`,
    `submission_id`, `submitted_at`, `genome`, `generation` per entry
  - Throws on ANY unexpected field
  - Type-checks every field (string, number with range, integer)
  - Re-validates `leaderboard_name` as `^[A-Z]{8}$`
- No code path in `leaderboardCheck()` passes response content to:
  - `eval()`, `Function()`, `exec()`, any dynamic execution
  - `require()`, `import()` with dynamic paths
  - The governance agents (BossBot, AdvisorBot, CreatorBot)
  - Any LLM API call

---

## Guarantee 3: File-mediated submission

**When CreatorBot finds the operator holds a top genome, it writes a local file.
Submission to the API is a SEPARATE, explicit step.**

**Enforced by:**
- `leaderboardCheck()` in `leaderboard.ts`: only output is `writeFileSync(config.submissionFilePath, ...)`.
  The function does not make any POST requests.
- `submitFromFile()` is a separate export that must be explicitly invoked.
  It is NOT called inside `leaderboardCheck()`.
- There is always a visible on-disk artifact between "bot found a good genome"
  and "data left the machine."

---

## Guarantee 4: Name-constrained

**Leaderboard names are `^[A-Z]{8}$` — 8 uppercase letters only. This closes
injection via the one field operators control.**

**Enforced at three points:**
1. **Setup** (operator selects name): `validateLeaderboardName()` in `leaderboard.ts`
2. **Client pre-submission**: `validateLeaderboardName()` called before `submitFromFile()`
3. **Server ingest**: `validate_submission()` in `src/alienclaw/api/validation.py`
   checks `_LEADERBOARD_NAME_RE = re.compile(r'^[A-Z]{8}$')`
4. **Defense in depth**: `validateLeaderboardResponse()` re-validates names in
   received data even though the server should have enforced it
5. **Database**: `migrations/001_leaderboard.sql` has `CONSTRAINT chk_leaderboard_name CHECK (leaderboard_name REGEXP '^[A-Z]{8}$')`

No SQL injection (parameterized queries). No script tags (no html rendering of
arbitrary strings). No unicode tricks (ASCII uppercase only). No length attacks
(exactly 8).

---

## Guarantee 5: Hardened fetch

**The leaderboard response is treated as hostile input.**

**Enforced by:** `hardenedFetch()` in `leaderboard.ts`:
- **Timeout**: `AbortController` with `timeoutMs` (default 10s)
- **Size limit**: reads incrementally; rejects response > `maxResponseBytes` (256KB)
  before full parse
- **No executable deserialization**: `JSON.parse()` only, result immediately passed
  to `validateLeaderboardResponse()` which whitelist-validates structure
- **No eval**: nowhere in the fetch-to-validate pipeline is any response content
  executed

---

## How a skeptic verifies this

1. Open `src/alienclaw/governance/common/leaderboard.ts`
2. Read `leaderboardCheck()` — 30 lines. Confirm: no listener, no POST, only
   `writeFileSync` at the end.
3. Read `hardenedFetch()` — confirm timeout and size limit.
4. Read `validateLeaderboardResponse()` — confirm whitelist-only field validation,
   `^[A-Z]{8}$` re-check, type/range checks.
5. Confirm `submitFromFile()` is not called inside `leaderboardCheck()`.

Total reading time: ~2 minutes.
