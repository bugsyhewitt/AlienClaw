/**
 * HostAdapter seam — scaffold behavior.
 *
 * Verifies: OpenClaw is the live default and behaves as before; Hermes is a
 * fail-fast scaffold; the 8-name logical tool contract is frozen; host
 * selection honors ALIENCLAW_HOST.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { OpenClawHostAdapter } from '../../src/alienclaw/governance/openclaw/openclaw-host.js';
import { HermesHostAdapter } from '../../src/alienclaw/governance/hermes/hermes-host.js';
import { HermesToolResolver, LOGICAL_TOOLS } from '../../src/alienclaw/governance/hermes/hermes-tool-resolver.js';
import { selectHost, selectHostId } from '../../src/alienclaw/wiring/host-select.js';

describe('OpenClawHostAdapter — live default', () => {
  it('reports hostId openclaw', () => {
    expect(new OpenClawHostAdapter().hostId).toBe('openclaw');
  });

  it('installProfile points at ~/.openclaw', () => {
    const p = new OpenClawHostAdapter().installProfile();
    expect(p.configDir).toBe(join(homedir(), '.openclaw'));
    expect(p.agentsDir).toBe(join(homedir(), '.openclaw', 'agents'));
    expect(p.configFile).toBe(join(homedir(), '.openclaw', 'openclaw.json'));
  });

  it('wireToolAdapters does not throw (delegates to the shared registry)', () => {
    expect(() => new OpenClawHostAdapter().wireToolAdapters()).not.toThrow();
  });

  it('toolResolver resolves the shared file_read tool', () => {
    const r = new OpenClawHostAdapter().toolResolver();
    expect(typeof r.resolve('file_read')).toBe('function');
  });
});

describe('HermesHostAdapter — fail-fast scaffold', () => {
  it('reports hostId hermes', () => {
    expect(new HermesHostAdapter().hostId).toBe('hermes');
  });

  it('installProfile points at ~/.hermes with the real profiles/ layout', () => {
    const p = new HermesHostAdapter().installProfile();
    expect(p.configDir).toBe(join(homedir(), '.hermes'));
    // Hermes' multi-agent unit is the profile (~/.hermes/profiles/<name>/), not agents/.
    expect(p.agentsDir).toBe(join(homedir(), '.hermes', 'profiles'));
    expect(p.configFile).toBe(join(homedir(), '.hermes', 'config.yaml'));
  });

  it('wireToolAdapters fails fast with an explicit not-wired message', () => {
    expect(() => new HermesHostAdapter().wireToolAdapters()).toThrow(/Hermes host not yet wired — tool wiring/);
  });

  it('registerCli fails fast', () => {
    // A no-op Command stand-in; registerCli must throw before using it.
    expect(() => new HermesHostAdapter().registerCli({} as never)).toThrow(/Hermes host not yet wired — CLI registration/);
  });

  it('llm().complete rejects with not-wired', async () => {
    await expect(
      new HermesHostAdapter().llm().complete('BossBot', 'sys', 'user'),
    ).rejects.toThrow(/Hermes host not yet wired — LLM provider/);
  });
});

describe('Frozen 8-name logical tool contract', () => {
  const CANONICAL = [
    'compute', 'web_search', 'url_fetch', 'file_read',
    'file_write', 'http_get', 'search_text', 'extract_json',
  ];

  it('HermesToolResolver.supportedTools equals the canonical 8', () => {
    expect(new HermesToolResolver().supportedTools().sort()).toEqual([...CANONICAL].sort());
  });

  it('LOGICAL_TOOLS export equals the canonical 8', () => {
    expect([...LOGICAL_TOOLS].sort()).toEqual([...CANONICAL].sort());
  });

  it('web_search resolves to a fn that throws pending-Hermes (host-bound stub)', async () => {
    const fn = new HermesToolResolver().resolve('web_search');
    expect(typeof fn).toBe('function');
    await expect(fn!({})).rejects.toThrow(/pending Hermes tool-layer wiring/);
  });
});

describe('Host selection (ALIENCLAW_HOST)', () => {
  const saved = process.env['ALIENCLAW_HOST'];
  afterEach(() => {
    if (saved === undefined) delete process.env['ALIENCLAW_HOST'];
    else process.env['ALIENCLAW_HOST'] = saved;
  });

  it('defaults to openclaw when unset', () => {
    delete process.env['ALIENCLAW_HOST'];
    expect(selectHostId()).toBe('openclaw');
    expect(selectHost()).toBeInstanceOf(OpenClawHostAdapter);
  });

  it('treats an empty ALIENCLAW_HOST as the default (not an error)', () => {
    process.env['ALIENCLAW_HOST'] = '';
    expect(selectHostId()).toBe('openclaw');
  });

  it('selects hermes when ALIENCLAW_HOST=hermes (case-insensitive)', () => {
    process.env['ALIENCLAW_HOST'] = 'Hermes';
    expect(selectHostId()).toBe('hermes');
    expect(selectHost()).toBeInstanceOf(HermesHostAdapter);
  });

  it('rejects an unknown host', () => {
    process.env['ALIENCLAW_HOST'] = 'bogus';
    expect(() => selectHostId()).toThrow(/must be 'openclaw' or 'hermes'/);
  });
});
