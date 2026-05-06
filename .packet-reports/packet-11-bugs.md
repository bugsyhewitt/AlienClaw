# Packet 11 — Bugs Found and Fixed

## BUG-11-001: MartianSummonResult mock missing required summon_id field

**Severity:** Low (TypeScript compile error, not runtime bug)  
**Discovery:** tsc --noEmit after writing memory-append.test.ts  
**Root cause:** MartianSummonResult interface requires `summon_id: string` but the
inline mock object in the test omitted it.  
**Fix:** Added `summon_id: 'mock-id'` to the inline mock result object.  
**Lesson:** When writing test fixtures for TypeScript interfaces, always check the
interface definition before inlining a mock object.
