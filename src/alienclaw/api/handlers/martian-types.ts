import type { SubmissionStore } from '../storage.js';
import type { MartianTypesResponse } from '../types.js';
import { aggregateOnlineFitness } from '../../telemetry/telemetry-reader.js';

export async function handleMartianTypes(
  registeredTypes: Set<string>,
  store: SubmissionStore,
): Promise<[number, MartianTypesResponse]> {
  const infos = await Promise.all(
    [...registeredTypes].sort().map(async mtype => {
      const [top, total, onlineFit] = await Promise.all([
        store.topForType(mtype, 1),
        store.countForType(mtype),
        aggregateOnlineFitness(mtype),
      ]);
      return {
        name:                mtype,
        current_top_fitness: top[0]?.fitness ?? 0,
        submission_count:    total,
        last_submission_at:  top[0]?.submitted_at ?? '',
        online_fitness:      onlineFit.count > 0 ? onlineFit.mean_fitness : null,
      };
    })
  );
  return [200, { martian_types: infos, total: infos.length }];
}
