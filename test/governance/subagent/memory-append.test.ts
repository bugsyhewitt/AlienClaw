/**
 * test_memory_append.ts — Verifies MEMORY.md append and section-rewrite semantics.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Subagent } from '../../../src/alienclaw/governance/common/subagent.js';
import { MockMartianSummonAdapter } from '../../../src/alienclaw/governance/common/summon-adapter.js';
import type { SubagentBrief } from '../../../src/alienclaw/governance/common/subagent.js';

const CAMPAIGN_ID = 'CAMP_MEMTEST';

function makeBrief(): SubagentBrief {
  return {
    campaignId: CAMPAIGN_ID, role: 'Memory Test Subagent', domain: 'compute',
    objective: 'Test memory semantics.', scope: 'Unit test.',
    successCriteria: 'Memory correctly maintained.', allowedMartians: ['compute'],
    deliverables: 'Test pass.', backgroundContext: '', communicationStyle: 'terse',
    knowledgeBase: '', constraints: 'None',
  };
}

function makeSubagent(baseDir: string): Subagent {
  return new Subagent(new MockMartianSummonAdapter(), {
    campaignId: CAMPAIGN_ID, martianType: 'compute',
    inputs: { input: '1 + 1' }, timeoutMs: 5_000, subagentsBaseDir: baseDir,
  });
}

describe('Subagent MEMORY.md semantics', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'alienclaw-mem-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('appendMemory() adds content after initial memory template', () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());

    spec.appendMemory('## Working notes\n\nFirst observation.');

    const memory = readFileSync(path.join(spec.workspaceDir, 'MEMORY.md'), 'utf-8');
    expect(memory).toContain('First observation.');
    expect(memory).toContain(`# Memory — ${CAMPAIGN_ID}`); // header preserved

    spec.erase();
  });

  it('appendMemory() accumulates — multiple calls do not overwrite each other', () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());

    spec.appendMemory('First note.');
    spec.appendMemory('Second note.');
    spec.appendMemory('Third note.');

    const memory = readFileSync(path.join(spec.workspaceDir, 'MEMORY.md'), 'utf-8');
    expect(memory).toContain('First note.');
    expect(memory).toContain('Second note.');
    expect(memory).toContain('Third note.');

    spec.erase();
  });

  it('recordResult() appends a structured summon log entry to MEMORY.md', async () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());
    await spec.execute(); // execute calls recordResult internally

    const memory = readFileSync(path.join(spec.workspaceDir, 'MEMORY.md'), 'utf-8');
    expect(memory).toContain('## Summon 1 — compute');
    expect(memory).toContain('**Summon ID:**');
    expect(memory).toContain('**Fitness:**');
    expect(memory).toContain('**OK:**');

    spec.erase();
  });

  it('recordResult() accumulates multiple summon entries without overwriting', () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());

    const mockResult = { summon_id: 'mock-id', ok: true, fitness: 0.9, output: { result: 2 }, run_metadata: { tool_calls: 1, wall_clock_ms: 10 } };
    spec.recordResult('compute', 'aaa-111', { input: '1+1' }, 'ABC', mockResult);
    spec.recordResult('compute', 'bbb-222', { input: '2+2' }, 'DEF', mockResult);

    const memory = readFileSync(path.join(spec.workspaceDir, 'MEMORY.md'), 'utf-8');
    expect(memory).toContain('## Summon 1 — compute');
    expect(memory).toContain('## Summon 2 — compute');
    expect(memory).toContain('aaa-111'.slice(0, 8));
    expect(memory).toContain('bbb-222'.slice(0, 8));

    spec.erase();
  });

  it('rewriteMemorySection() replaces an existing section', () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());

    spec.appendMemory('\n## Current understanding\n\nInitial understanding.\n');
    spec.rewriteMemorySection('Current understanding', 'Updated understanding after Martian 1.');

    const memory = readFileSync(path.join(spec.workspaceDir, 'MEMORY.md'), 'utf-8');
    expect(memory).toContain('Updated understanding after Martian 1.');
    expect(memory).not.toContain('Initial understanding.');

    spec.erase();
  });

  it('rewriteMemorySection() appends when section does not exist', () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());

    spec.rewriteMemorySection('New section', 'Brand new content.');

    const memory = readFileSync(path.join(spec.workspaceDir, 'MEMORY.md'), 'utf-8');
    expect(memory).toContain('## New section');
    expect(memory).toContain('Brand new content.');

    spec.erase();
  });

  it('MEMORY.md header is always preserved after appends', () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());

    for (let i = 0; i < 5; i++) spec.appendMemory(`Note ${i}`);

    const memory = readFileSync(path.join(spec.workspaceDir, 'MEMORY.md'), 'utf-8');
    expect(memory.startsWith(`# Memory — ${CAMPAIGN_ID}`)).toBe(true);

    spec.erase();
  });

  it('rewriteMemorySection() preserves the following section when target is not at end-of-file', () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());

    // Write two sections: target first, follower second
    spec.appendMemory('## Primary\n\nOriginal primary content.\n');
    spec.appendMemory('## Secondary\n\nSecond section content.\n');

    spec.rewriteMemorySection('Primary', 'Replaced primary content.');

    const memory = readFileSync(path.join(spec.workspaceDir, 'MEMORY.md'), 'utf-8');
    expect(memory).toContain('Replaced primary content.');
    expect(memory).not.toContain('Original primary content.');
    // Following section must be fully preserved
    expect(memory).toContain('## Secondary');
    expect(memory).toContain('Second section content.');

    spec.erase();
  });
});
