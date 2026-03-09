/**
 * employee.ts
 * Employee agent — autonomous domain reasoner built by CreatorBot.
 *
 * Phase 3: executeTask() now dispatches real Meeseeks from the registry
 * instead of returning the Phase 2B stub. The Phase 2B API (EmployeeSpec,
 * buildEmployee, TaskEnvelope) is preserved for governance-layer compatibility.
 *
 * Key invariants:
 *   - Cannot call tools directly — ALWAYS via Meeseeks
 *   - Cannot mutate genomes
 *   - Selects Meeseeks by tool_tag and fitness from the registry
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EMPLOYEE_DEFAULT_MODEL, FAILFORWARD_MAX_ATTEMPTS, MEESEEKS_REPORT_LEN } from '../constants.js';
import type { EmployeeSpec, TaskEnvelope, TaskResult }                            from '../types.js';
import { getRegistry }       from '../registry/registry.js';
import { executeMeeseeks }   from '../msb/meeseeks-executor.js';
import type { MeeseeksExecutionInput } from '../registry/ms-types.js';
import { telemetryWriter }   from '../telemetry/telemetry-writer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_SOUL = readFileSync(
  join(__dirname, '..', 'src', 'alienclaw', 'prompts', 'employee.soul.md'),
  'utf-8'
);

// ---------------------------------------------------------------------------
// Employee class — Phase 2B API preserved, Phase 3 execution wired in
// ---------------------------------------------------------------------------

export class Employee {
  readonly name:   string;
  readonly model:  string;
  readonly soul:   string;
  readonly spec:   EmployeeSpec;

  // Phase 3 fields (aliases for governance compatibility)
  readonly id:     string;
  readonly domain: string;

  constructor(spec: EmployeeSpec) {
    this.spec   = spec;
    this.name   = spec.employeeId;
    this.id     = spec.employeeId;
    this.domain = spec.domain;
    this.model  = spec.model ?? EMPLOYEE_DEFAULT_MODEL;
    this.soul   = BASE_SOUL
      .replace(/\{\{EMPLOYEE_ID\}\}/g,          spec.employeeId)
      .replace(/\{\{DOMAIN\}\}/g,               spec.domain)
      .replace(/\{\{GENERATION\}\}/g,           String(spec.generation))
      .replace(/\{\{FAILFORWARD_ATTEMPTS\}\}/g, String(FAILFORWARD_MAX_ATTEMPTS))
      .replace(/\{\{TASK_ID\}\}/g,              'PENDING');
  }

  systemPrompt(): string {
    return this.soul;
  }

  /** Returns a hydrated soul with the actual task ID injected. */
  systemPromptForTask(task: TaskEnvelope): string {
    return this.soul.replace(/PENDING/g, task.taskId);
  }

  /**
   * Execute a task by selecting the best Meeseeks from the registry
   * and dispatching to it.
   *
   * Phase 3: real Meeseeks dispatch replaces the Phase 2B stub.
   * Falls back gracefully when no Meeseeks matches the domain/tool tag.
   */
  async executeTask(task: TaskEnvelope): Promise<TaskResult> {
    const registry = getRegistry();

    // Ensure registry is loaded (idempotent)
    if (!registry.isLoaded) {
      registry.load();
    }

    const toolTag  = task.domain;
    const meeseeks = registry.bestForTool(toolTag);

    if (!meeseeks) {
      // No suitable Meeseeks — return FAILURE so governance escalates
      return {
        taskId:        task.taskId,
        employeeId:    this.name,
        outcome:       'FAILURE',
        summary:       `No active Meeseeks found for tool tag "${toolTag}" ` +
                       `(registry has ${registry.size} entries). Escalating to BossBot.`,
        failureReason: `NO_MEESEEKS:${toolTag}`,
        ts:            Date.now(),
      };
    }

    const execInput: MeeseeksExecutionInput = {
      meeseeks,
      task:    task.description,
      context: {},
    };

    try {
      const result    = await executeMeeseeks(execInput);
      const succeeded = result.outcome === 'SUCCESS';
      const taskResult: TaskResult = {
        taskId:        task.taskId,
        employeeId:    this.name,
        outcome:       result.outcome,
        summary:       succeeded
          ? `Meeseeks ${meeseeks.id} completed: ${task.description.slice(0, 80)}`
          : `Meeseeks ${meeseeks.id} failed: ${result.error ?? 'unknown error'}`,
        failureReason: result.error,
        ts:            Date.now(),
      };

      // Telemetry: write Meeseeks execution report
      const reportCode = meeseeks.id.slice(0, MEESEEKS_REPORT_LEN);
      void telemetryWriter.writeMeeseeksReport(reportCode, {
        taskId:     task.taskId,
        employeeId: this.name,
        meeseeksId: meeseeks.id,
        domain:     task.domain,
        outcome:    taskResult.outcome,
        summary:    taskResult.summary,
      });

      return taskResult;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        taskId:        task.taskId,
        employeeId:    this.name,
        outcome:       'FAILURE',
        summary:       `Meeseeks ${meeseeks.id} threw unexpectedly: ${msg}`,
        failureReason: msg,
        ts:            Date.now(),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Factory — Phase 2B governance layer calls this
// ---------------------------------------------------------------------------

export function buildEmployee(spec: EmployeeSpec): Employee {
  return new Employee(spec);
}

// ---------------------------------------------------------------------------
// Phase 3 global registration functions (mirrors governance AgentRegistry)
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
