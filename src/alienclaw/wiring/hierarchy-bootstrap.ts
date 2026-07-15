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
  FITNESS_UPDATE_INTERVAL_MS,
  ADVISE_FROM_TELEMETRY_INTERVAL_MS,
  LIVE_EVO_CHECK_INTERVAL_MS,
  FITNESS_EMA_ALPHA,
  FITNESS_EVOLUTION_THRESHOLD,
  PATHS,
} from '../constants.js';
import type { MartianSpec } from '../registry/ms-types.js';
import { GoalManager }       from '../governance/common/goal-manager.js';
import { TaskManager }       from '../governance/common/task-manager.js';
import { EscalationHandler } from '../governance/common/escalation-handler.js';
import { CompletionHandler } from '../governance/common/completion-handler.js';
import { GovernanceLoop }    from '../governance/common/governance-loop.js';
import { RealMartianSummonAdapter } from '../governance/common/real-summon-adapter.js';
import { CreatorBot as CommonCreatorBot } from '../governance/common/creator-bot.js';
import { DomainResolver }                 from '../governance/common/domain-resolver.js';
import { Logger, JsonStdoutSink }         from '../governance/common/logger.js';
import { OnlineFitnessLog }               from '../governance/common/online-fitness-log.js';
import { UserChannel }       from '../comms/user-channel.js';
import { AgentChannel,
         agentChannel }       from '../comms/agent-channel.js';
