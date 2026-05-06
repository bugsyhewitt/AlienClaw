/**
 * Specialist — ephemeral campaign-scoped subagent (Packet 7 + Packet 11).
 *
 * Packet 7: single-Martian campaign wrapper with genome.
 * Packet 11: 5-file on-disk workspace at ~/.alienclaw/specialists/<campaign_id>/.
 *   SOUL.md, CAMPAIGN.md, TOOLS.md  — written at birth, immutable
 *   MEMORY.md                         — initialized at birth, accumulates results
 *   HEARTBEAT.md                      — initialized at birth, updated on state changes
 *
 * File format spec: SPECIALIST_SPEC.md (locked).
 * See docs/specs/SPECIALIST_FILE_FORMAT_v1_1_ADDENDUM.md for implementation notes.
 *
 * Lifecycle: birth(brief) → summonMartian() → recordResult() → finalize() → erase()
 */

import { mkdirSync, writeFileSync, rmSync, renameSync, appendFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MartianSummonAdapter, MartianSummonResult } from './summon-adapter.js';
import { randomGenome } from './random-genome.js';
import { nowIso } from './messages.js';

// ── Public types ────────────────────────────────────────────────────────────

export interface SpecialistBrief {
  campaignId:        string;
  role:              string;
  domain:            string;
  objective:         string;
  scope:             string;
  successCriteria:   string;
  allowedTools:      string[];
  deliverables:      string;
  backgroundContext: string;
  communicationStyle: 'terse' | 'verbose' | 'structured';
  knowledgeBase:     string;
  constraints:       string;
}

export type HeartbeatState = 'RUNNING' | 'STALLED' | 'COMPLETE' | 'FAILED';

export interface SpecialistOptions {
  /** Campaign ID this Specialist belongs to. */
  campaignId:       string;
  /** Martian type to summon (must be in brain registry). */
  martianType:      string;
  /** Inputs forwarded to the Martian. */
  inputs:           Record<string, unknown>;
  /** Timeout in ms. */
  timeoutMs:        number;
  /** Override genome (for deterministic tests). */
  genome?:          string;
  /**
   * When true, the RealMartianSummonAdapter sends kind='summon-from-population'
   * and the Python bridge selects a genome via tournament selection.
   */
  fromPopulation?:  boolean;
  /**
   * Override base directory for workspace (default: ~/.alienclaw/specialists).
   * Used in tests to avoid writing to user home.
   */
  specialistsBaseDir?: string;
}

export interface SpecialistReport {
  specialistId: string;
  campaignId:   string;
  genome:       string;
  martianType:  string;
  result:       MartianSummonResult;
}

// ── Workspace helpers ───────────────────────────────────────────────────────

/** Write file atomically: tmp sibling → rename. */
function atomicWrite(filePath: string, content: string): void {
  const dir     = path.dirname(filePath);
  const tmpPath = path.join(dir, `.tmp-${randomUUID()}`);
  writeFileSync(tmpPath, content, { encoding: 'utf-8' });
  renameSync(tmpPath, filePath);
}

/** Build SOUL.md content from a SpecialistBrief. */
function buildSoulMd(brief: SpecialistBrief): string {
  const tools = brief.allowedTools.map(t => `- ${t}`).join('\n');
  return `# ${brief.campaignId} — ${brief.role}

${brief.objective}

## Core Identity

- **Role:** ${brief.role}
- **Campaign:** ${brief.campaignId}
- **Domain:** ${brief.domain}
- **Communication style:** ${brief.communicationStyle}
- **Created by:** CreatorBot
- **Lifecycle:** Ephemeral — erases when campaign ${brief.campaignId} ends

## Responsibilities

${brief.objective}

## Knowledge base

${brief.knowledgeBase || '(none provided)'}

## Rules

- You NEVER speak to the user directly. Only BossBot does.
- You NEVER speak to AdvisorBot. Your planning is your own.
- You NEVER speak to other Specialists.
- You summon Martians for ALL tool work — no direct tool calls.
- You update HEARTBEAT.md every 5 minutes during active work.
- When your campaign ends, you write a report and wait for BossBot's ack.
- After ack, you erase yourself completely.

## Summoning protocol

Before calling summonMartian():
1. State what specific tool operation you need
2. Confirm the tag is in your TOOLS.md allowlist
3. Construct context with all required variables
4. Evaluate the result — don't pass through blindly
5. If no Martian exists for the work you need: escalate to BossBot

## Fail-forward protocol

If a Martian exhausts its retry budget and returns FAILURE:
- First failure: try an alternative approach if one exists
- Second failure: log in MEMORY.md and continue with available data
- Third failure on same operation: include in campaign report as a gap;
  do not block campaign completion for one failed data point

## Allowed tools

${tools}
`;
}

