/**
 * HostAdapter seam behavior.
 *
 * Verifies: OpenClaw is the live default and behaves as before; the Hermes host
 * is functional (shared tools wired, LLM provider resolved from Hermes config.yaml
 * or env override, CLI mounted) with only web_search dispatch deferred; the 8-name
 * logical tool contract is frozen; host selection honors ALIENCLAW_HOST.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { OpenClawHostAdapter } from '../../src/alienclaw/governance/openclaw/openclaw-host.js';
import { HermesHostAdapter } from '../../src/alienclaw/governance/hermes/hermes-host.js';
import { HermesToolResolver, LOGICAL_TOOLS } from '../../src/alienclaw/governance/hermes/hermes-tool-resolver.js';
import { registerToolAdapter } from '../../src/alienclaw/msb/martian-executor.js';
import { selectHost, selectHostId } from '../../src/alienclaw/wiring/host-select.js';

// Stub the shared pi-ai completion so LLM tests assert provider/model RESOLUTION
// without a network call. Returns a marker encoding the resolved (provider, model).
vi.mock('../../src/alienclaw/governance/common/pi-ai-complete.js', () => ({
  piAiComplete: vi.fn(async (provider: string, model: string) => `MOCK[${provider}/${model}]`),
}));

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

describe('HermesHostAdapter — functional host', () => {
  afterEach(() => {
    delete process.env['ALIENCLAW_HERMES_PROVIDER'];
    delete process.env['ALIENCLAW_HERMES_MODEL'];
  });

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

  it('wireToolAdapters wires the shared host-agnostic adapters (no throw)', () => {
    const h = new HermesHostAdapter();
    expect(() => h.wireToolAdapters()).not.toThrow();
    // file_read is host-agnostic — resolvable through the shared registry after wiring.
    expect(typeof h.toolResolver().resolve('file_read')).toBe('function');
  });

  it("registerCli mounts AlienClaw's run verb on the given commander program", () => {
    const program = new Command();
    new HermesHostAdapter().registerCli(program);
    expect(program.commands.map((c) => c.name())).toContain('run');
  });

  // LLM provider resolution reads HERMES_HOME/config.yaml — isolate every case to a
  // throwaway HERMES_HOME so tests never touch the developer's real ~/.hermes.
  let hermesHome: string;
  const useTmpHermesHome = () => {
    hermesHome = mkdtempSync(join(tmpdir(), 'hermes-cfg-'));
    process.env['HERMES_HOME'] = hermesHome;
  };
  const writeProfileModel = (profile: string, modelLine: string) => {
    const dir = join(hermesHome, 'profiles', profile);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.yaml'), `model: ${modelLine}\nmax_turns: 90\n`);
  };
  afterEach(() => {
    delete process.env['HERMES_HOME'];
    if (hermesHome) rmSync(hermesHome, { recursive: true, force: true });
  });

  it('llm falls back to the shared default when Hermes config has no model', async () => {
    useTmpHermesHome(); // empty home, no config.yaml
    const out = await new HermesHostAdapter().llm().complete('BossBot', 'sys', 'user');
    expect(out).toMatch(/^MOCK\[anthropic\//); // default provider = ALIENCLAW_PROVIDER
  });

  it('llm reads the profile config.yaml model (provider/model split on first slash)', async () => {
    useTmpHermesHome();
    writeProfileModel('bossbot', 'openrouter/pareto-code');
    const out = await new HermesHostAdapter().llm().complete('BossBot', 'sys', 'user');
    expect(out).toBe('MOCK[openrouter/pareto-code]');
  });

  it('llm ignores a non-pi-ai provider in config and falls back', async () => {
    useTmpHermesHome();
    writeProfileModel('bossbot', 'nous/some-model'); // 'nous' is not a pi-ai provider
    const out = await new HermesHostAdapter().llm().complete('BossBot', 'sys', 'user');
    expect(out).toMatch(/^MOCK\[anthropic\//);
  });

  it('llm env override beats config.yaml', async () => {
    useTmpHermesHome();
    writeProfileModel('bossbot', 'openrouter/pareto-code');
    process.env['ALIENCLAW_HERMES_PROVIDER'] = 'google';
    process.env['ALIENCLAW_HERMES_MODEL'] = 'gemini-x';
    const out = await new HermesHostAdapter().llm().complete('BossBot', 'sys', 'user');
    expect(out).toBe('MOCK[google/gemini-x]');
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

  it('resolve delegates non-HOST_BOUND tools to the shared adapter registry', () => {
    const sentinel = async (_input: Record<string, unknown>): Promise<unknown> => 'sentinel';
    registerToolAdapter('compute', sentinel);
    expect(new HermesToolResolver().resolve('compute')).toBe(sentinel);
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
