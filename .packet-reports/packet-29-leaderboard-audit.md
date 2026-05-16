# Packet 29 — Leaderboard Audit

Audit date: 2026-05-16.

---

## Is there a leaderboard UI anywhere?

**Yes — on alienclaw.net — but it is a placeholder.**

`alienclaw.net` is live (HTTP 200, hosted on Hostinger). Navigation bar
includes: About, Leaderboard, API, Donate, GitHub.

`alienclaw.net/leaderboard.html` (HTTP 200) contains:

```
Community genome leaderboard
When the community genome network ships with Packet 10, this page will
show the top genomes per Martian type, updated daily from
api.alienclaw.net/v1/genomes/top.

Status: placeholder — data layer lands with Packet 10.
```

Tables exist for "compute", "http_get", "web_search", and other Martian
types, but every table row contains:

```
"Data coming with Packet 10 — api.alienclaw.net not yet live"
```

---

## Is api.alienclaw.net live?

**No.** Direct test:

```
curl -sL --max-time 10 https://api.alienclaw.net/
HTTP_CODE: 000 (connection refused — DNS does not resolve or server is not running)

curl -sL --max-time 10 https://api.alienclaw.net/v1/genomes/top?martian_type=compute&limit=5
HTTP_CODE: 000
```

`api.alienclaw.net` is unreachable. No TCP connection was established.
The domain either does not resolve or the server is not deployed.

---

## Discrepancy with packet notes

The packet briefing states: "The community API exists (Packet 10) — but is it
connected to a UI?" This is partially accurate: the API *spec* (and possibly
server code) was built in Packet 10, but `api.alienclaw.net` is NOT deployed.
The API spec document exists at `docs/specs/LEADERBOARD_API_SPEC.md` in the
repo. The server is not running.

The leaderboard site page itself says "lands with Packet 10" — meaning the
site was built anticipating Packet 10, but Packet 10 appears to not have
deployed the server (or the site was not updated post-Packet-10).

ROADMAP.md lists `api.alienclaw.net provisioning` as "Next" — confirming it
is not done.

---

## Can a stranger submit a genome and see it appear?

**No.** The submission endpoint (`POST /v1/genomes/submit`) does not exist
because api.alienclaw.net is not running. There is no operator token system,
no submission mechanism, and no rank feedback loop available to any user.

---

## Is the submission process documented?

**Yes — speculatively.** `alienclaw.net/api.html` documents the planned API
surface including `POST /v1/genomes/submit` and `GET /v1/genomes/top`, but
notes "not yet live." The spec is in `docs/specs/LEADERBOARD_API_SPEC.md`.
Documentation exists; the endpoint does not.

---

## Leaderboard verdict

**MISSING (functionally).**

- A visible placeholder UI exists on alienclaw.net ✓
- The leaderboard shows no data and never has ✗
- `api.alienclaw.net` is unreachable ✗
- No submission-to-rank feedback loop exists ✗
- A stranger clicking "Leaderboard" sees tables of "coming soon" rows ✗

If the leaderboard is described as the core community hook (from the GitHub
description: "a community leaderboard"), this is a launch-blocker: the hook
that would convert visitors to participants does not function.

---

## Gaps found

| Gap | Severity | Notes |
|-----|----------|-------|
| api.alienclaw.net not deployed | launch-blocker | Without this, no rankings, no submissions, no community |
| Leaderboard shows only placeholder rows | launch-blocker | Core community feature is non-functional |
| No submission-to-rank feedback loop | launch-blocker | The defining community experience doesn't exist yet |
| Site still says "lands with Packet 10" (stale) | adoption-multiplier | Should update if Packet 10 deployed the spec but not the server |
