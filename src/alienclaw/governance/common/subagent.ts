/**
 * Subagent — ephemeral campaign-scoped subagent (Packets 7, 11, 17, 18).
 *
 * Packet 7:  single-Martian campaign wrapper with genome.
 * Packet 11: 5-file on-disk workspace at ~/.alienclaw/subagents/<campaign_id>/.
 * Packet 17: explicit lifecycle methods.
 * Packet 18: multi-Martian campaign loop with transition tables, budgets,
 *            and JSONL HEARTBEAT.md (replaces v1.3 markdown rewrite).
 *
 * File format spec: docs/specs/SUBAGENT_FILE_FORMAT_v1_4_ADDENDUM.md.
 *
 * Lifecycle: birth(brief) → execute() | runCampaign() → erase()
 */

import { mkdirSync, rmSync, appendFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MartianSummonAdapter, MartianSummonResult } from './summon-adapter.js';
import { randomGenome } from './random-genome.js';
import { nowIso } from './messages.js';
import { atomicWrite } from '../../utils.js';

import {
  decide,
  type SummonResult,
} from './subagent/decision_engine.js';
import {
  parseTransitionTable,
  evaluateInputs,
} from './subagent/transition_table.js';
import {
  BudgetTracker,
  DEFAULT_BUDGETS,
  type BudgetLimits,
  type TerminationReason,
} from './subagent/budget.js';
import {
  aggregate,
  type SummonRecord,
} from './subagent/fitness_aggregator.js';

// ── Public types ────────────────────────────────────────────────────────────

export interface SubagentBrief {
  campaignId:        string;
  role:              string;
  domain:            string;
  objective:         string;
  scope:             string;
  successCriteria:   string;
  allowedMartians:   string[];
  deliverables:      string;
  backgroundContext: string;
  communicationStyle: 'terse' | 'verbose' | 'structured';
  knowledgeBase:     string;
  constraints:       string;
  /** Optional per-campaign budget overrides (Packet 18). */
  budgetOverrides?:  Partial<BudgetLimits>;
}

/**
 * Build a SubagentBrief from the fields that vary per call site, supplying
 * the boilerplate every site used to repeat (scope/successCriteria mirror
 * the objective, structured communication, no constraints). Any default can
 * be overridden by passing the field explicitly.
 */
export function makeSubagentBrief(
  brief: Pick<SubagentBrief, 'campaignId' | 'role' | 'domain' | 'objective' | 'allowedMartians'>
    & Partial<SubagentBrief>,
): SubagentBrief {
  return {
    scope:              brief.objective,
    successCriteria:    brief.objective,
    deliverables:       'Sub-goal result.',
    backgroundContext:  '',
    communicationStyle: 'structured',
    knowledgeBase:      '',
    constraints:        'None',
    ...brief,
  };
}

export type HeartbeatState = 'RUNNING' | 'STALLED' | 'COMPLETE' | 'FAILED';

export interface SubagentOptions {
  campaignId:       string;
  martianType:      string;
  inputs:           Record<string, unknown>;
  timeoutMs:        number;
  genome?:          string;
  fromPopulation?:  boolean;
  subagentsBaseDir?: string;
  /** Optional clock override for budget testing. */
  clock?:           () => Date;
  /** Optional budget overrides (defaults from DEFAULT_BUDGETS). */
  budgetOverrides?: Partial<BudgetLimits>;
}

export interface SubagentReport {
  subagentId:   string;
  campaignId:   string;
  genome:       string;
  martianType:  string;
  result:       MartianSummonResult;
}

export interface CampaignResult {
  subagentId: string;
  campaignId: string;
  fitness: number;
  termination_reason: TerminationReason;
  summon_count: number;
  final_output: Record<string, unknown> | null;
  error?: string;
}

// ── Workspace helpers ───────────────────────────────────────────────────────

