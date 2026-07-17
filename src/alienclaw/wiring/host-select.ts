/**
 * Host selection — resolve the active HostAdapter from the ALIENCLAW_HOST env.
 *
 * Default 'openclaw' preserves existing behavior exactly. 'hermes' returns the
 * scaffold adapter, which fails fast on the first capability call (see
 * HermesHostAdapter). This is the single composition point that knows about
 * both concrete host implementations.
 */
import type { HostAdapter, HostId } from '../governance/common/host-adapter.js';
import { OpenClawHostAdapter } from '../governance/openclaw/openclaw-host.js';
import { HermesHostAdapter } from '../governance/hermes/hermes-host.js';

export function selectHostId(): HostId {
  // `||` (not `??`) so an empty string also falls back to the default.
  const raw = (process.env['ALIENCLAW_HOST'] || 'openclaw').toLowerCase();
  if (raw === 'openclaw') return 'openclaw';
  if (raw === 'hermes')   return 'hermes';
  throw new Error(`ALIENCLAW_HOST must be 'openclaw' or 'hermes' (got '${raw}')`);
}

export function selectHost(): HostAdapter {
  return selectHostId() === 'hermes'
    ? new HermesHostAdapter()
    : new OpenClawHostAdapter();
}
