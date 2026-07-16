/**
 * ValidateHook (P14-02) — the generic shape the engine's `validate` accepts.
 *
 * Graph adapters wrap a GraphValidator behind this hook so the reflective
 * engine can reject illegal subagents/topologies without importing graph code.
 */
export interface ValidateHook {
  (candidate: { id: string; editable: Record<string, string> }): { ok: true } | { ok: false; violation: string };
}
