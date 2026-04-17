import { bossBot }      from '../agents/bossbot.js';
import { advisorBot }   from '../agents/advisorbot.js';
import { creatorBot }   from '../agents/creatorbot.js';
import { agentRegistry } from '../agents/agent-registry.js';
import { alienClawConfig } from '../config/alienclaw-config.js';
import { wireToolAdapters } from '../msb/tool-adapters.js';
import { getRegistry }      from '../registry/registry.js';
import { validateGenome }   from '../registry/genome-codec.js';
import { installSeeds }     from '../registry/seed-installer.js';
import {
  REGISTRY_HEALTH_INTERVAL_MS,
  GENOME_AUDIT_INTERVAL_MS,
} from '../constants.js';
import type { MartianSpec } from '../registry/ms-types.js';
import { GoalManager }       from '../governance/goal-manager.js';
import { TaskManager }       from '../governance/task-manager.js';
import { EscalationHandler } from '../governance/escalation-handler.js';
import { CompletionHandler } from '../governance/completion-handler.js';
import { GovernanceLoop }    from '../governance/governance-loop.js';
import { UserChannel }       from '../comms/user-channel.js';

export interface BootstrapResult {
  /** The BossBot governance loop — call loop.start() to begin processing goals */
  loop:        GovernanceLoop;
  /** User-facing communication channel */
  userChannel: UserChannel;
  /**
   * Stop all three agents cleanly.
   * Stops CreatorBot's scheduler first, then the governance loop.
   */
  shutdown:    () => void;
}

/**
 * Wire the full agent hierarchy and return a ready BootstrapResult.
 * All three Tier-A agents (BossBot, AdvisorBot, CreatorBot) start simultaneously:
 *   - CreatorBot's scheduler begins immediately on bootstrap
 *   - BossBot's GovernanceLoop begins when the caller invokes loop.start()
 *   - AdvisorBot is stateless between calls; it's ready from the moment it's wired
 *
 * Install order: OpenClaw must be installed before this bootstrap runs.
 * The install.sh script enforces that gate before invoking bootstrap.
 *
 * Does NOT call loop.start() — the caller owns the lifecycle.
 */
export function bootstrap(): BootstrapResult {
  // ── Martian registry ──────────────────────────────────────────────────────
  installSeeds();               // copy seed .ms / .msb to ~/.alienclaw/registry/
  const registry = getRegistry();
  registry.load();              // read-only load of all .ms files
  wireToolAdapters();           // wire OpenClaw tools → Martian adapter layer

  // ── Comms & config ────────────────────────────────────────────────────────
  const prefs       = alienClawConfig.preferences;
  const userChannel = new UserChannel(prefs);

  // ── Governance components ─────────────────────────────────────────────────
  const goalManager   = new GoalManager();
  const taskManager   = new TaskManager();

  const escalationHandler = new EscalationHandler(
    advisorBot, creatorBot, taskManager, userChannel
  );

  const completionHandler = new CompletionHandler(
    advisorBot, goalManager, userChannel
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

  // ── CreatorBot scheduled jobs ─────────────────────────────────────────────
  // Register default maintenance jobs. More can be added by extensions.

  /** Audit every Martian in the registry against a predicate, enqueuing URGENT on match */
  function registerAuditJob(
    label:      string,
    intervalMs: number,
    predicate: (ms: MartianSpec) => string | undefined,  // returns msg if anomalous
  ): void {
    creatorBot.registerScheduledJob({ label, intervalMs, fn: async () => {
      const loaded = registry.list();
      for (const ms of loaded) {
        const msg = predicate(ms);
        if (msg) creatorBot.enqueue('URGENT', msg, label);
      }
    }});
  }

  registerAuditJob('registry-health-check', REGISTRY_HEALTH_INTERVAL_MS, ms => {
    if (ms.fitness < 0 || ms.fitness > 1) {
      return `Martian ${ms.id} has invalid fitness score: ${ms.fitness}`;
    }
    return undefined;
  });

  registerAuditJob('genome-checksum-audit', GENOME_AUDIT_INTERVAL_MS, ms => {
    const result = validateGenome(ms.genome);
    if (!result.valid) {
      return `Genome corruption detected in ${ms.id}: ${result.errors.join('; ')}`;
    }
    return undefined;
  });

  // ── Start all three agents simultaneously ─────────────────────────────────
  // AdvisorBot: stateless between calls — ready immediately.
  // CreatorBot: scheduler starts now, runs independently of GovernanceLoop.
  // BossBot:    GovernanceLoop starts when caller calls loop.start().
  creatorBot.startScheduler();

  userChannel.verbose(
    '[Bootstrap] All 3 Tier-A agents online:\n' +
    '  BossBot    — awaiting loop.start()\n' +
    '  AdvisorBot — ready\n' +
    `  CreatorBot — scheduler running (2 jobs registered)`
  );

  // ── Shutdown handle ───────────────────────────────────────────────────────
  function shutdown(): void {
    creatorBot.stopScheduler();
    loop.stop();
    userChannel.close();
  }

  return { loop, userChannel, shutdown };
}
