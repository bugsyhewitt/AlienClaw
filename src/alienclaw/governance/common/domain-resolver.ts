/**
 * Domain → martian_type resolution.
 *
 * Governance-layer campaign spawns historically defaulted a missing or
 * unknown domain to 'compute' (spawnCampaign, CreatorBot.runCampaign).
 * That silent fallback runs the wrong Martian instead of failing the
 * campaign. DomainResolver makes the mapping explicit: unknown domains
 * are rejected with an error, and each successful resolution is recorded
 * in an in-memory binding directory so a domain resolves identically for
 * the lifetime of the resolver.
 *
 * The directory records string bindings only — deliberately NOT live
 * agents. Subagents stay ephemeral, one per campaign; the persistent
 * per-martian_type state lives in the evolution layer's Population,
 * reachable only through the summon bridge.
 */

export class DomainResolver {
  /** domain → martian_type bindings recorded by successful resolves. */
  private readonly bindings = new Map<string, string>();

  constructor(
    private readonly knownTypes: readonly string[],
    private readonly aliases: Readonly<Record<string, string>> = {},
  ) {
    if (knownTypes.length === 0) {
      throw new Error('domain-resolver: knownTypes must be non-empty');
    }
  }

  /** Resolve a domain label to a martian_type, or throw for unknown domains. */
  resolve(domain: string): string {
    const existing = this.bindings.get(domain);
    if (existing !== undefined) return existing;
    const candidate = this.aliases[domain] ?? domain;
    if (!this.knownTypes.includes(candidate)) {
      throw new Error(
        `domain-resolver: unknown domain '${domain}' — known martian types: ${this.knownTypes.join(', ')}`,
      );
    }
    this.bindings.set(domain, candidate);
    return candidate;
  }

  /** The recorded binding for a domain, if it has resolved before. */
  binding(domain: string): string | undefined {
    return this.bindings.get(domain);
  }

  /** Number of recorded domain bindings. */
  get bindingCount(): number {
    return this.bindings.size;
  }
}