/** Build CAMPAIGN.md content from a SpecialistBrief. */
function buildCampaignMd(brief: SpecialistBrief): string {
  const tools = brief.allowedTools.map(t => `- ${t}`).join('\n');
  return `# Campaign Brief — ${brief.campaignId}

## Objective

${brief.objective}

## Scope

${brief.scope || '(not specified)'}

## Success criteria

${brief.successCriteria}

## Constraints

${brief.constraints || 'None'}

## Allowed Martian tools

${tools}

## Deliverables

${brief.deliverables || '(not specified)'}

## Background context

${brief.backgroundContext || '(none provided)'}
`;
}

/** Build TOOLS.md content from a SpecialistBrief. */
function buildToolsMd(brief: SpecialistBrief): string {
  const tags     = brief.allowedTools.map(t => `- ${t}`).join('\n');
  const sections = brief.allowedTools
    .map(t => `### ${t}\nIncluded for this campaign.\n`)
    .join('\n');
  return `# Tools — ${brief.campaignId}

The following Martian tool tags are authorised for this campaign.
Do not summon tools not on this list.

## Authorised tags

${tags}

## Rationale

${sections}`;
}

/** Build initial MEMORY.md content. */
function buildInitialMemoryMd(campaignId: string): string {
  return `# Memory — ${campaignId}

<!-- Specialist appends working notes here during the campaign. -->
<!-- This file is DELETED at campaign erase. Do not put anything here -->
<!-- that needs to survive the campaign. Use the campaign report instead. -->

---

<!-- Format: dated entries in chronological order -->
`;
}

/** Build initial HEARTBEAT.md content. */
function buildHeartbeatMd(
  campaignId: string,
  state: HeartbeatState,
  progress: string,
  activities: string[],
  blockers: string,
): string {
  const activityLines = activities.length > 0
    ? activities.map(a => `- ${a}`).join('\n')
    : '- No activity yet';
  return `# Heartbeat — ${campaignId}

## Status

**State:** ${state}
**Last updated:** ${nowIso()}
**Progress:** ${progress}

## Recent activity

${activityLines}

## Blockers

${blockers || 'None'}
`;
}

// ── Specialist class ─────────────────────────────────────────────────────────

export class Specialist {
  readonly specialistId: string;
  readonly genome:       string;
  private _erased = false;
  private readonly _workspaceDir: string;
  private _activities: string[] = [];
  private _summonCount = 0;

  constructor(
    private readonly adapter: MartianSummonAdapter,
    private readonly opts:    SpecialistOptions,
  ) {
    this.specialistId = randomUUID();
    this.genome       = opts.genome ?? randomGenome('SPEC0001');
    const baseDir     = opts.specialistsBaseDir
      ?? path.join(homedir(), '.alienclaw', 'specialists');
    this._workspaceDir = path.join(baseDir, opts.campaignId);
  }

  // ── Workspace: path accessors ─────────────────────────────────────────────

  get workspaceDir(): string { return this._workspaceDir; }

  private _filePath(name: string): string {
    return path.join(this._workspaceDir, name);
  }

  // ── Lifecycle: birth ──────────────────────────────────────────────────────

  /**
   * Create the 5-file workspace. Must be called once before execute().
   * Idempotent: if the workspace already exists, this is a no-op.
   */
  birth(brief: SpecialistBrief): void {
    if (this._erased) throw new Error(`Specialist ${this.specialistId} has been erased`);
    if (existsSync(this._workspaceDir)) return;

    mkdirSync(this._workspaceDir, { recursive: true, mode: 0o700 });

    atomicWrite(this._filePath('SOUL.md'),     buildSoulMd(brief));
    atomicWrite(this._filePath('CAMPAIGN.md'), buildCampaignMd(brief));
    atomicWrite(this._filePath('TOOLS.md'),    buildToolsMd(brief));
    atomicWrite(this._filePath('MEMORY.md'),   buildInitialMemoryMd(brief.campaignId));
    atomicWrite(
      this._filePath('HEARTBEAT.md'),
      buildHeartbeatMd(
        brief.campaignId,
        'RUNNING',
        'Born — awaiting first Martian summon',
        [],
        'None',
      ),
    );
  }

  // ── Lifecycle: update heartbeat ───────────────────────────────────────────

  /**
   * Update HEARTBEAT.md with current state. MEMORY.md is not modified here.
   * HEARTBEAT.md is rewritten entirely on each call (mutable status file per spec).
   */
  updateHeartbeat(state: HeartbeatState, progress: string, activity?: string): void {
    if (activity) {
      this._activities.unshift(activity);
      if (this._activities.length > 10) this._activities.pop();
    }
    if (!existsSync(this._workspaceDir)) return;
    atomicWrite(
      this._filePath('HEARTBEAT.md'),
      buildHeartbeatMd(
        this.opts.campaignId,
        state,
        progress,
        this._activities.slice(0, 3),
        'None',
      ),
    );
  }

