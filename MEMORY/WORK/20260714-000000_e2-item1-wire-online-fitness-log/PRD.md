---
task: Wire OnlineFitnessLog into GovernanceLoop at bootstrap
slug: 20260714-000000_e2-item1-wire-online-fitness-log
effort: standard
phase: complete
progress: 7/7
mode: interactive
started: 2026-07-14T00:00:00Z
updated: 2026-07-14T00:05:00Z
---

## Context

E2 item 1: the only missing link in the live-fitness loop is that `hierarchy-bootstrap.ts`
constructs `GovernanceLoop` without passing `onlineFitnessLog`. The field exists in the
interface (line 68), the constructor stores it (line 127), and it's called on campaign
success (line 418). This is a ~3-line production change + one wiring test.

### Risks

- Risk: `vi.fn(() => arrowFn)` fails as a class constructor in vitest 4.x. Fix: replaced all class mock implementations with `function` keyword (not arrow functions). Evidence: the arrow-function versions threw "not a constructor"; the function-keyword versions pass.
- Risk: DEFAULT_PATH in online-fitness-log.ts evaluated at module load time from homedir(). Actual impact: mkdirSync(~/.alienclaw/) is idempotent — no file written in test since GovernanceLoop is mocked.

## Criteria

- [x] ISC-1: `hierarchy-bootstrap.ts` imports `OnlineFitnessLog` from `online-fitness-log.js`
- [x] ISC-2: `bootstrap()` instantiates one `OnlineFitnessLog` (default path)
- [x] ISC-3: The `new GovernanceLoop({...})` deps include `onlineFitnessLog`
- [x] ISC-4: New test asserts `bootstrap()` passes an `OnlineFitnessLog` into `GovernanceLoop`
- [x] ISC-5: Test stubs creatorBot.stopScheduler + calls shutdown() — no leaked scheduler timer
- [x] ISC-6: `pnpm exec vitest run` is green (104 files, 1725 tests passing)
- [x] ISC-7: `pnpm test` is green (vitest 1725 + pytest 1168 passed)

## Decisions

- Used static `vi.mock()` (hoisted) rather than `vi.doMock()` + `vi.resetModules()` to avoid module identity issues and `vi.fn()` factory serialization problems in vitest 4.x workers.
- All `vi.fn(impl)` class constructor mocks use `function` keyword, not arrow functions. vitest 4.x enforces this for use with `new`.

## Verification

```
# ISC-1: grep "OnlineFitnessLog" src/alienclaw/wiring/hierarchy-bootstrap.ts
import { OnlineFitnessLog } from '../governance/common/online-fitness-log.js';

# ISC-2/3: grep "onlineFitnessLog" src/alienclaw/wiring/hierarchy-bootstrap.ts  
const onlineFitnessLog = new OnlineFitnessLog();
    onlineFitnessLog,   ← inside new GovernanceLoop({...})

# ISC-4/5: pnpm exec vitest run test/wiring/hierarchy-bootstrap-online-fitness.test.ts
Tests  2 passed (2)

# ISC-6: pnpm exec vitest run
Test Files  104 passed | 1 skipped (105)
Tests  1725 passed | 40 skipped (1765)

# ISC-7: pytest
1168 passed, 125 skipped, 7 warnings

# ISC-A3: recorder call site untouched
governance-loop.ts:418: this.onlineFitnessLog?.record(martianType, campaignResult.fitness)
```
