# Packet 31.5 — Architectural Defaults

1. **Faithful port verified by shared test cases, not re-derived behavior.**
   25 TypeScript integration tests verify identical accept/reject outcomes as
   the Python original on the same inputs. One known behavioral difference
   (checksum validation) documented; does not affect security model.

2. **Python API removed, not left alongside.** Python code and Python tests
   fully removed. One canonical leaderboard API exists, in TypeScript.

3. **Reconcile every Python-referencing artifact.** deployment docs, CI,
   .env.example corrected. Grep verified no stale Python references.

4. **Manual deployment steps marked explicitly.** Steps requiring Hostinger
   hPanel access documented in packet-31.5-manual-steps.md with copy-ready
   commands. Packet does not pretend to perform Hostinger UI actions.

5. **MySQL migration kept as-is.** migrations/001_leaderboard.sql is SQL,
   not Python — runtime-agnostic. TypeScript MySQL client (when wired) can
   use the same schema. No rewrite without cause.

6. **Trust model re-verified against shared tests.** The TypeScript port was
   tested for behavioral equivalence including all security validators. Live
   verification against api.alienclaw.net documented for post-deployment.