import { readRecentMartianReports, summarizeFitness } from '../telemetry/telemetry-reader.js';
import type { AdviceRequest } from '../types.js';
import * as fsSync            from 'node:fs';
import { writeFile, mkdir }   from 'node:fs/promises';
import { join }               from 'node:path';
import { spawn }              from 'node:child_process';

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
    advisorBot, creatorBot, taskManager, userChannel, agentChannel
  );

  const completionHandler = new CompletionHandler(
    advisorBot, goalManager, userChannel, agentChannel
  );

  const adapter = new RealMartianSummonAdapter();

  const knownMartianTypes    = registry.list().map(ms => ms.id);
  const commonLogger         = new Logger(new JsonStdoutSink(), 'creator-bot-common');
  const commonDomainResolver = new DomainResolver(
    knownMartianTypes.length > 0 ? knownMartianTypes : ['compute'],
  );
  const commonCreatorBot = new CommonCreatorBot(
    commonLogger, adapter, undefined, commonDomainResolver,
  );

  const onlineFitnessLog = new OnlineFitnessLog();

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
    agentChannel,
    adapter,
    campaignCreatorBot: commonCreatorBot,
    onlineFitnessLog,
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

  // ── Fitness loop — close the report → .ms fitness feedback cycle ──────────

  /** fitness-update: reads recent Martian reports, computes EMA fitness, updates .ms files */
  creatorBot.registerScheduledJob({
    label: 'fitness-update',
    intervalMs: FITNESS_UPDATE_INTERVAL_MS,
    fn: async () => {
      const sinceMs = Date.now() - FITNESS_UPDATE_INTERVAL_MS;
      const reports = await readRecentMartianReports(sinceMs);
      if (reports.length === 0) return;

      // Group by martianId
      const byMartian = new Map<string, typeof reports>();
      for (const r of reports) {
        const arr = byMartian.get(r.martianId) ?? [];
        arr.push(r);
        byMartian.set(r.martianId, arr);
      }

      for (const [martianId, martianReports] of byMartian) {
        const ms = registry.get(martianId);
        if (!ms) continue;

        const total = martianReports.length;
        const successes = martianReports.filter(r => r.outcome === 'SUCCESS').length;
        const successRate = total > 0 ? successes / total : 0;
        const newFitness = FITNESS_EMA_ALPHA * successRate + (1 - FITNESS_EMA_ALPHA) * ms.fitness;

        // Update in-memory registry
        ms.fitness = newFitness;

        // Atomically rewrite the .ms file
        const msPath = join(PATHS.ms, `${martianId}.ms`);
        try {
          const raw = fsSync.readFileSync(msPath, 'utf-8');
          const updated = raw.replace(
            /^# fitness:.*$/m,
            `# fitness: ${newFitness.toFixed(2)}`,
          );
          const tmpPath = msPath + '.tmp';
          fsSync.writeFileSync(tmpPath, updated, 'utf-8');
          fsSync.renameSync(tmpPath, msPath);
        } catch {
          // Non-fatal: keep in-memory updated
        }

        if (newFitness < FITNESS_EVOLUTION_THRESHOLD) {
          creatorBot.enqueue(
            'URGENT',
            `evolve genome ${martianId} — fitness ${newFitness.toFixed(2)} below threshold ${FITNESS_EVOLUTION_THRESHOLD}`,
            'fitness-update',
          );
        }
      }
    },
  });

  /** advise-from-telemetry: hourly AdvisorBot read on worst-performing Martian */
  creatorBot.registerScheduledJob({
    label: 'advise-from-telemetry',
    intervalMs: ADVISE_FROM_TELEMETRY_INTERVAL_MS,
    fn: async () => {
      const sinceMs = Date.now() - ADVISE_FROM_TELEMETRY_INTERVAL_MS;
      const reports = await readRecentMartianReports(sinceMs);
      if (reports.length === 0) return;

      // Find worst performer (lowest success rate with at least 3 runs)
      const byMartian = new Map<string, { total: number; successes: number }>();
      for (const r of reports) {
        const e = byMartian.get(r.martianId) ?? { total: 0, successes: 0 };
        e.total++;
        if (r.outcome === 'SUCCESS') e.successes++;
        byMartian.set(r.martianId, e);
      }

      let worst: { id: string; rate: number } | null = null;
      for (const [id, { total, successes }] of byMartian) {
        if (total < 3) continue;
        const rate = successes / total;
        if (!worst || rate < worst.rate) worst = { id, rate };
      }

      if (!worst) return;

      const adviceReq: AdviceRequest = {
        requesterId: 'CreatorBot',
        context: `Over the last hour, Martian ${worst.id} ran ${byMartian.get(worst.id)?.total ?? 0} times with a ${(worst.rate * 100).toFixed(0)}% success rate.`,
        question: `What might be causing ${worst.id} to underperform? Should we evolve its genome or adjust its tools?`,
      };

      const advice = await advisorBot.advise(adviceReq);

      // Log through AgentChannel — this closes the telemetry → AdvisorBot → AgentChannel loop
      agentChannel.send({
        from: 'CreatorBot', to: 'AdvisorBot', kind: 'request',
        content: adviceReq.question, ts: Date.now(),
      });
      agentChannel.send({
        from: 'AdvisorBot', to: 'CreatorBot', kind: 'response',
        content: advice.verdict, ts: Date.now(),
      });
    },
  });

  /** Spawn `python3 -m alienclaw.bridge` and send a live-evo request (fire-and-forget). */
  function callLiveEvoBridge(martianType: string): Promise<void> {
    return new Promise((resolve) => {
      const req = JSON.stringify({
        bridge_version: '1.0',
        request_id:     'live-evo-check',
        request:        { kind: 'live-evo', martian_type: martianType },
      });
      const child = spawn('python3', ['-m', 'alienclaw.bridge'], { shell: false });
      child.stdin.write(req + '\n');
      child.stdin.end();
      child.on('close', () => resolve());
      child.on('error',  () => resolve());
    });
  }

  /** live-evo-check: trigger threshold-gated generational evolution per martian type */
  creatorBot.registerScheduledJob({
    label: 'live-evo-check',
    intervalMs: LIVE_EVO_CHECK_INTERVAL_MS,
    fn: async () => {
      for (const martianType of knownMartianTypes) {
        await callLiveEvoBridge(martianType);
      }
    },
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
    `  CreatorBot — scheduler running (5 jobs registered)`
  );

  // ── Shutdown handle ───────────────────────────────────────────────────────
  function shutdown(): void {
    creatorBot.stopScheduler();
    loop.stop();
    userChannel.close();
  }

  return { loop, userChannel, shutdown };
}