/** Build SOUL.md content from a SubagentBrief. */
function buildSoulMd(brief: SubagentBrief): string {
  const tools = brief.allowedMartians.map(t => `- ${t}`).join('\n');
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
- You NEVER speak to other Subagents.
- You summon Martians for ALL tool work — no direct tool calls.
- You update HEARTBEAT.md every 5 minutes during active work.
- When your campaign ends, you write a report and wait for BossBot's ack.
- After ack, you erase yourself completely.

## Summoning protocol

Before calling summonMartian():
1. State what specific Martian type you need
2. Confirm the type is in your MARTIANS.md allowlist
3. Construct context with all required variables
4. Evaluate the result — don't pass through blindly
5. If no Martian exists for the work you need: escalate to BossBot

## Fail-forward protocol

If a Martian exhausts its retry budget and returns FAILURE:
- First failure: try an alternative approach if one exists
- Second failure: log in MEMORY.md and continue with available data
- Third failure on same operation: include in campaign report as a gap;
  do not block campaign completion for one failed data point

## Allowed Martian types

${tools}
`;
}

/** Build CAMPAIGN.md content from a SubagentBrief. */
function buildCampaignMd(brief: SubagentBrief, transitionTableYaml?: string): string {
  const tools = brief.allowedMartians.map(t => `- ${t}`).join('\n');
  const ttBlock = transitionTableYaml
    ? `\n## Transition table\n\n\`\`\`yaml\n${transitionTableYaml}\`\`\`\n`
    : '';
  return `# Campaign Brief — ${brief.campaignId}

## Objective

${brief.objective}

## Scope

${brief.scope || '(not specified)'}

## Success criteria

${brief.successCriteria}

## Constraints

${brief.constraints || 'None'}

## Allowed Martian types

${tools}

## Deliverables

${brief.deliverables || '(not specified)'}

## Background context

${brief.backgroundContext || '(none provided)'}
${ttBlock}`;
}

/** Build MARTIANS.md content from a SubagentBrief. */
function buildMartiansMd(brief: SubagentBrief): string {
  const tags     = brief.allowedMartians.map(t => `- ${t}`).join('\n');
  const sections = brief.allowedMartians
    .map(t => `### ${t}\nIncluded for this campaign.\n`)
    .join('\n');
  return `# Martians — ${brief.campaignId}

The following Martian types are authorised for this campaign.
Do not summon Martians not on this list.

## Authorised tags

${tags}

## Rationale

${sections}`;
}

/** Build initial MEMORY.md content. */
function buildInitialMemoryMd(campaignId: string): string {
  return `# Memory — ${campaignId}

<!-- Subagent appends working notes here during the campaign. -->
<!-- This file is DELETED at campaign erase. Do not put anything here -->
<!-- that needs to survive the campaign. Use the campaign report instead. -->

---

<!-- Format: dated entries in chronological order -->
`;
}

// ── Subagent class ──────────────────────────────────────────────────────────

export class Subagent {
  readonly subagentId:   string;
  readonly genome:       string;
  private _erased = false;
  private readonly _workspaceDir: string;
  private _summonCount = 0;
  /** Pending transition-table YAML, if provided to birth(). */
  private _pendingTransitionTableYaml?: string;

  constructor(
    private readonly adapter: MartianSummonAdapter,
    private readonly opts:    SubagentOptions,
  ) {
    this.subagentId   = randomUUID();
    this.genome       = opts.genome ?? randomGenome('SPEC0001');
    const baseDir     = opts.subagentsBaseDir
      ?? path.join(homedir(), '.alienclaw', 'subagents');
    this._workspaceDir = path.join(baseDir, opts.campaignId);
  }

  // ── Workspace: path accessors ─────────────────────────────────────────────

  get workspaceDir(): string { return this._workspaceDir; }

  private _filePath(name: string): string {
    return path.join(this._workspaceDir, name);
  }

  // ── Lifecycle: birth ──────────────────────────────────────────────────────

  /**
   * Create the 5-file workspace.
   *
   * Optional second argument allows the caller (e.g. CreatorBot) to embed a
   * transition_table YAML block into CAMPAIGN.md. If omitted, CAMPAIGN.md is
   * written without a transition_table section (single-shot legacy mode).
   */
  birth(brief: SubagentBrief, transitionTableYaml?: string): void {
    if (this._erased) throw new Error(`Subagent ${this.subagentId} has been erased`);
    if (existsSync(this._workspaceDir)) return;

    this._pendingTransitionTableYaml = transitionTableYaml;

    mkdirSync(this._workspaceDir, { recursive: true, mode: 0o700 });

    atomicWrite(this._filePath('SOUL.md'),     buildSoulMd(brief));
    atomicWrite(this._filePath('CAMPAIGN.md'), buildCampaignMd(brief, transitionTableYaml));
    atomicWrite(this._filePath('MARTIANS.md'), buildMartiansMd(brief));
    atomicWrite(this._filePath('MEMORY.md'),   buildInitialMemoryMd(brief.campaignId));

    // HEARTBEAT.md is JSONL append-only (v1.4)
    atomicWrite(this._filePath('HEARTBEAT.md'), '');
    this.appendHeartbeat('born', {
      campaign_id: brief.campaignId,
      subagent_id: this.subagentId,
    });
  }

  // ── Lifecycle: heartbeat ──────────────────────────────────────────────────