  // ── Lifecycle: record result ──────────────────────────────────────────────

  /** Append a Martian summon result to MEMORY.md. */
  recordResult(
    martianType: string,
    summonId: string,
    inputs: Record<string, unknown>,
    genome: string,
    result: MartianSummonResult,
  ): void {
    if (!existsSync(this._workspaceDir)) return;
    this._summonCount++;
    const entry = [
      `## Summon ${this._summonCount} — ${martianType} (${nowIso()})`,
      ``,
      `- **Summon ID:** ${summonId.slice(0, 8)}...`,
      `- **Input:** ${JSON.stringify(inputs).slice(0, 120)}`,
      `- **Genome:** ${genome.slice(0, 16)}...`,
      `- **Fitness:** ${result.fitness.toFixed(4)}`,
      `- **OK:** ${result.ok}`,
      `- **Output:** ${JSON.stringify(result.output ?? {}).slice(0, 120)}`,
      ``,
    ].join('\n');
    appendFileSync(this._filePath('MEMORY.md'), entry, { encoding: 'utf-8' });
  }

  /** Append a free-form note to MEMORY.md (for Specialist working notes). */
  appendMemory(content: string): void {
    if (!existsSync(this._workspaceDir)) return;
    appendFileSync(this._filePath('MEMORY.md'), content + '\n', { encoding: 'utf-8' });
  }

  /** Rewrite a named section in MEMORY.md. Appends if section not found. */
  rewriteMemorySection(sectionTitle: string, newContent: string): void {
    if (!existsSync(this._workspaceDir)) return;
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const current = readFileSync(this._filePath('MEMORY.md'), 'utf-8');
    const marker  = `## ${sectionTitle}`;
    const idx     = current.indexOf(marker);
    if (idx === -1) {
      // Section not found — append
      appendFileSync(
        this._filePath('MEMORY.md'),
        `\n${marker}\n\n${newContent}\n`,
        { encoding: 'utf-8' },
      );
      return;
    }
    // Find the next ## heading or end of file after this section
    const afterMarker = idx + marker.length;
    const nextSection = current.indexOf('\n## ', afterMarker);
    const end         = nextSection === -1 ? current.length : nextSection;
    const updated     = current.slice(0, idx) + marker + '\n\n' + newContent + '\n' + current.slice(end);
    atomicWrite(this._filePath('MEMORY.md'), updated);
  }

  // ── Lifecycle: finalize ───────────────────────────────────────────────────

  /** Mark campaign as complete or failed in HEARTBEAT.md. */
  finalize(status: 'COMPLETE' | 'FAILED', summary: string): void {
    this.updateHeartbeat(status, summary, `Campaign ${status.toLowerCase()}`);
  }

  // ── Lifecycle: execute (Packet 7 compat shim) ─────────────────────────────

  /** Execute the Martian summon and return a report. Packet 7 single-shot shim. */
  async execute(): Promise<SpecialistReport> {
    if (this._erased) throw new Error(`Specialist ${this.specialistId} has been erased`);

    this.updateHeartbeat('RUNNING', `Summoning ${this.opts.martianType}`, `Issued summon for ${this.opts.martianType}`);

    const result = await this.adapter.summon({
      summon_id:      this.specialistId,
      genome:         this.genome,
      martian_type:   this.opts.martianType,
      inputs:         this.opts.inputs,
      timeout_ms:     this.opts.timeoutMs,
      fromPopulation: this.opts.fromPopulation,
    });

    this.recordResult(
      this.opts.martianType,
      this.specialistId,
      this.opts.inputs,
      this.genome,
      result,
    );
    this.updateHeartbeat('RUNNING', `${this.opts.martianType} complete (fitness=${result.fitness.toFixed(2)})`, `Received result from ${this.opts.martianType}`);

    return {
      specialistId: this.specialistId,
      campaignId:   this.opts.campaignId,
      genome:       this.genome,
      martianType:  this.opts.martianType,
      result,
    };
  }

  // ── Lifecycle: erase ──────────────────────────────────────────────────────

  /**
   * Erase the Specialist: update heartbeat to signal erasure, then delete workspace.
   * The ~/ .alienclaw/reports/<campaign_id>.md report is NOT deleted (belongs to BossBot).
   */
  erase(): void {
    if (this._erased) return;
    this._erased = true;
    // Update heartbeat one last time before deletion (best-effort)
    try {
      this.updateHeartbeat('COMPLETE', 'Erased', 'Erasing workspace');
    } catch { /* ignore if workspace already gone */ }
    // Delete workspace directory
    if (existsSync(this._workspaceDir)) {
      rmSync(this._workspaceDir, { recursive: true, force: true });
    }
  }

  get isErased(): boolean { return this._erased; }
}
