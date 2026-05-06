/**
 * test_heartbeat.ts — Verifies HEARTBEAT.md structure and update semantics.
 *
 * HEARTBEAT.md follows SPECIALIST_SPEC.md (locked): markdown status file
 * with State/Last-updated/Progress/Recent-activity/Blockers sections.
 * It is REWRITTEN (not appended to) on each updateHeartbeat() call.
 * Activities accumulate — Recent activity section grows with each update.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Specialist } from '../../../src/alienclaw/governance/specialist.js';
import { MockMartianSummonAdapter } from '../../../src/alienclaw/governance/summon-adapter.js';
import type { SpecialistBrief, HeartbeatState } from '../../../src/alienclaw/governance/specialist.js';

const CAMPAIGN_ID = 'CAMP_HBTEST';

function makeBrief(): SpecialistBrief {
  return {
    campaignId: CAMPAIGN_ID, role: 'HB Test Specialist', domain: 'compute',
    objective: 'Test heartbeat semantics.', scope: 'Unit test.',
    successCriteria: 'Heartbeat correctly maintained.', allowedTools: ['compute'],
    deliverables: 'Test pass.', backgroundContext: '', communicationStyle: 'terse',
    knowledgeBase: '', constraints: 'None',
  };
}

function makeSpecialist(baseDir: string): Specialist {
  return new Specialist(new MockMartianSummonAdapter(), {
    campaignId: CAMPAIGN_ID, martianType: 'compute',
    inputs: {}, timeoutMs: 5_000, specialistsBaseDir: baseDir,
  });
}

describe('Specialist HEARTBEAT.md semantics', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'alienclaw-hb-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('HEARTBEAT.md has correct markdown sections at birth', () => {
    const spec = makeSpecialist(baseDir);
    spec.birth(makeBrief());

    const hb = readFileSync(path.join(spec.workspaceDir, 'HEARTBEAT.md'), 'utf-8');
    expect(hb).toContain(`# Heartbeat — ${CAMPAIGN_ID}`);
    expect(hb).toContain('## Status');
    expect(hb).toContain('**State:**');
    expect(hb).toContain('**Last updated:**');
    expect(hb).toContain('**Progress:**');
    expect(hb).toContain('## Recent activity');
    expect(hb).toContain('## Blockers');

    spec.erase();
  });

  it('initial State is RUNNING', () => {
    const spec = makeSpecialist(baseDir);
    spec.birth(makeBrief());

    const hb = readFileSync(path.join(spec.workspaceDir, 'HEARTBEAT.md'), 'utf-8');
    expect(hb).toContain('**State:** RUNNING');

    spec.erase();
  });

  it('updateHeartbeat() changes the State field', () => {
    const spec = makeSpecialist(baseDir);
    spec.birth(makeBrief());

    spec.updateHeartbeat('STALLED', 'Waiting for external resource');
    const hb = readFileSync(path.join(spec.workspaceDir, 'HEARTBEAT.md'), 'utf-8');
    expect(hb).toContain('**State:** STALLED');
    expect(hb).toContain('Waiting for external resource');

    spec.erase();
  });

  it('activities accumulate across multiple updateHeartbeat() calls', () => {
    const spec = makeSpecialist(baseDir);
    spec.birth(makeBrief());

    spec.updateHeartbeat('RUNNING', 'Step 1', 'Activity A');
    spec.updateHeartbeat('RUNNING', 'Step 2', 'Activity B');
    spec.updateHeartbeat('RUNNING', 'Step 3', 'Activity C');

    const hb = readFileSync(path.join(spec.workspaceDir, 'HEARTBEAT.md'), 'utf-8');
    // All 3 activities should be present (most recent first)
    expect(hb).toContain('Activity A');
    expect(hb).toContain('Activity B');
    expect(hb).toContain('Activity C');

    spec.erase();
  });

  it('finalize(COMPLETE) sets State to COMPLETE', () => {
    const spec = makeSpecialist(baseDir);
    spec.birth(makeBrief());
    spec.finalize('COMPLETE', 'All tasks done.');

    const hb = readFileSync(path.join(spec.workspaceDir, 'HEARTBEAT.md'), 'utf-8');
    expect(hb).toContain('**State:** COMPLETE');
    expect(hb).toContain('All tasks done.');

    spec.erase();
  });

  it('finalize(FAILED) sets State to FAILED', () => {
    const spec = makeSpecialist(baseDir);
    spec.birth(makeBrief());
    spec.finalize('FAILED', 'Martian unavailable.');

    const hb = readFileSync(path.join(spec.workspaceDir, 'HEARTBEAT.md'), 'utf-8');
    expect(hb).toContain('**State:** FAILED');
    expect(hb).toContain('Martian unavailable.');

    spec.erase();
  });

  it('updateHeartbeat() with no activity does not add empty entries', () => {
    const spec = makeSpecialist(baseDir);
    spec.birth(makeBrief());
    spec.updateHeartbeat('RUNNING', 'No-op update'); // no activity arg

    const hb = readFileSync(path.join(spec.workspaceDir, 'HEARTBEAT.md'), 'utf-8');
    // Should not contain blank activity bullets
    expect(hb).not.toMatch(/^- $/m);

    spec.erase();
  });

  it('execute() updates heartbeat state through summon cycle', async () => {
    const spec = makeSpecialist(baseDir);
    spec.birth(makeBrief());
    await spec.execute();

    const hb = readFileSync(path.join(spec.workspaceDir, 'HEARTBEAT.md'), 'utf-8');
    // After execute, state should reflect summon completed
    expect(hb).toContain('RUNNING');
    expect(hb).toContain('compute');

    spec.erase();
  });

  it('every state string is valid HeartbeatState', () => {
    const validStates: HeartbeatState[] = ['RUNNING', 'STALLED', 'COMPLETE', 'FAILED'];
    const spec = makeSpecialist(baseDir);
    spec.birth(makeBrief());

    for (const state of validStates) {
      spec.updateHeartbeat(state, `Testing ${state}`);
      const hb = readFileSync(path.join(spec.workspaceDir, 'HEARTBEAT.md'), 'utf-8');
      expect(hb).toContain(`**State:** ${state}`);
    }

    spec.erase();
  });
});