  /** Append one event line to HEARTBEAT.md (JSONL format, v1.4). */
  appendHeartbeat(event: string, data: Record<string, unknown> = {}): void {
    if (!existsSync(this._workspaceDir)) return;
    const line = JSON.stringify({ ts: nowIso(), event, data }) + '\n';
    appendFileSync(this._filePath('HEARTBEAT.md'), line, { encoding: 'utf-8' });
  }

  /**
   * Backward-compatible heartbeat shim — emits a JSONL "heartbeat" event with
   * state/progress/activity payload. Existing callers (execute(), finalize())
   * keep working.
   */
  updateHeartbeat(state: HeartbeatState, progress: string, activity?: string): void {
    this.appendHeartbeat('heartbeat', {
      state,
      progress,
      ...(activity ? { activity } : {}),
    });
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

  /** Append a free-form note to MEMORY.md. */
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
      appendFileSync(
        this._filePath('MEMORY.md'),
        `\n${marker}\n\n${newContent}\n`,
        { encoding: 'utf-8' },
      );
      return;
    }
    const afterMarker = idx + marker.length;
    const nextSection = current.indexOf('\n## ', afterMarker);
    const end         = nextSection === -1 ? current.length : nextSection;
    const updated     = current.slice(0, idx) + marker + '\n\n' + newContent + '\n' + current.slice(end);
    atomicWrite(this._filePath('MEMORY.md'), updated);
  }

  // ── Lifecycle: finalize ───────────────────────────────────────────────────

  /** Mark campaign as complete or failed in HEARTBEAT.md. */
  finalize(status: 'COMPLETE' | 'FAILED', summary: string): void {
    this.appendHeartbeat('heartbeat', {
      state: status,
      progress: summary,
      activity: `Campaign ${status.toLowerCase()}`,
    });
  }

  // ── Lifecycle: execute (Packet 7 single-shot shim) ────────────────────────

  /** Execute one Martian summon and return a report. */
  async execute(): Promise<SubagentReport> {
    if (this._erased) throw new Error(`Subagent ${this.subagentId} has been erased`);

    this.appendHeartbeat('summon-issued', {
      martian_type: this.opts.martianType,
      summon_id: this.subagentId,
    });

    const result = await this.adapter.summon({
      summon_id:      this.subagentId,
      genome:         this.genome,
      martian_type:   this.opts.martianType,
      inputs:         this.opts.inputs,
      timeout_ms:     this.opts.timeoutMs,
      fromPopulation: this.opts.fromPopulation,
    });

    this.recordResult(
      this.opts.martianType,
      this.subagentId,
      this.opts.inputs,
      this.genome,
      result,
    );
    this.appendHeartbeat('summon-result', {
      martian_type: this.opts.martianType,
      ok: result.ok,
      fitness: result.fitness,
      tool_calls: result.run_metadata.tool_calls,
    });

    return {
      subagentId:   this.subagentId,
      campaignId:   this.opts.campaignId,
      genome:       this.genome,
      martianType:  this.opts.martianType,
      result,
    };
  }

  // ── Lifecycle: runCampaign (Packet 18 multi-Martian loop) ─────────────────

  /**
   * Run a multi-Martian campaign driven by a transition table.
   *
   * The transition table is sourced from (in order):
   * 1. `transitionTableYaml` argument
   * 2. The pending YAML provided to `birth()`
   * 3. Whatever is embedded in the on-disk CAMPAIGN.md
   */
  async runCampaign(
    brief: SubagentBrief,
    campaignInputs: Record<string, unknown>,
    transitionTableYaml?: string,
  ): Promise<CampaignResult> {
    if (this._erased) throw new Error(`Subagent ${this.subagentId} has been erased`);

    const yamlSource =
      transitionTableYaml
      ?? this._pendingTransitionTableYaml
      ?? buildCampaignMd(brief);

    const parseResult = parseTransitionTable(yamlSource);
    if (!parseResult.ok || !parseResult.table) {
      const reason: TerminationReason = 'decision_rule_error';
      this.appendHeartbeat('finalized', { reason, error: parseResult.error });
      return {
        subagentId:         this.subagentId,
        campaignId:         this.opts.campaignId,
        fitness:            0,
        termination_reason: reason,
        summon_count:       0,
        final_output:       null,
        error:              parseResult.error,
      };
    }
    const table = parseResult.table;

    const limits: BudgetLimits = {
      ...DEFAULT_BUDGETS,
      ...(brief.budgetOverrides ?? {}),
      ...(this.opts.budgetOverrides ?? {}),
    };
    const clock = this.opts.clock;
    const budget = clock
      ? new BudgetTracker(limits, clock(), clock)
      : new BudgetTracker(limits, new Date());

    const summons: SummonRecord[] = [];
    let currentState = table.initial_state;
    let lastResult: SummonResult | null = null;
    let termReason: TerminationReason = 'state_machine_finalized';
    let failError: string | undefined;

    loop: while (true) {
      const budgetExhausted = budget.checkPreSummon(currentState);
      if (budgetExhausted !== null) {
        termReason = budgetExhausted;
        this.appendHeartbeat('budget-exhausted', {
          reason: budgetExhausted,
          state: currentState,
        });
        break loop;
      }

      const action = decide({
        current_state: currentState,
        last_result:   lastResult,
        table,
        history: summons.map(s => ({
          state: s.state,
          result: {
            martian_type: s.martian_type,
            output:       {},
            correctness:  s.fitness,
            fitness:      s.fitness,
            tool_calls:   s.tool_calls,
            error:        s.ok ? null : 'failed',
          },
        })),
      });

      switch (action.kind) {
        case 'Finalize':
          termReason = 'state_machine_finalized';
          this.appendHeartbeat('state-transition', {
            from: currentState,
            to: 'FINALIZE',
          });
          break loop;

        case 'Fail':
          termReason = 'state_machine_failed';
          failError = action.reason;
          this.appendHeartbeat('state-transition', {
            from: currentState,
            to: `FAIL:${action.reason}`,
          });
          break loop;

        case 'Summon':
        case 'Retry': {
          const stateForSummon =
            action.kind === 'Summon' ? action.target_state : currentState;
          const stateDef = table.states[stateForSummon];
          if (!stateDef) {
            termReason = 'state_machine_failed';
            failError = `state_not_found:${stateForSummon}`;
            this.appendHeartbeat('state-transition', {
              from: currentState,
              to: `FAIL:${failError}`,
            });
            break loop;
          }

          const martianType = stateDef.martian_type;
          const rawInputs = stateDef.inputs;
          const resolvedInputs = evaluateInputs(
            rawInputs,
            campaignInputs,
            lastResult ? { output: lastResult.output } : null,
          );

          if (action.kind === 'Summon' && stateForSummon !== currentState) {
            this.appendHeartbeat('state-transition', {
              from: currentState,
              to: stateForSummon,
            });
            currentState = stateForSummon;
          }

          this.appendHeartbeat('summon-issued', {
            martian_type: martianType,
            state: currentState,
          });
          budget.recordSummon(currentState);

          const summonId = randomUUID();
          const adapterResult = await this.adapter.summon({
            summon_id:      summonId,
            genome:         this.genome,
            martian_type:   martianType,
            inputs:         resolvedInputs,
            timeout_ms:     this.opts.timeoutMs,
            fromPopulation: this.opts.fromPopulation,
          });

          const correctness = adapterResult.ok
            ? ((adapterResult.run_metadata?.correctness as number | undefined) ?? 1.0)
            : 0.0;
          lastResult = {
            martian_type: martianType,
            output:       adapterResult.output ?? {},
            correctness,
            fitness:      adapterResult.fitness,
            tool_calls:   adapterResult.run_metadata.tool_calls,
            error:        adapterResult.ok ? null : (adapterResult.error ?? 'unknown'),
          };

          summons.push({
            state:        currentState,
            martian_type: martianType,
            fitness:      adapterResult.fitness,
            tool_calls:   adapterResult.run_metadata.tool_calls,
            ok:           adapterResult.ok,
          });

          this.recordResult(
            martianType,
            summonId,
            resolvedInputs,
            this.genome,
            adapterResult,
          );
          this.appendHeartbeat('summon-result', {
            martian_type: martianType,
            ok:           adapterResult.ok,
            fitness:      adapterResult.fitness,
            tool_calls:   adapterResult.run_metadata.tool_calls,
          });
          break;
        }
      }
    }

    const campaignFitness = aggregate(summons, termReason);
    this.appendHeartbeat('finalized', {
      reason:        termReason,
      fitness:       campaignFitness.fitness,
      summon_count:  summons.length,
      ...(failError ? { error: failError } : {}),
    });

    return {
      subagentId:         this.subagentId,
      campaignId:         this.opts.campaignId,
      fitness:            campaignFitness.fitness,
      termination_reason: termReason,
      summon_count:       summons.length,
      final_output:       lastResult?.output ?? null,
      ...(failError ? { error: failError } : {}),
    };
  }

  // ── Lifecycle: erase ──────────────────────────────────────────────────────

  erase(): void {
    if (this._erased) return;
    this._erased = true;
    try {
      this.appendHeartbeat('erased', { campaign_id: this.opts.campaignId });
    } catch { /* ignore */ }
    if (existsSync(this._workspaceDir)) {
      rmSync(this._workspaceDir, { recursive: true, force: true });
    }
  }

  get isErased(): boolean { return this._erased; }
}
