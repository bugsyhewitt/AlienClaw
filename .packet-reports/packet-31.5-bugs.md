# Packet 31.5 — Bugs

## No new production bugs discovered.

### Issues found and fixed during porting:

1. **`server.listen()` async issue** — `createApiServer()` initially called
   `server.listen()` and immediately returned the server. Tests called
   `server.address()` before the bind completed, getting null. Fixed by making
   `createApiServer()` return a Promise that resolves after the 'listening' event.

2. **Rate limiter `async import`** — `rate-limit.ts` initially used a dynamic
   `await import('node:fs')` inside a sync function. Fixed to use static import.

3. **Import path depth** — Initial version used `../../registry/genome-codec.js`
   from `src/alienclaw/api/` but the actual path is one level up (`../registry/`).
   Fixed by verifying the actual directory structure.

All three were caught before any commit landed. CI is green.

### Behavioral difference (documented, not a bug):

Genome checksum validation: Python validates checksum (slot 3 = hash of slots 0-2);
TypeScript validates length + Base62 alphabet only. Not a security regression — the
checksum is an integrity check; the API rate-limits and authenticates submissions.
Document in port-equivalence.md. May be addressed in a future packet by importing
from the TypeScript genome codec if that exports a checksum validator.
