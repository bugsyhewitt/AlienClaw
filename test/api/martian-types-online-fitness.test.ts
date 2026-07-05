import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/alienclaw/telemetry/telemetry-reader.js', () => ({
  aggregateOnlineFitness: vi.fn().mockResolvedValue({ count: 3, mean_fitness: 0.75 }),
}));

import { handleMartianTypes } from '../../src/alienclaw/api/handlers/martian-types.js';
import type { SubmissionStore } from '../../src/alienclaw/api/storage.js';

describe('handleMartianTypes — online_fitness positive-count arm (L21 arm-0)', () => {
  it('maps count>0 aggregate to mean_fitness (not null)', async () => {
    const store = {
      topForType:    async () => [],
      countForType:  async () => 0,
    } as unknown as SubmissionStore;
    const [, body] = await handleMartianTypes(new Set(['compute']), store);
    const entry = body.martian_types[0];
    expect(entry?.online_fitness).toBe(0.75);
  });
});
