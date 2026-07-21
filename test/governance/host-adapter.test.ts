/**
 * HostAdapter seam behavior.
 *
 * Verifies: OpenClaw is the live default and behaves as before; the Hermes host
 * is functional (shared tools wired, LLM provider resolved from Hermes config.yaml
 * or env override, CLI mounted; web_search dispatches to Hermes); the 8-name
 * logical tool contract is frozen; host selection honors ALIENCLAW_HOST.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
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

  it('llm routes through ALIENCLAW_PROVIDER (anthropic) + AGENT_MODELS', async () => {
    const out = await new OpenClawHostAdapter().llm().complete('BossBot', 'sys', 'user');
    expect(out).toMatch(/^MOCK\[anthropic\//);
  });

  it('registerCli mounts the run verb on the given commander program', () => {
    const program = new Command();
    new OpenClawHostAdapter().registerCli(program);
    expect(program.commands.map((c) => c.name())).toContain('run');
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

  it('toolResolver() returns a HermesToolResolver instance', () => {
    expect(new HermesHostAdapter().toolResolver()).toBeInstanceOf(HermesToolResolver);
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

  it('llm resolves a quoted model value in profile config.yaml (strips surrounding quotes)', async () => {
    useTmpHermesHome();
    writeProfileModel('bossbot', '"openrouter/pareto-code"');  // double-quoted
    const out = await new HermesHostAdapter().llm().complete('BossBot', 'sys', 'user');
    expect(out).toBe('MOCK[openrouter/pareto-code]');
  });

  it('llm falls back to default when profile config.yaml exists but is unreadable', async () => {
    useTmpHermesHome();
    const profileDir = join(hermesHome, 'profiles', 'bossbot');
    mkdirSync(profileDir, { recursive: true });
    const cfgPath = join(profileDir, 'config.yaml');
    writeFileSync(cfgPath, 'model: openrouter/pareto-code\n');
    chmodSync(cfgPath, 0o000);  // existsSync→true, readFileSync→EACCES
    try {
      const out = await new HermesHostAdapter().llm().complete('BossBot', 'sys', 'user');
      expect(out).toMatch(/^MOCK\[anthropic\//);  // catch arm → undefined → default
    } finally {
      chmodSync(cfgPath, 0o644);  // restore for afterEach rmSync cleanup
    }
  });

  it('llm falls back when profile config.yaml has no model: key (bid=2 arm=0)', async () => {
    useTmpHermesHome();
    // Create a config that EXISTS but contains no model: key → !m → arm=0
    const profileDir = join(hermesHome, 'profiles', 'bossbot');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, 'config.yaml'), 'max_turns: 90\nother_setting: true\n');
    const out = await new HermesHostAdapter().llm().complete('BossBot', 'sys', 'user');
    expect(out).toMatch(/^MOCK\[anthropic\//); // readConfigModel → no match → undefined → default
  });

  it('llm falls back when profile config model has no provider/ prefix (bid=9 arm=0)', async () => {
    useTmpHermesHome();
    writeProfileModel('bossbot', 'no-provider-prefix'); // slash=-1 ≤ 0 → continue
    const out = await new HermesHostAdapter().llm().complete('BossBot', 'sys', 'user');
    expect(out).toMatch(/^MOCK\[anthropic\//); // slash<=0 → skip → default
  });

  it('llm resolves a single-quoted model value in profile config.yaml (bid=4 arm=3)', async () => {
    useTmpHermesHome();
    writeProfileModel('bossbot', "'openrouter/pareto-code'"); // single-quoted → arm=3
    const out = await new HermesHostAdapter().llm().complete('BossBot', 'sys', 'user');
    expect(out).toBe('MOCK[openrouter/pareto-code]'); // quotes stripped → provider/model resolved
  });

  it('hermesHome() falls back to ~/.hermes when HERMES_HOME is unset (L35 arm=1)', async () => {
    // Point HOME at an empty temp dir so join(homedir(), '.hermes') resolves to an empty tree.
    // HERMES_HOME stays unset → hermesHome() takes the || right arm (L35) — the branch we cover.
    const fakeHome = mkdtempSync(join(tmpdir(), 'fake-home-'));
    const origHome = process.env['HOME'];
    process.env['HOME'] = fakeHome;
    try {
      delete process.env['HERMES_HOME'];
      const out = await new HermesHostAdapter().llm().complete('BossBot', 'sys', 'user');
      expect(out).toMatch(/^MOCK\[anthropic\//);
    } finally {
      if (origHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = origHome;
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('llm falls back when profile config model is empty after quote-stripping (L57 arm=1)', async () => {
    useTmpHermesHome();
    writeProfileModel('bossbot', '""');  // model: "" → m[1]='""' → strip quotes → v='' → return undefined
    const out = await new HermesHostAdapter().llm().complete('BossBot', 'sys', 'user');
    expect(out).toMatch(/^MOCK\[anthropic\//);  // undefined → skip → default provider
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

  it('resolve delegates non-HOST_BOUND tools to the shared adapter registry', () => {
    const sentinel = async (_input: Record<string, unknown>): Promise<unknown> => 'sentinel';
    registerToolAdapter('compute', sentinel);
    expect(new HermesToolResolver().resolve('compute')).toBe(sentinel);
  });
});

describe('HermesToolResolver.web_search — Hermes dispatch', () => {
  // A stand-in for the Hermes venv python: an executable that ignores its args and
  // writes a fixed payload to stdout — mirrors handle_function_call's JSON-string return.
  let shimDir: string;
  const makeShim = (stdoutPayload: string): string => {
    shimDir = mkdtempSync(join(tmpdir(), 'hermes-py-'));
    const shim = join(shimDir, 'pyshim.sh');
    writeFileSync(shim, `#!/bin/sh\ncat <<'EOF'\n${stdoutPayload}\nEOF\n`, { mode: 0o755 });
    return shim;
  };
  afterEach(() => {
    delete process.env['ALIENCLAW_HERMES_PYTHON'];
    if (shimDir) rmSync(shimDir, { recursive: true, force: true });
  });

  const websearch = () => new HermesToolResolver().resolve('web_search')!;

  it('throws a clear error when ALIENCLAW_HERMES_PYTHON is unset', async () => {
    await expect(websearch()({ query: 'x' })).rejects.toThrow(/set ALIENCLAW_HERMES_PYTHON/);
  });

  it('rejects a missing/empty query', async () => {
    process.env['ALIENCLAW_HERMES_PYTHON'] = makeShim('{"results":[]}');
    await expect(websearch()({})).rejects.toThrow(/non-empty "query"/);
  });

  it('rejects an empty-string query (covers query.length===0 arm)', async () => {
    process.env['ALIENCLAW_HERMES_PYTHON'] = makeShim('{"results":[]}');
    await expect(websearch()({ query: '' })).rejects.toThrow(/non-empty "query"/);
  });

  it('returns the parsed JSON result from Hermes', async () => {
    process.env['ALIENCLAW_HERMES_PYTHON'] = makeShim('{"results":["a","b"]}');
    await expect(websearch()({ query: 'openclaw' })).resolves.toEqual({ results: ['a', 'b'] });
  });

  it("surfaces Hermes' error JSON as a thrown tool error", async () => {
    process.env['ALIENCLAW_HERMES_PYTHON'] = makeShim('{"error":"Web tools are not configured"}');
    await expect(websearch()({ query: 'x' })).rejects.toThrow(/Web tools are not configured/);
  });

  it('throws on non-JSON output from Hermes', async () => {
    process.env['ALIENCLAW_HERMES_PYTHON'] = makeShim('not json at all');
    await expect(websearch()({ query: 'x' })).rejects.toThrow(/non-JSON/);
  });

  it('surfaces Hermes execFile failure as a dispatch error (non-zero exit)', async () => {
    // Shim exits 1 → execFileAsync rejects → catch fires → 'Hermes dispatch failed'
    shimDir = mkdtempSync(join(tmpdir(), 'hermes-py-'));
    const shim = join(shimDir, 'fail.sh');
    writeFileSync(shim, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    process.env['ALIENCLAW_HERMES_PYTHON'] = shim;
    await expect(websearch()({ query: 'x' })).rejects.toThrow(/Hermes dispatch failed/);
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
