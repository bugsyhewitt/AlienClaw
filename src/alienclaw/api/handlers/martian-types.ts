import type { SubmissionStore } from '../storage.js';
import type { MartianTypesResponse } from '../types.js';

export async function handleMartianTypes(
  registeredTypes: Set<string>,
  store: SubmissionStore,
): Promise<[number, MartianTypesResponse]> {
  const infos = await Promise.all(
    [...registeredTypes].sort().map(async mtype => {
      const top   = await store.topForType(mtype, 1);
      const total = await store.countForType(mtype);
      return {
        name:                mtype,
        current_top_fitness: top[0]?.fitness ?? 0,
        submission_count:    total,
        last_submission_at:  top[0]?.submitted_at ?? '',
      };
    })
  );
  return [200, { martian_types: infos, total: infos.length }];
}
