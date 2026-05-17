# Packet 31.6 — Deferred Items

| Item | Deferred to | Reason |
| --- | --- | --- |
| L5 deployment to Hostinger | Bugsy manual | Requires hPanel access and MySQL credentials |
| api.alienclaw.net DNS wiring | Bugsy manual | Follows L5 deployment |
| Packet 32: README onboarding polish | Packet 32 | Scope; not launch-blocking |
| Packet 33: CODE_OF_CONDUCT, CHANGELOG, CI badge | Packet 33 | Scope; hygiene work |
| Rate-limiter MySQL-backed persistence | Future | Flat-file token bucket is fine for launch volumes |
| Audit log MySQL-backed | Future | JSONL rollover is fine; MySQL migration adds complexity |
