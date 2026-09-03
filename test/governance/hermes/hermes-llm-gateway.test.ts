/**
 * hermes-llm-gateway.test.ts
 *
 * Covers branches in HermesLlmGateway / readConfigModel / resolveModel that
 * are NOT exercised by the integration-style tests in host-adapter.test.ts:
 *
 *   L-1xx  readConfigModel — inline comment stripping (space/tab before #)
 *   L-2xx  resolveModel — partial env override (only one of the two env vars set)
 *   L-3xx  resolveModel — per-agent default model (CreatorBot→FAST, AdvisorBot→POWER)
 *   L-4xx  complete() — system/user arg forwarding and return-value passthrough
 *
 * Uses real tmp dirs (same pattern as host-adapter.test.ts) so fs paths hit
 * real files; piAiComplete is the only mock needed.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// ── Stub piAiComplete — no network call; encodes (provider/model) as a marker ──

const { mockPiAiComplete } = vi.hoisted(() => ({
  mockPiAiComplete: vi.fn(async (provider: string, model: string) => `MOCK[${provider}/${model}]`),
}));

vi.mock('../../../src/alienclaw/governance/common/pi-ai-complete.js', () => ({
  piAiComplete: mockPiAiComplete,
}));

import { HermesLlmGateway } from '../../../src/alienclaw/governance/hermes/hermes-llm-gateway.js';

// ── Tmp-dir helpers (mirrors host-adapter.test.ts) ──────────────────────────

let hermesHome = '';

const useTmpHermesHome = () => {
  hermesHome = mkdtempSync(join(tmpdir(), 'hermes-llmgw-'));
  process.env['HERMES_HOME'] = hermesHome;
};

const writeProfileModel = (profile: string, modelLine: string) => {
  const dir = join(hermesHome, 'profiles', profile);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.yaml'), `model: ${modelLine}\nmax_turns: 90\n`);
};

const writeRootModel = (modelLine: string) => {
  writeFileSync(join(hermesHome, 'config.yaml'), `model: ${modelLine}\nmax_turns: 90\n`);
};

afterEach(() => {
  vi.clearAllMocks();
  delete process.env['HERMES_HOME'];
  delete process.env['ALIENCLAW_HERMES_PROVIDER'];
  delete process.env['ALIENCLAW_HERMES_MODEL'];
  if (hermesHome) {
    rmSync(hermesHome, { recursive: true, force: true });
    hermesHome = '';
  }
});

// ── L-1xx: Inline comment stripping ─────────────────────────────────────────

describe('readConfigModel — inline comment stripping', () => {
  it('L-101: space-prefixed inline comment is stripped; provider/model resolve correctly', async () => {
    useTmpHermesHome();
    writeProfileModel('bossbot', 'openrouter/qwen-coder # fast code model');
    const out = await new HermesLlmGateway().complete('BossBot', 'sys', 'usr');
    expect(out).toBe('MOCK[openrouter/qwen-coder]');
  });

  it('L-102: tab-prefixed inline comment is also stripped ([ \\t]+ branch)', async () => {
    useTmpHermesHome();
    // Literal tab between model value and # — regex [ \t]+# matches it.
    writeProfileModel('bossbot', `openrouter/qwen-coder\t# tab-separated comment`);
    const out = await new HermesLlmGateway().complete('BossBot', 'sys', 'usr');
    expect(out).toBe('MOCK[openrouter/qwen-coder]');
  });

  it('L-103: comment directly attached to model value (no space/tab before #) is stripped', async () => {
    useTmpHermesHome();
    // No whitespace between model value and `#` — YAML 1.2 inline-comment
    // grammar still permits this (a `#` begins a comment at start-of-line OR
    // after whitespace). The regex must use `[ \t]*` (zero-or-more), not
    // `[ \t]+` (one-or-more), otherwise the `#note` suffix leaks downstream
    // as part of the model id and the LLM call fails.
    writeProfileModel('bossbot', 'openrouter/qwen-coder#nospace');
    const out = await new HermesLlmGateway().complete('BossBot', 'sys', 'usr');
    expect(out).toBe('MOCK[openrouter/qwen-coder]');
  });
});

// ── L-2xx: Partial env override ─────────────────────────────────────────────

describe('resolveModel — partial env override falls through to config/defaults', () => {
  it('L-201: only ALIENCLAW_HERMES_PROVIDER set → env branch skipped, falls to defaults', async () => {
    useTmpHermesHome(); // empty home — no config files
    process.env['ALIENCLAW_HERMES_PROVIDER'] = 'openai';
    // ALIENCLAW_HERMES_MODEL intentionally absent
    const out = await new HermesLlmGateway().complete('BossBot', 'sys', 'usr');
    // env guard requires BOTH; neither branch taken → default ALIENCLAW_PROVIDER
    expect(out).toMatch(/^MOCK\[anthropic\//);
  });

  it('L-202: only ALIENCLAW_HERMES_MODEL set → env branch skipped, falls to defaults', async () => {
    useTmpHermesHome(); // empty home — no config files
    process.env['ALIENCLAW_HERMES_MODEL'] = 'gpt-4o';
    // ALIENCLAW_HERMES_PROVIDER intentionally absent
    const out = await new HermesLlmGateway().complete('BossBot', 'sys', 'usr');
    expect(out).toMatch(/^MOCK\[anthropic\//);
  });

  it('L-203: partial env does not suppress a valid config.yaml (config wins when only one env var set)', async () => {
    useTmpHermesHome();
    writeRootModel('openrouter/qwen-coder');
    process.env['ALIENCLAW_HERMES_PROVIDER'] = 'openai'; // provider only — no model
    const out = await new HermesLlmGateway().complete('BossBot', 'sys', 'usr');
    // env branch skipped → config.yaml fires → openrouter wins
    expect(out).toBe('MOCK[openrouter/qwen-coder]');
  });
});

// ── L-3xx: Per-agent default model ──────────────────────────────────────────

describe('resolveModel — per-agent default model (no config)', () => {
  it('L-301: CreatorBot uses AGENT_MODELS.CreatorBot (FAST = claude-haiku-4-5)', async () => {
    useTmpHermesHome();
    const out = await new HermesLlmGateway().complete('CreatorBot', 'sys', 'usr');
    expect(out).toBe('MOCK[anthropic/claude-haiku-4-5]');
  });

  it('L-302: AdvisorBot uses AGENT_MODELS.AdvisorBot (POWER = claude-opus-4-6)', async () => {
    useTmpHermesHome();
    const out = await new HermesLlmGateway().complete('AdvisorBot', 'sys', 'usr');
    expect(out).toBe('MOCK[anthropic/claude-opus-4-6]');
  });
});

// ── L-4xx: complete() arg forwarding and return-value passthrough ────────────

describe('HermesLlmGateway.complete() — arg forwarding and return-value passthrough', () => {
  it('L-401: system and user content are forwarded to piAiComplete verbatim', async () => {
    useTmpHermesHome();
    const sys = 'you are BossBot\nmission: supervise';
    const usr = 'what is the current goal status?';
    await new HermesLlmGateway().complete('BossBot', sys, usr);
    const [, , calledSys, calledUsr] = mockPiAiComplete.mock.calls[0] as unknown as [string, string, string, string];
    expect(calledSys).toBe(sys);
    expect(calledUsr).toBe(usr);
  });

  it('L-402: return value from piAiComplete is forwarded verbatim to the caller', async () => {
    useTmpHermesHome();
    mockPiAiComplete.mockResolvedValueOnce('goal: active | tasks: 3 pending');
    const result = await new HermesLlmGateway().complete('BossBot', 'sys', 'usr');
    expect(result).toBe('goal: active | tasks: 3 pending');
  });
});
