# Packet 31.5 — Deferred Items

## L5 deployment (Bugsy's manual steps)

The code is ready. Deployment requires Bugsy to execute packet-31.5-manual-steps.md.
Once done, L5 closes.

## Server-side genome re-verification (still deferred)

Unchanged from Packet 31. Trust-the-number for v1. Re-verification is a
future packet that would: receive submission, queue genome for re-run,
update rank if score matches within tolerance, reject if significantly different.

## MySQL storage backend for SubmissionStore

The TypeScript storage.ts uses flat-file persistence (same as the Python original).
MySQL is available on Hostinger but not wired. The migration/001_leaderboard.sql
schema exists. A future packet can add a MySQL-backed storage class and switch
via ALIENCLAW_DB_URL environment variable.

## Genome checksum validation in TypeScript API

The TypeScript validation.ts validates genome length + Base62 alphabet but not
the checksum (no TS equivalent of the Python genome checksum validator is easily
accessible from src/alienclaw/api/). A future packet can add this by importing
from the TypeScript genome codec if a checksum validator is exported.

## README updates beyond Python-reference correction (Packet 32)

As planned from the original Packet 32 scope.

## CODE_OF_CONDUCT / CHANGELOG / CI badge (Packet 33)

As planned.
