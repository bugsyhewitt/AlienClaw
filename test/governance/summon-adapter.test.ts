import { describe, it, expect } from 'vitest';
import {
  MockMartianSummonAdapter,
  type MartianSummonRequest,
} from '../../src/alienclaw/governance/common/summon-adapter.js';
import { newCorrelationId } from '../../src/alienclaw/governance/common/messages.js';

const makeRequest = (overrides?: Partial<MartianSummonRequest>): MartianSummonRequest => ({
  summon_id:    newCorrelationId(),
  genome:       'A'.repeat(256),
  martian_type: 'compute',
  inputs:       { task: 'test' },
  timeout_ms:   5000,
  ...overrides,
});

describe('MockMartianSummonAdapter', () => {
  it('returns ok=true by default', async () => {
    const adapter = new MockMartianSummonAdapter();
    const result  = await adapter.summon(makeRequest());
    expect(result.ok).toBe(true);
  });

  it('echoes summon_id', async () => {
    const adapter = new MockMartianSummonAdapter();
    const req     = makeRequest({ summon_id: 'test-id-123' });
    const result  = await adapter.summon(req);
    expect(result.summon_id).toBe('test-id-123');
  });

  it('uses fixedFitness', async () => {
    const adapter = new MockMartianSummonAdapter(0.42);
    const result  = await adapter.summon(makeRequest());
    expect(result.fitness).toBe(0.42);
  });

  it('uses fixedOutput', async () => {
    const adapter = new MockMartianSummonAdapter(0.5, { answer: 99 });
    const result  = await adapter.summon(makeRequest());
    expect(result.output?.['answer']).toBe(99);
  });

  it('echoes martian_type in output', async () => {
    const adapter = new MockMartianSummonAdapter();
    const result  = await adapter.summon(makeRequest({ martian_type: 'search_text' }));
    expect(result.output?.['echoed_martian_type']).toBe('search_text');
  });

  it('shouldFail=true returns ok=false with error', async () => {
    const adapter = new MockMartianSummonAdapter(0.5, {}, true, 'boom');
    const result  = await adapter.summon(makeRequest());
    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
    expect(result.fitness).toBe(0.0);
    expect(result.output).toBeUndefined();
  });

  it('run_metadata has tool_calls and wall_clock_ms', async () => {
    const adapter = new MockMartianSummonAdapter();
    const result  = await adapter.summon(makeRequest());
    expect(typeof result.run_metadata.tool_calls).toBe('number');
    expect(typeof result.run_metadata.wall_clock_ms).toBe('number');
  });

  it('is deterministic — same request → same result', async () => {
    const adapter = new MockMartianSummonAdapter();
    const req     = makeRequest({ summon_id: 'fixed' });
    const r1      = await adapter.summon(req);
    const r2      = await adapter.summon(req);
    expect(r1).toEqual(r2);
  });
});
