/**
 * test/wiring/advise-from-telemetry.test.ts
 *
 * Verifies the `advise-from-telemetry` scheduled job registered by `bootstrap()`.
 *
 * The job finds the worst-performing Martian with ≥3 runs in the last hour
 * and asks AdvisorBot for advice. At HEAD b01d18a4, the entire job body was
 * untested — all 14 branch arms (bids 10-17) were cold.
 *
 * Strategy: same vi.mock() harness as fitness-update-summary.test.ts.
 * After bootstrap(), capture the `advise-from-telemetry` fn via
 * `vi.mocked(creatorBot.registerScheduledJob).mock.calls`, inject fixtures
 * via `readRecentMartianReports`, and assert on `advisorBot.advise`.
 *
 * Cold arms targeted (hierarchy-bootstrap.ts):
 *   bid=10 arm=0  L229  reports.length === 0 → early return
 *   bid=10 arm=1  L229  reports.length > 0 → continue
 *   bid=11 arm=0  L234  ?? — reuse existing Map entry (2nd+ report for same martian)
 *   bid=11 arm=1  L234  ?? — new Map entry (first report for a martian)
 *   bid=12 arm=0  L236  if SUCCESS → e.successes++
 *   bid=12 arm=1  L236  if not SUCCESS → no increment
 *   bid=13 arm=0  L242  total < 3 → continue (skip martian)
 *   bid=13 arm=1  L242  total >= 3 → process martian
 *   bid=14 arm=0  L244  !worst || rate < worst.rate is true → update worst
 *   bid=14 arm=1  L244  !worst || rate < worst.rate is false → keep current worst
 *   bid=15 arm=0  L244  !worst is true → short-circuit, update worst (first candidate)
 *   bid=15 arm=1  L244  !worst is false → evaluate rate < worst.rate
 *   bid=16 arm=0  L247  !worst → no candidate found, early return (no advise call)
 *   bid=16 arm=1  L247  worst found → proceed to advise
 *   bid=17 arm=0  L251  ?.total not nullish → use actual total (reachable via worst.id in byMartian)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Stubs (hoisted before imports) ────────────────────────────────────────────

vi.mock('../../src/alienclaw/agents/bossbot.js',       () => ({ bossBot: {} }));
vi.mock('../../src/alienclaw/agents/advisorbot.js',    () => ({
  advisorBot: { advise: vi.fn(async function() { return { verdict: 'monitor closely' }; }) },
}));
vi.mock('../../src/alienclaw/agents/creatorbot.js',    () => ({
  creatorBot: {
    registerScheduledJob: vi.fn(),
    startScheduler:       vi.fn(),
    stopScheduler:        vi.fn(),
    enqueue:              vi.fn(),
  },
}));
vi.mock('../../src/alienclaw/agents/agent-registry.js', () => ({ agentRegistry: {} }));

vi.mock('../../src/alienclaw/config/alienclaw-config.js', () => ({
  alienClawConfig: { preferences: {} },
}));

vi.mock('../../src/alienclaw/msb/tool-adapters.js', () => ({
  wireToolAdapters:    vi.fn(),
  ALLOWED_FETCH_HOSTS: new Set<string>(),
  isBlockedHost:       () => false,
  assertSafeFetchUrl:  (u: string) => new URL(u),
}));

vi.mock('../../src/alienclaw/registry/registry.js', () => ({
  getRegistry: vi.fn(function() {
    return { load: vi.fn(), list: vi.fn(function() { return []; }), get: vi.fn() };
  }),
}));
vi.mock('../../src/alienclaw/registry/genome-codec.js', () => ({
  validateGenome: vi.fn(() => ({ valid: true, errors: [] })),
}));
vi.mock('../../src/alienclaw/registry/seed-installer.js', () => ({
  installSeeds: vi.fn(),
}));

vi.mock('../../src/alienclaw/constants.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/alienclaw/constants.js')>();
  return {
    ...orig,
    PATHS: {
      home:               '/tmp/ac-test-aft',
      workspace:          '/tmp/ac-test-aft/workspace',
      config:             '/tmp/ac-test-aft/alienclaw.json',
      preferences:        '/tmp/ac-test-aft/preferences.json',
      goals:              '/tmp/ac-test-aft/workspace/goals.json',
      output:             '/tmp/ac-test-aft/workspace/output',
      registry:           '/tmp/ac-test-aft/registry',
      ms:                 '/tmp/ac-test-aft/registry/ms',
      msb:                '/tmp/ac-test-aft/registry/msb',
      lineage:            '/tmp/ac-test-aft/registry/lineage/lineage.json',
      telemetry:          '/tmp/ac-test-aft/registry/telemetry',
      liveFitnessSummary: '/tmp/ac-test-aft/live-fitness-summary.json',
    },
  };
});

vi.mock('../../src/alienclaw/governance/common/goal-manager.js',        () => ({ GoalManager:        vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/task-manager.js',        () => ({ TaskManager:        vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/escalation-handler.js',  () => ({ EscalationHandler:  vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/completion-handler.js',  () => ({ CompletionHandler:  vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/real-summon-adapter.js', () => ({ RealMartianSummonAdapter: vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/creator-bot.js',         () => ({ CreatorBot:         vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/domain-resolver.js',     () => ({ DomainResolver:     vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/logger.js', () => ({
  Logger:         vi.fn(function() { return {}; }),
  JsonStdoutSink: vi.fn(function() { return {}; }),
}));
vi.mock('../../src/alienclaw/governance/common/governance-loop.js', () => ({
  GovernanceLoop: vi.fn(function() { return { stop: vi.fn() }; }),
}));
vi.mock('../../src/alienclaw/comms/user-channel.js', () => ({
  UserChannel: vi.fn(function() { return { verbose: vi.fn(), close: vi.fn() }; }),
}));
vi.mock('../../src/alienclaw/comms/agent-channel.js', () => ({
  AgentChannel:  vi.fn(function() { return { send: vi.fn() }; }),
  agentChannel:  { send: vi.fn() },
}));
vi.mock('../../src/alienclaw/telemetry/telemetry-reader.js', () => ({
  readRecentMartianReports: vi.fn(async function() { return []; }),
  summarizeFitness:         vi.fn(function() { return {}; }),
}));

// ── Imports (after vi.mock stubs) ─────────────────────────────────────────────

import { bootstrap }    from '../../src/alienclaw/wiring/hierarchy-bootstrap.js';
import { creatorBot }   from '../../src/alienclaw/agents/creatorbot.js';
import { advisorBot }   from '../../src/alienclaw/agents/advisorbot.js';
import { agentChannel } from '../../src/alienclaw/comms/agent-channel.js';
import { readRecentMartianReports } from '../../src/alienclaw/telemetry/telemetry-reader.js';
import type { MartianReport }       from '../../src/alienclaw/telemetry/telemetry-reader.js';
import type { AdviceRequest }       from '../../src/alienclaw/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function captureAdviseFn(): () => Promise<void> {
  const calls = vi.mocked(creatorBot.registerScheduledJob).mock.calls;
  const hit   = calls.find(([a]) => a.label === 'advise-from-telemetry');
  if (!hit) throw new Error('advise-from-telemetry job not found in registerScheduledJob calls');
  return hit[0]!.fn;
}

function makeReport(martianId: string, outcome: string, index = 0): MartianReport {
  return {
    reportCode: `r${index}`,
    ts:         1000 + index,
    taskId:     't1',
    subagentId: 's1',
    martianId,
    domain:     'compute',
    outcome:    outcome as MartianReport['outcome'],
    summary:    outcome === 'SUCCESS' ? 'ok' : outcome === 'FAILURE' ? 'fail' : 'malformed',
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('advise-from-telemetry scheduled job (hierarchy-bootstrap.ts)', () => {

  beforeEach(() => {
    vi.mocked(creatorBot.registerScheduledJob).mockClear();
    vi.mocked(advisorBot.advise).mockClear();
    vi.mocked(agentChannel.send).mockClear();
    vi.mocked(readRecentMartianReports).mockReset();
    vi.mocked(readRecentMartianReports).mockResolvedValue([]);
  });

  it('AFT-101: empty reports → early return, advise not called (bid=10 arm=0)', async () => {
    vi.mocked(readRecentMartianReports).mockResolvedValueOnce([]);
    const { shutdown } = bootstrap();
    await captureAdviseFn()();
    expect(advisorBot.advise).not.toHaveBeenCalled();
    shutdown();
  });

  it('AFT-102: reports present but all martians have < 3 runs — no worst, advise not called (bid=10/11/12/13/16 arms)', async () => {
    // 2 reports for compute_a: total=2 < threshold of 3 → worst stays null
    // SUCCESS + FAILURE covers bid=12 arm=0 (SUCCESS) and arm=1 (FAILURE)
    // Two reports for same martianId covers bid=11 arm=1 (new entry) + arm=0 (reuse entry)
    vi.mocked(readRecentMartianReports).mockResolvedValueOnce([
      makeReport('compute_a', 'SUCCESS', 0),
      makeReport('compute_a', 'FAILURE', 1),
    ]);
    const { shutdown } = bootstrap();
    await captureAdviseFn()();
    expect(advisorBot.advise).not.toHaveBeenCalled();
    shutdown();
  });

  it('AFT-103: single martian with ≥3 runs is worst — advise called with context (bid=13/14/15/16/17 arms)', async () => {
    // 3 runs for compute_a: 1 success + 2 failures → rate ≈ 0.33, total=3 ≥ 3
    // bid=13 arm=1 (total not < 3), bid=14 arm=0 (update worst: first+only candidate),
    // bid=15 arm=0 (!worst true initially), bid=16 arm=1 (worst found → advise),
    // bid=17 arm=0 (?.total non-null → use 3)
    vi.mocked(readRecentMartianReports).mockResolvedValueOnce([
      makeReport('compute_a', 'SUCCESS', 0),
      makeReport('compute_a', 'FAILURE', 1),
      makeReport('compute_a', 'FAILURE', 2),
    ]);
    const { shutdown } = bootstrap();
    await captureAdviseFn()();
    expect(advisorBot.advise).toHaveBeenCalledOnce();
    const req = vi.mocked(advisorBot.advise).mock.calls[0]![0] as AdviceRequest;
    expect(req.requesterId).toBe('CreatorBot');
    expect(req.context).toContain('compute_a');
    expect(req.context).toMatch(/ran 3 times/);
    expect(req.question).toContain('compute_a');
    shutdown();
  });

  it('AFT-104: two martians both ≥3 runs — selects the one with lower success rate (bid=14/15 arm=1)', async () => {
    // compute_a: 3 FAILURE runs → rate=0.  Appears first → worst = {id:'compute_a', rate:0}
    // compute_b: 3 SUCCESS runs → rate=1.  Appears second:
    //   !worst is false (bid=15 arm=1) → evaluate rate < worst.rate → 1 < 0 = false
    //   → bid=14 arm=1: condition false → worst unchanged → compute_a remains worst
    vi.mocked(readRecentMartianReports).mockResolvedValueOnce([
      makeReport('compute_a', 'FAILURE', 0),
      makeReport('compute_a', 'FAILURE', 1),
      makeReport('compute_a', 'FAILURE', 2),
      makeReport('compute_b', 'SUCCESS', 3),
      makeReport('compute_b', 'SUCCESS', 4),
      makeReport('compute_b', 'SUCCESS', 5),
    ]);
    const { shutdown } = bootstrap();
    await captureAdviseFn()();
    expect(advisorBot.advise).toHaveBeenCalledOnce();
    const req = vi.mocked(advisorBot.advise).mock.calls[0]![0] as AdviceRequest;
    expect(req.context).toContain('compute_a');
    expect(req.context).not.toContain('compute_b');
    shutdown();
  });
});

describe('advise-from-telemetry — malformed outcome filter (PKT-756)', () => {

  beforeEach(() => {
    vi.mocked(creatorBot.registerScheduledJob).mockClear();
    vi.mocked(advisorBot.advise).mockClear();
    vi.mocked(agentChannel.send).mockClear();
    vi.mocked(creatorBot.enqueue).mockClear();
    vi.mocked(readRecentMartianReports).mockReset();
    vi.mocked(readRecentMartianReports).mockResolvedValue([]);
  });

  it('AFT-105: malformed outcome excluded from denominator — rate computed on valid-only (PKT-756)', async () => {
    // 3 SUCCESS + 1 GHOST: only 3 valid → rate=1.0, "ran 3 times" (not 4 at 75%)
    vi.mocked(readRecentMartianReports).mockResolvedValueOnce([
      makeReport('compute_a', 'SUCCESS', 0),
      makeReport('compute_a', 'SUCCESS', 1),
      makeReport('compute_a', 'SUCCESS', 2),
      makeReport('compute_a', 'GHOST',   3),
    ]);
    const { shutdown } = bootstrap();
    await captureAdviseFn()();
    // 3 valid ≥ 3 → advise IS called
    expect(advisorBot.advise).toHaveBeenCalledOnce();
    const req = vi.mocked(advisorBot.advise).mock.calls[0]![0] as AdviceRequest;
    expect(req.context).toMatch(/ran 3 times/);
    expect(req.context).toMatch(/100%/);
    shutdown();
  });

  it('AFT-106: sub-threshold promotion blocked — 2 valid < 3, no advise despite 4 unfiltered reports (PKT-756)', async () => {
    // 2 SUCCESS + 2 GHOST: only 2 valid < 3 → worst stays null, no advise
    vi.mocked(readRecentMartianReports).mockResolvedValueOnce([
      makeReport('compute_a', 'SUCCESS', 0),
      makeReport('compute_a', 'SUCCESS', 1),
      makeReport('compute_a', 'GHOST',   2),
      makeReport('compute_a', 'GHOST',   3),
    ]);
    const { shutdown } = bootstrap();
    await captureAdviseFn()();
    expect(advisorBot.advise).not.toHaveBeenCalled();
    shutdown();
  });

  it('AFT-107: 1 valid + 3 malformed — valid < 3, no advise call (PKT-756)', async () => {
    // 1 SUCCESS + 3 GHOST: only 1 valid < 3 → no advise
    vi.mocked(readRecentMartianReports).mockResolvedValueOnce([
      makeReport('compute_a', 'SUCCESS', 0),
      makeReport('compute_a', 'GHOST',   1),
      makeReport('compute_a', 'GHOST',   2),
      makeReport('compute_a', 'GHOST',   3),
    ]);
    const { shutdown } = bootstrap();
    await captureAdviseFn()();
    expect(advisorBot.advise).not.toHaveBeenCalled();
    shutdown();
  });

  it('AFT-108: ESCALATED is canonical — included in valid count, rate=3/4=75% (PKT-756 regression guard)', async () => {
    // 3 SUCCESS + 1 ESCALATED: all 4 canonical → rate=0.75, "ran 4 times"
    vi.mocked(readRecentMartianReports).mockResolvedValueOnce([
      makeReport('compute_a', 'SUCCESS',   0),
      makeReport('compute_a', 'SUCCESS',   1),
      makeReport('compute_a', 'SUCCESS',   2),
      makeReport('compute_a', 'ESCALATED', 3),
    ]);
    const { shutdown } = bootstrap();
    await captureAdviseFn()();
    expect(advisorBot.advise).toHaveBeenCalledOnce();
    const req = vi.mocked(advisorBot.advise).mock.calls[0]![0] as AdviceRequest;
    expect(req.context).toMatch(/ran 4 times/);
    expect(req.context).toMatch(/75%/);
    shutdown();
  });

  it('AFT-109: NOTABLE diagnostic enqueued for martian with malformed outcomes (PKT-756)', async () => {
    // 3 SUCCESS + 1 GHOST → NOTABLE must fire with martianId + malformed/non-canonical in msg
    vi.mocked(readRecentMartianReports).mockResolvedValueOnce([
      makeReport('compute_a', 'SUCCESS', 0),
      makeReport('compute_a', 'SUCCESS', 1),
      makeReport('compute_a', 'SUCCESS', 2),
      makeReport('compute_a', 'GHOST',   3),
    ]);
    const { shutdown } = bootstrap();
    await captureAdviseFn()();
    const notableCalls = vi.mocked(creatorBot.enqueue).mock.calls.filter(
      ([pri]) => pri === 'NOTABLE',
    );
    expect(notableCalls.length).toBeGreaterThanOrEqual(1);
    const notableMsg = notableCalls.find(([, msg]) => (msg as string).includes('compute_a'))?.[1] as string | undefined;
    expect(notableMsg).toBeDefined();
    expect(notableMsg).toMatch(/malformed|non-canonical/i);
    shutdown();
  });
});
