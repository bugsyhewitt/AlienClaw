import { bossBot }      from '../agents/bossbot.js';
import { advisorBot }   from '../agents/advisorbot.js';
import { creatorBot }   from '../agents/creatorbot.js';
import { agentRegistry } from '../agents/agent-registry.js';
import { alienClawConfig } from '../config/alienclaw-config.js';
import { wireToolAdapters } from '../msb/tool-adapters.js';
import { getRegistry }      from '../registry/registry.js';
import { installSeeds }     from '../registry/seed-installer.js';
import { GoalManager }       from '../governance/goal-manager.js';
import { TaskManager }       from '../governance/task-manager.js';
import { EscalationHandler } from '../governance/escalation-handler.js';
import { CompletionHandler } from '../governance/completion-handler.js';
import { GovernanceLoop }    from '../governance/governance-loop.js';
import { UserChannel }       from '../comms/user-channel.js';

export interface BootstrapResult {
  loop:        GovernanceLoop;
  userChannel: UserChannel;
}

/**
 * Wire the full agent hierarchy and return a ready GovernanceLoop.
 * Phase 5 CLI calls this on startup.
 *
 * Does NOT call loop.start() — the caller owns the lifecycle.
 */
export function bootstrap(): BootstrapResult {
  // Phase 3: Meeseeks registry bootstrap
  installSeeds();               // copy seed .ms / .msb to ~/.alienclaw/registry/
  const registry = getRegistry();
  registry.load();              // read-only load of all .ms files
  wireToolAdapters();           // wire OpenClaw tools → Meeseeks layer

  const prefs      = alienClawConfig.preferences;
  const userChannel   = new UserChannel(prefs);
  const goalManager   = new GoalManager();
  const taskManager   = new TaskManager();

  const escalationHandler = new EscalationHandler(
    advisorBot, creatorBot, taskManager, userChannel
  );

  const completionHandler = new CompletionHandler(
    advisorBot, bossBot, goalManager, userChannel
  );

  const loop = new GovernanceLoop({
    bossBot,
    advisorBot,
    creatorBot,
    agentRegistry,
    goalManager,
    taskManager,
    escalationHandler,
    completionHandler,
    userChannel,
  });

  return { loop, userChannel };
}
