/**
 * test_workspace.ts — Verifies 5-file workspace creation, content, and cleanup.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Subagent } from '../../../src/alienclaw/governance/common/subagent.js';
import { MockMartianSummonAdapter } from '../../../src/alienclaw/governance/common/summon-adapter.js';
import type { SubagentBrief } from '../../../src/alienclaw/governance/common/subagent.js';

const CAMPAIGN_ID = 'CAMP_TEST01';

function makeBrief(overrides: Partial<SubagentBrief> = {}): SubagentBrief {
  return {
    campaignId:        CAMPAIGN_ID,
    role:              'Test Subagent',
    domain:            'compute',
    objective:         'Compute 7 / 3 and return the result.',
    scope:             'Only arithmetic. No file I/O.',
    successCriteria:   'Fitness >= 0.5',
    allowedMartians:   ['compute'],
    deliverables:      'Fitness score and result value.',
    backgroundContext: 'Unit test context.',
    communicationStyle: 'structured',
    knowledgeBase:     'Basic arithmetic.',
    constraints:       'None',
    ...overrides,
  };
}

function makeSubagent(baseDir: string): Subagent {
  return new Subagent(new MockMartianSummonAdapter(), {
    campaignId:        CAMPAIGN_ID,
    martianType:       'compute',
    inputs:            { input: '7 / 3' },
    timeoutMs:         5_000,
    subagentsBaseDir:  baseDir,
  });
}

describe('Subagent 5-file workspace', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'alienclaw-spec-'));
  });

  afterEach(() => {
    // Guarantee cleanup even if test fails
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('creates workspace dir with exactly 5 files at birth', () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());

    const workspaceDir = spec.workspaceDir;
    expect(existsSync(workspaceDir)).toBe(true);

    const files = readdirSync(workspaceDir).sort();
    expect(files).toEqual(['CAMPAIGN.md', 'HEARTBEAT.md', 'MARTIANS.md', 'MEMORY.md', 'SOUL.md']);

    spec.erase();
  });

  it('SOUL.md contains campaign_id, role, and all 5 communication rules', () => {
    const spec  = makeSubagent(baseDir);
    const brief = makeBrief();
    spec.birth(brief);

    const soul = readFileSync(path.join(spec.workspaceDir, 'SOUL.md'), 'utf-8');

    expect(soul).toContain(CAMPAIGN_ID);
    expect(soul).toContain('Test Subagent');
    expect(soul).toContain('You NEVER speak to the user directly');
    expect(soul).toContain('You NEVER speak to AdvisorBot');
    expect(soul).toContain('You NEVER speak to other Subagents');
    expect(soul).toContain('You summon Martians for ALL tool work');
    expect(soul).toContain('You update HEARTBEAT.md every 5 minutes');

    spec.erase();
  });

  it('CAMPAIGN.md contains objective, success criteria, and allowed Martian types', () => {
    const spec  = makeSubagent(baseDir);
    const brief = makeBrief();
    spec.birth(brief);

    const campaign = readFileSync(path.join(spec.workspaceDir, 'CAMPAIGN.md'), 'utf-8');

    expect(campaign).toContain(CAMPAIGN_ID);
    expect(campaign).toContain('Compute 7 / 3');
    expect(campaign).toContain('Fitness >= 0.5');
    expect(campaign).toContain('compute');

    spec.erase();
  });

  it('MARTIANS.md contains authorised tags and rationale section', () => {
    const spec  = makeSubagent(baseDir);
    const brief = makeBrief({ allowedMartians: ['compute', 'file_read'] });
    spec.birth(brief);

    const martians = readFileSync(path.join(spec.workspaceDir, 'MARTIANS.md'), 'utf-8');

    expect(martians).toContain(CAMPAIGN_ID);
    expect(martians).toContain('Authorised tags');
    expect(martians).toContain('- compute');
    expect(martians).toContain('- file_read');
    expect(martians).toContain('Rationale');

    spec.erase();
  });

  it('MEMORY.md initializes with campaign_id header and empty marker', () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());

    const memory = readFileSync(path.join(spec.workspaceDir, 'MEMORY.md'), 'utf-8');

    expect(memory).toContain(`# Memory — ${CAMPAIGN_ID}`);
    expect(memory).toContain('DELETED at campaign erase');

    spec.erase();
  });

  it('HEARTBEAT.md initializes with a "born" JSONL event (v1.4)', () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());

    const hb = readFileSync(path.join(spec.workspaceDir, 'HEARTBEAT.md'), 'utf-8');
    const lines = hb.split('\n').filter(l => l.trim().length > 0);
    expect(lines.length).toBeGreaterThan(0);
    const first = JSON.parse(lines[0]!);
    expect(first.event).toBe('born');
    expect(first.data.campaign_id).toBe(CAMPAIGN_ID);

    spec.erase();
  });

  it('erase() deletes the entire workspace directory', () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());

    const workspaceDir = spec.workspaceDir;
    expect(existsSync(workspaceDir)).toBe(true);

    spec.erase();

    expect(existsSync(workspaceDir)).toBe(false);
  });

  it('erase() is idempotent — calling twice does not throw', () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());
    spec.erase();
    expect(() => spec.erase()).not.toThrow();
  });

  it('isErased is true after erase()', () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());
    expect(spec.isErased).toBe(false);
    spec.erase();
    expect(spec.isErased).toBe(true);
  });

  it('birth() is idempotent — calling twice does not throw or duplicate files', () => {
    const spec  = makeSubagent(baseDir);
    const brief = makeBrief();
    spec.birth(brief);
    spec.birth(brief); // second call is no-op

    const files = readdirSync(spec.workspaceDir).sort();
    expect(files).toEqual(['CAMPAIGN.md', 'HEARTBEAT.md', 'MARTIANS.md', 'MEMORY.md', 'SOUL.md']);

    spec.erase();
  });

  it('no workspace files left after execute() + erase() via real flow', async () => {
    const spec = makeSubagent(baseDir);
    spec.birth(makeBrief());
    await spec.execute();
    spec.finalize('COMPLETE', 'Test done.');
    spec.erase();

    expect(existsSync(spec.workspaceDir)).toBe(false);
  });
});
