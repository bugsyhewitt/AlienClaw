# Packet 31.6 — Bugs

## Bug #14 (the bug this packet fixed)
- **Where:** `src/alienclaw/api/storage.ts`
- **What:** Storage layer retained flat-file implementations after the Python→TypeScript
  port in Packet 31.5. MySQL was never written to. HTTP responses looked correct.
- **Fixed:** Full MySQL rewrite using `mysql2/promise`. Fail-fast on missing DB URL.

## New bugs found: none
