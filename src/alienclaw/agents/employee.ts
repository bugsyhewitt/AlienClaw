/**
 * employee.ts
 * Specialist agent — campaign-scoped domain expert built by CreatorBot.
 *
 * Design invariants:
 *   - Cannot call tools directly — ALWAYS via summonMeeseeks()
 *   - Cannot mutate Meeseeks genomes
 *   - Holds deep campaign-specific knowledge in its soul (injected at build time)
 *   - Is disposed when its Campaign ends (deregisterEmployee)
 *   - summonMeeseeks() is an intentional act, not a passive registry lookup
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EMPLOYEE_DEFAULT_MODEL,
  FAILFORWARD_MAX_ATTEMPTS,
  MEESEEKS_REPORT_LEN,
} from '../constants.js';
import type {
  EmployeeSpec,
  TaskEnvelope,
  TaskResult,
  SummonResult,
  SpecialistRole,
} from '../types.js';
import { getRegistry }       from '../registry/registry.js';
import { executeMeeseeks }   from '../msb/meeseeks-executor.js';
import type { MeeseeksExecutionInput } from '../registry/ms-types.js';
import { telemetryWriter }   from '../telemetry/telemetry-writer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_SOUL = readFileSync(
  join(__dirname, '..', 'prompts', 'employee.soul.md'),
  'utf-8'
);

// ---------------------------------------------------------------------------
// Employee / Specialist class
// ---------------------------------------------------------------------------

export class Employee {
  readonly name:   string;
  readonly model:  string;
  readonly soul:   string;
  readonly spec:   EmployeeSpec;

  // Governance compatibility aliases
  readonly id:     string;
  readonly domain: string;

  /** Campaign ID this specialist was built for (undefined for legacy generic employees) */
  readonly campaignId?: string;

  /** Which Meeseeks tool tags this specialist is authorised to summon */
  readonly authorisedTags: ReadonlySet<string>;

  constructor(spec: EmployeeSpec, role?: SpecialistRole, campaignId?: string) {
    this.spec        = spec;
    this.name        = spec.employeeId;
    this.id          = spec.employeeId;
    this.domain      = spec.domain;
    this.model       = spec.model ?? EMPLOYEE_DEFAULT_MODEL;
    this.campaignId  = campaignId;

    // Build soul: start with the base template, inject spec fields, then
    // append the campaign knowledge base if this is a true Specialist.
    let soul = BASE_SOUL
      .replace(/\{\{EMPLOYEE_ID\}\}/g,          spec.employeeId)
      .replace(/\{\{DOMAIN\}\}/g,               spec.domain)
      .replace(/\{\{GENERATION\}\}/g,           String(spec.generation))
      .replace(/\{\{FAILFORWARD_ATTEMPTS\}\}/g, String(FAILFORWARD_MAX_ATTEMPTS))
      .replace(/\{\{TASK_ID\}\}/g,              'PENDING')
      .replace(/\{\{ROLE\}\}/g,                 role?.role ?? spec.domain)
      .replace(/\{\{CAMPAIGN_ID\}\}/g,          campaignId ?? 'STANDALONE');

    if (role?.knowledgeBase) {
      soul += `\n\n---\n## Campaign Knowledge Base\n\n${role.knowledgeBase}`;
    }

    if (role?.meeseeksTags?.length) {
      soul += `\n\n## Authorised Meeseeks Tags\n\n` +
              role.meeseeksTags.map(t => `- ${t}`).join('\n');
    }

    this.soul           = soul;
    this.authorisedTags = new Set(role?.meeseeksTags ?? spec.toolTags);
  }

  systemPrompt(): string {
    return this.soul;
  }

  /** Returns a hydrated soul with the actual task ID injected. */
  systemPromptForTask(task: TaskEnvelope): string {
    return this.soul.replace(/PENDING/g, task.taskId);
  }

  // ── summonMeeseeks ──────────────────────────────────────────────────────────

  /**
   * Intentionally summon a specific Meeseeks by tool tag to execute work.
   *
   * This is the specialist's only interface to tool execution — it is an
   * explicit, intentional act. The specialist chooses WHICH Meeseeks to
   * call and WHY, rather than passively waiting for a registry lookup.
   *
   * @param tag     - Meeseeks tool tag (must be in authorisedTags for specialists)
   * @param task    - Natural language task description
   * @param context - Key-value execution context (passed to the MSB executor)
   */
  async summonMeeseeks(
    tag:     string,
    task:    string,
    context: Record<string, string> = {}
  ): Promise<SummonResult> {
    const registry = getRegistry();
    if (!registry.isLoaded) registry.load();

    const meeseeks = registry.bestForTool(tag);

    if (!meeseeks) {
      return {
        tag,
        outcome: 'FAILURE',
        error:   `No active Meeseeks for tool tag "${tag}" (registry size: ${registry.size})`,
        ts:      Date.now(),
      };
    }

    const execInput: MeeseeksExecutionInput = { meeseeks, task, context };

    try {
      const result = await executeMeeseeks(execInput);

      const summonResult: SummonResult = {
        tag,
        outcome: result.outcome,
        output:  result.output,
        error:   result.error,
        ts:      Date.now(),
      };

      // Telemetry
      const reportCode = meeseeks.id.slice(0, MEESEEKS_REPORT_LEN);
      void telemetryWriter.writeMeeseeksReport(reportCode, {
        taskId:     `summon-${Date.now()}`,
        employeeId: this.name,
        meeseeksId: meeseeks.id,
        domain:     tag,
        outcome:    result.outcome,
        summary:    result.outcome === 'SUCCESS'
          ? `Meeseeks ${meeseeks.id} succeeded: ${task.slice(0, 80)}`
          : `Meeseeks ${meeseeks.id} failed: ${result.error ?? 'unknown'}`,
      });

      return summonResult;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        tag,
        outcome: 'FAILURE',
        error:   `Meeseeks ${meeseeks.id} threw unexpectedly: ${msg}`,
        ts:      Date.now(),
      };
    }
  }

  // ── executeTask ─────────────────────────────────────────────────────────────

  /**
   * Execute a task by summoning the appropriate Meeseeks.
   *
   * Uses the task's domain as the tool tag. For specialists with a defined
   * set of authorised tags, the domain must match one of them — otherwise
   * the specialist summons the closest match from its authorised set.
   */
  async executeTask(task: TaskEnvelope): Promise<TaskResult> {
    // Determine which tag to summon
    let tag = task.domain;
    if (this.authorisedTags.size > 0 && !this.authorisedTags.has(tag)) {
      // Fall back to the first authorised tag rather than failing cold
      tag = [...this.authorisedTags][0];
    }

    const summon = await this.summonMeeseeks(tag, task.description, {
      taskId:     task.taskId,
      employeeId: this.name,
      domain:     task.domain,
      priority:   task.priority,
    });

    return {
      taskId:        task.taskId,
      employeeId:    this.name,
      outcome:       summon.outcome,
      summary:       summon.outcome === 'SUCCESS'
        ? `Meeseeks [${tag}] completed: ${task.description.slice(0, 80)}`
        : `Meeseeks [${tag}] failed: ${summon.error ?? 'unknown'}`,
      failureReason: summon.error,
      ts:            Date.now(),
    };
  }

  /** Dispose this specialist — call when its campaign ends. */
  dispose(): void {
    deregisterEmployee(this.id);
  }
}

