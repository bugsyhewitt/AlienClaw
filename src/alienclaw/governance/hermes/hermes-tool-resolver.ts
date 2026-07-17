/**
 * HermesToolResolver — Hermes host tool resolution (SCAFFOLD).
 *
 * Structural counterpart of msb/openclaw-tool-resolver.ts. LOGICAL_TOOLS is the
 * full logical tool set (src/alienclaw/tools/*.py); a host resolver need only
 * satisfy the names its Martians reference. Of these, only host-native tools
 * (today: web_search) must be wired to the host's tool layer; the rest are
 * host-agnostic.
 *
 * SCAFFOLD CAVEAT: the host-agnostic branch delegates to the shared executor
 * registry (getToolAdapter), which is populated by the shared wireToolAdapters().
 * In a Hermes-only process that shared wiring has NOT run yet — HermesHostAdapter
 * boots fail-fast (its wireToolAdapters() throws) — so this resolver is a
 * structural stub today, exercised only by unit tests. Phase 2 makes
 * HermesHostAdapter.wireToolAdapters() register the shared adapters (so the
 * registry is populated) then the Hermes-native ones.
 *
 * TODO(hermes): wire host-bound tools to Hermes' tool registry
 * (tools/registry.py -> toolsets.py -> model_tools.py). Until then web_search
 * throws, exactly as OpenClaw's web_search is a stub today.
 */
import type { ToolFn, ToolResolver } from '../../msb/martian-executor.js';
import { getToolAdapter } from '../../msb/martian-executor.js';

/** The frozen logical tool contract both host resolvers must satisfy exactly. */
export const LOGICAL_TOOLS = [
  'compute',
  'web_search',
  'url_fetch',
  'file_read',
  'file_write',
  'http_get',
  'search_text',
  'extract_json',
] as const;

/** Tools that must be resolved against the host's native tool layer. */
const HOST_BOUND: ReadonlySet<string> = new Set(['web_search']);

function pendingHermesTool(name: string): ToolFn {
  return async () => {
    throw new Error(`${name}: pending Hermes tool-layer wiring`);
  };
}

export class HermesToolResolver implements ToolResolver {
  resolve(toolName: string): ToolFn | undefined {
    if (HOST_BOUND.has(toolName)) return pendingHermesTool(toolName);
    // Host-agnostic tools are shared across hosts — delegate to the executor's
    // adapter registry rather than reimplementing them.
    return getToolAdapter(toolName);
  }

  supportedTools(): string[] {
    return [...LOGICAL_TOOLS];
  }
}
