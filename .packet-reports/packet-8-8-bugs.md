# Packet 8.8 — Bugs Found and Fixed

## BUG-8-8-001: Bridge fixture case 22 expected wrong fitness for compute genome

**Severity:** Medium (test failure)  
**Discovery:** After adding validation_count to compute runner, test suite failed  
**Root cause:** The bridge fixture (test/fixtures/bridge-fixture.json) case 22 tested
"fitness=1.0 for 1 call" using a specific compute genome that now decodes
validation_count=3 → tool_calls=3 → fitness=1/3=0.333. The fixture expected 1.0.  
**Fix:** Updated case 22 description and expected_fitness to 1/3 (exact Python float).  
**What the test now verifies:** fitness correctly scales with validation_count (genome
param); a genome with validation_count=3 gets fitness=0.333, not 1.0.  
**Lesson:** Any genome-hardcoded in a fixture will need updating when new genome params
are added that change the decoding of that genome's bytes.