// ---------------------------------------------------------------------------
// Factory — Phase 2B governance layer calls this
// ---------------------------------------------------------------------------

export function buildEmployee(spec: EmployeeSpec): Employee {
  return new Employee(spec);
}

/**
 * Build a Specialist (campaign-scoped Employee).
 * Called by CreatorBot when it receives a Scheme and builds out each Campaign.
 */
export function buildSpecialist(
  spec:       EmployeeSpec,
  role:       SpecialistRole,
  campaignId: string
): Employee {
  return new Employee(spec, role, campaignId);
}

// ---------------------------------------------------------------------------
// Global registration functions
// ---------------------------------------------------------------------------

const _employees = new Map<string, Employee>();

export function registerEmployee(employee: Employee): void {
  _employees.set(employee.id, employee);
}

export function deregisterEmployee(id: string): void {
  _employees.delete(id);
}

export function getEmployee(id: string): Employee | undefined {
  return _employees.get(id);
}

export function getAllEmployees(): Employee[] {
  return [..._employees.values()];
}

/** Return all specialists belonging to a given campaign. */
export function getCampaignSpecialists(campaignId: string): Employee[] {
  return [..._employees.values()].filter(e => e.campaignId === campaignId);
}

/** Dispose all specialists for a campaign once it ends. */
export function disposeCampaign(campaignId: string): void {
  for (const emp of getCampaignSpecialists(campaignId)) {
    emp.dispose();
  }
}
