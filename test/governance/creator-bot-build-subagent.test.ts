/**
 * creator-bot-build-subagent.test.ts — CreatorBot.buildSubagent increment.
 *
 * Acceptance criteria under test (architect review, 2026-07-02):
 *  - buildSubagent resolves domain → martian_type strictly; unknown domains
 *    throw BEFORE any Subagent exists or workspace is written.
 *  - The built Subagent carries fromPopulation: true all the way into the
 *    MartianSummonRequest (so real wiring draws evolved genomes via
 *    summon-from-population).
 *  - MartianSummonResult.fitness is passed through unchanged — the
 *    governance layer never recomputes fitness.
 *  - Bindings are idempotent per domain and hold no live-agent state.
 *  - The new modules import nothing from the genome layer (no genome
 *    creation or mutation in governance code paths added here).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CreatorBot } from '../../src/alienclaw/governance/common/creator-bot.js';
import { DomainResolver } from '../../src/alienclaw/governance/common/domain-resolver.js';
import type { Logger } from '../../src/alienclaw/governance/common/logger.js';
import type {
  MartianSummonAdapter,
  MartianSummonRequest,
  MartianSummonResult,
} from '../../src/alienclaw/governance/common/summon-adapter.js';

const noopLogger = {
  info:  () => {},
  warn:  () => {},
  error: () => {},
} as unknown as Logger;

/** Adapter that records every summon request and returns a fixed fitness. */
class CapturingAdapter implements MartianSummonAdapter {
  readonly requests: MartianSummonRequest[] = [];
  constructor(private readonly fixedFitness = 0.42) {}
  async summon(request: MartianSummonRequest): Promise<MartianSummonResult> {
    this.requests.push(request);
    return {
      summon_id:    request.summon_id,
      ok:           true,
      output:       { echoed_martian_type: request.martian_type },
      fitness:      this.fixedFitness,
      run_metadata: { tool_calls: 1, wall_clock_ms: 1 },
    };
  }
}

describe('CreatorBot.buildSubagent', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'alienclaw-build-subagent-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('builds a Subagent bound to the resolved martian type with a workspace', () => {
    const bot = new CreatorBot(noopLogger, new CapturingAdapter(), baseDir, new DomainResolver(['compute']));
    const subagent = bot.buildSubagent('compute', {
      campaignId: 'c-build-1',
      objective:  'compute the answer',
    });
    expect(existsSync(subagent.workspaceDir)).toBe(true);
    expect(existsSync(path.join(subagent.workspaceDir, 'SOUL.md'))).toBe(true);
  });

  it('sends fromPopulation: true and the resolved martian_type in the summon request', async () => {
    const adapter = new CapturingAdapter();
    const bot = new CreatorBot(noopLogger, adapter, baseDir, new DomainResolver(['compute'], { math: 'compute' }));
    const subagent = bot.buildSubagent('math', {
      campaignId: 'c-build-2',
      objective:  'compute the answer',
      inputs:     { plan: '2+2' },
    });
    const report = await subagent.execute();
    subagent.erase();

    expect(adapter.requests).toHaveLength(1);
    expect(adapter.requests[0]!.fromPopulation).toBe(true);
    expect(adapter.requests[0]!.martian_type).toBe('compute');
    expect(report.martianType).toBe('compute');
  });

  it('passes runtime fitness through unchanged (never recomputes)', async () => {
    const adapter = new CapturingAdapter(0.42);
    const bot = new CreatorBot(noopLogger, adapter, baseDir, new DomainResolver(['compute']));
    const subagent = bot.buildSubagent('compute', {
      campaignId: 'c-build-3',
      objective:  'compute the answer',
    });
    const report = await subagent.execute();
    subagent.erase();
    expect(report.result.fitness).toBe(0.42);
  });

  it('unknown domain: throws, creates no Subagent, writes no workspace', () => {
    const bot = new CreatorBot(noopLogger, new CapturingAdapter(), baseDir, new DomainResolver(['compute']));
    expect(() =>
      bot.buildSubagent('astrology', { campaignId: 'c-build-4', objective: 'divine the answer' }),
    ).toThrow(/unknown domain 'astrology'/);
    expect(readdirSync(baseDir)).toHaveLength(0);
  });

  it('is idempotent per domain — one binding, same martian type across builds', () => {
    const resolver = new DomainResolver(['compute'], { math: 'compute' });
    const bot = new CreatorBot(noopLogger, new CapturingAdapter(), baseDir, resolver);
    const a = bot.buildSubagent('math', { campaignId: 'c-build-5a', objective: 'x' });
    const b = bot.buildSubagent('math', { campaignId: 'c-build-5b', objective: 'y' });
    expect(resolver.bindingCount).toBe(1);
    expect(resolver.binding('math')).toBe('compute');
    expect(a.subagentId).not.toBe(b.subagentId); // ephemeral agents, not a live registry
  });

  it('requires a wired DomainResolver', () => {
    const bot = new CreatorBot(noopLogger, new CapturingAdapter(), baseDir);
    expect(() =>
      bot.buildSubagent('compute', { campaignId: 'c-build-6', objective: 'x' }),
    ).toThrow(/requires a DomainResolver/);
  });

  it('new modules import nothing from the genome layer', () => {
    const root = path.resolve(__dirname, '../../src/alienclaw/governance/common');
    for (const file of ['domain-resolver.ts', 'creator-bot.ts']) {
      const source = readFileSync(path.join(root, file), 'utf-8');
      expect(source).not.toMatch(/from ['"].*genome/);
    }
  });
});
