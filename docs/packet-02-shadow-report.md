# P14-02 Shadow Report (Mock)

**Mode:** mock (no real LLM budget burned)
**Source:** `generateMockShadowReport()` in `src/alienclaw/evolution/graph/shadow-report.ts`

This report demonstrates the shadow-comparison shape that `EVOLVE_TOPOLOGY=shadow` produces:
the evolved graph runs alongside the static team and the two are compared per campaign. The
figures below are illustrative mock data, not measured results — a real shadow run replaces
`mode: "mock"` with `mode: "real"`.

## Per-Campaign Comparisons

| Campaign | Static Correctness | Evolved Correctness | Static $ | Evolved $ | Static Subagents | Evolved Subagents | Operator Mix | Winner |
|---|---|---|---|---|---|---|---|---|
| mock-campaign-001 | 0.72 | 0.76 | $2.40 | $1.86 | 1 | 2 | none×1, best_of_n×1 | evolved |
| mock-campaign-002 | 0.65 | 0.65 | $3.10 | $2.20 | 1 | 2 | none×2 | evolved |

## Summary Deltas (evolved − static, mean across campaigns)

| Metric | Delta | Reading |
|---|---|---|
| correctnessDelta | +0.02 | evolved is marginally more correct on average |
| costDelta | −$0.72 | evolved is cheaper on average |
| subagentCountDelta | +1.0 | evolved fields one extra subagent on average |

## How to Read This

- **Winner = evolved** when the evolved graph is at least as correct AND cheaper, or strictly more
  correct without a cost blow-up. In the mock data both campaigns favor the evolved graph: 001 wins
  on both correctness and cost; 002 ties on correctness but wins on cost.
- A real shadow run is gated behind `EVOLVE_TOPOLOGY=shadow`. The static team remains authoritative
  for delivery while shadow data accumulates. Promotion to `EVOLVE_TOPOLOGY=on` is a human decision
  informed by these deltas, not automatic.
- Cost is capped at `maxStructureCostUsd` (default $9.00, 3× a ~$3 static baseline). Any evolved
  graph exceeding the cap is rejected before it can run.

## Regenerating

```ts
import { generateMockShadowReport } from "../src/alienclaw/evolution/graph/shadow-report.js";
const report = generateMockShadowReport();
console.log(JSON.stringify(report, null, 2));
```
