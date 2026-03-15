import { bossBot }    from './bossbot.js';
import { advisorBot } from './advisorbot.js';
import { creatorBot } from './creatorbot.js';
import type { Employee } from './employee.js';

export class AgentRegistry {
  readonly bossBot    = bossBot;
  readonly advisorBot = advisorBot;
  readonly creatorBot = creatorBot;

  private employees = new Map<string, Employee>();

  registerEmployee(employee: Employee): void {
    this.employees.set(employee.name, employee);
  }

  getEmployee(id: string): Employee | undefined {
    return this.employees.get(id);
  }

  getEmployeesByDomain(domain: string): Employee[] {
    return [...this.employees.values()]
      .filter(e => e.spec.domain === domain);
  }

  listEmployees(): Employee[] {
    return [...this.employees.values()];
  }

  /**
   * Deregister is called by BossBot via GovernanceLoop when he
   * decides an Employee's work is done. Never auto-expires.
   */
  deregisterEmployee(id: string): void {
    this.employees.delete(id);
  }

  /**
   * Called on task completion — cleans up employees AND
   * destroys AdvisorBot sessions for that task.
   */
  closeTask(taskId: string): void {
    this.advisorBot.destroyTaskSessions(taskId);
    // Employee deregistration is BossBot's explicit call, not automatic.
    // This method exists for future Mission Control hooks.
  }
}

export const agentRegistry = new AgentRegistry();
