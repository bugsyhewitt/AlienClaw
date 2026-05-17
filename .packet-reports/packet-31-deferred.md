# Packet 31 — Deferred Items

## Server-side genome re-verification

Trust-the-number is the v1 approach: the server accepts submitted fitness values
without re-running the genome. This is documented as gameable.

**Future packet:** Server-side re-verification would:
1. Accept the submission but mark it `pending`
2. Queue the genome for re-running against a known goal
3. Update fitness and rank if the re-run score matches within tolerance
4. Reject the submission if the score is significantly different

This requires: compute budget for re-running genomes, a queue, retry logic,
and API versioning (v1 stays as-is; re-verification goes into a new endpoint or
an updated /v2/genomes). Not a v1 concern — labeled as a future packet.

## MySQL storage backend

The migrations/001_leaderboard.sql exists, but the actual Python API storage
layer (`src/alienclaw/api/storage.py`) uses flat files. A MySQL storage class
would replace SubmissionStore's file I/O with MySQL queries.

For v1 deployment, flat-file storage is sufficient. MySQL backend for later.

## Render.com deployment documentation

If Hostinger proves difficult for Python persistence, the packet-31-deployment.md
documents Render.com as an alternative. A dedicated "deployment to Render" packet
could automate this if the Hostinger path doesn't work.

## L5 deployment execution

The code is done. The deployment itself (Hostinger steps) is the remaining work.
Once executed, L5 closes and all 5 launch-blockers are done.
