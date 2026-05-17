import { hashApiKey } from '../auth.js';
import type { InstallStore } from '../storage.js';
import type { InstallRequest, InstallResponse } from '../types.js';
import { validateInstallRequest } from '../validation.js';

export function handleInstall(
  req: InstallRequest,
  store: InstallStore,
): [number, InstallResponse | { error: unknown }] {
  const v = validateInstallRequest(req);
  if (!v.valid) throw new Error(JSON.stringify(v.error));

  const apiKeyHash = hashApiKey(req.api_key);
  const [installId, isNew] = store.register(apiKeyHash, req.machine_hash);

  return [(isNew ? 201 : 200), {
    status:     isNew ? 'registered' : 'known',
    install_id: installId,
    rate_limit: { submissions_per_hour: 100, window_seconds: 3600 },
  }];
}
