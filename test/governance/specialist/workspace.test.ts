/**
 * test_workspace.ts — Verifies 5-file workspace creation, content, and cleanup.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Specialist } from '../../../src/alienclaw/governance/specialist.js';
import { MockMartianSummonAdapter } from '../../../src/alienclaw/governance/summon-adapter.js';
import type { SpecialistBrief } from '../../../src/alienclaw/governance/specialist.js';

const CAMPAIGN_ID = 'CAMP_TEST01';

function makeBrief(overrides: Partial<SpecialistBrief> = {}): SpecialistBrief {
  return {
    campaignId:        CAMPAIGN_ID,
    role:              'Test Specialist',
    domain:            'compute',
    objective:         'Compute 7 / 3 and return the result.',
    scope:             'Only arithmetic. No file I/O.',
    successCriteria:   'Fitness >= 0.5',
    allowedTools:      ['compute'],
    deliverables:      'Fitness score and result value.',
    backgroundContext: 'Unit test context.',
    communicationStyle: 'structured',
    knowledgeBase:     'Basic arithmetic.',
    constraints:       'None',
    ...overrides,
  };
}

function makeSpecialist(baseDir: string): Specialist {
  return new Specialist(new MockMartianSummonAdapter(), {
    campaignId:          CAMPAIGN_ID,
    martianType:         'compute',
    inputs:              { input: '7 / 3' },
    timeoutMs:           5_000,
    specialistsBaseDir:  baseDir,
  });
}

describe('Specialist 5-file workspace', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'alienclaw-spec-'));
  });

  afterEach(() => {
    // Guarantee cleanup even if test fails
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('creates workspace dir with exactly 5 files at birth', () => {
    const spec = makeSpecialist(baseDir);
    spec.birth(makeBrief());

    const workspaceDir = spec.workspaceDir;
    expect(existsSync(workspaceDir)).toBe(true);

    const files = readdirSync(workspaceDir).sort();
    expect(files).toEqual(['CAMPAIGN.md', 'HEARTBEAT.md', 'MEMORY.md', 'SOUL.md', 'TOOLS.md']);

    spec.erase();
  });

  it('SOUL.md contains campaign_id, role, and all 5 communication rules', () => {
    const spec  = makeSpecialist(baseDir);
    const brief = makeBrief();
    spec.birth(brief);

    const soul = readFileSync(path.join(spec.workspaceDir, 'SOUL.md'), 'utf-8');

    expect(soul).toContain(CAMPAIGN_ID);
    expect(soul).toContain('Test Specialist');
    expect(soul).toContain('You NEVER speak to the user directly');
    expect(soul).toContain('You NEVER speak to AdvisorBot');
    expect(soul).toContain('You NEVER speak to other Specialists');
    expect(soul).toContain('You summon Martians for ALL tool work');
    expect(soul).toContain('You update HEARTBEAT.md every 5 minutes');

    spec.erase();
  });

  it('CAMPAIGN.md contains objective, success criteria, and allowed tools', () => {
    const spec  = makeSpecialist(baseDir);
    const brief = makeBrief();
    spec.birth(brief);

    const campaign = readFileSync(path.join(spec.workspaceDir, 'CAMPAIGN.md'), 'utf-8');

    expect(campaign).toContain(CAMPAIGN_ID);
    expect(campaign).toContain('Compute 7 / 3');
    expect(campaign).toContain('Fitness >= 0.5');
    expect(campaign).toContain('compute');

    spec.erase();
  });

  it('TOOLS.md contains authorised tags and rationale section', () => {
    const spec  = makeSpecialist(baseDir);
    const brief = makeBrief({ allowedTools: ['compute', 'file_read'] });
    spec.birth(brief);

    const tools = readFileSync(path.join(spec.workspaceDir, 'TOOLS.md'), 'utf-8');

    expect(tools).toContain(CAMPAIGN_ID);
    expect(tools).toContain('Authorised tags');
    expect(tools).toContain('- compute');
    expect(tools).toContain('- file_read');
    expect(tools).toContain('Rationale');

    spec.erase();
  });

  it('MEMORY.md initializes with campaign_id header and empty marker', () => {
    const spec = makeSpecialist(baseDir);
    spec.birth(makeBrief());

    const memory = readFileSync(path.join(spec.workspaceDir, 'MEMORY.md'), 'utf-8');

    expect(memory).toContain(`# Memory — ${CAMPAIGN_ID}`);
    expect(memory).toContain('DELETED at campaign erase');

    spec.erase();
  });

  it('HEARTBEAT.md initializes with RUNNING state and born progress', () => {
    const spec = makeSpecialist(baseDir);
    spec.birth(makeBrief());

    const hb = readFileSync(path.join(spec.workspaceDir, 'HEARTBEAT.md'), 'utf-8');

    expect(hb).toContain(`# Heartbeat — ${CAMPAIGN_ID}`);
    expect(hb).toContain('**State:** RUNNING');
    expect(hb).toContain('Born — awaiting first Martian summon');

    spec.erase();
  });

  it('erase() deletes the entire workspace directory', () => {
    const spec = makeSpecialist(baseDir);
    spec.birth(makeBrief());

    const workspaceDir = spec.workspaceDir;
    expect(existsSync(workspaceDir)).toBe(true);

    spec.erase();

    expect(existsSync(workspaceDir)).toBe(false);
  });

  it('erase() is idempotent — calling twice does not throw', () => {
    const spec = makeSpecialist(baseDir);
    spec.birth(makeBrief());
    spec.erase();
    expect(() => spec.erase()).not.toThrow();
  });

  it('isErased is true after erase()', () => {
    const spec = makeSpecialist(baseDir);
    spec.birth(makeBrief());
    expect(spec.isErased).toBe(false);
    spec.erase();
    expect(spec.isErased).toBe(true);
  });

  it('birth() is idempotent — calling twice does not throw or duplicate files', () => {
    const spec  = makeSpecialist(baseDir);
    const brief = makeBrief();
    spec.birth(brief);
    spec.birth(brief); // second call is no-op

    const files = readdirSync(spec.workspaceDir).sort();
    expect(files).toEqual(['CAMPAIGN.md', 'HEARTBEAT.md', 'MEMORY.md', 'SOUL.md', 'TOOLS.md']);

    spec.erase();
  });

  it('no workspace files left after execute() + erase() via real flow', async () => {
    const spec = makeSpecialist(baseDir);
    spec.birth(makeBrief());
    await spec.execute();
    spec.finalize('COMPLETE', 'Test done.');
    spec.erase();

    expect(existsSync(spec.workspaceDir)).toBe(false);
  });
});
