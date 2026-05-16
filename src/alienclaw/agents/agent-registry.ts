import { bossBot }    from './bossbot.js';
import { advisorBot } from './advisorbot.js';
import { creatorBot } from './creatorbot.js';

export class AgentRegistry {
  readonly bossBot    = bossBot;
  readonly advisorBot = advisorBot;
  readonly creatorBot = creatorBot;

  /**
   * Called on goal completion — destroys AdvisorBot sessions for that goal.
   */
  closeTask(taskId: string): void {
    this.advisorBot.destroyTaskSessions(taskId);
  }
}

export const agentRegistry = new AgentRegistry();
