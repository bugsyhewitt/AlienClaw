import { bossBot }      from '../agents/bossbot.js';
import { advisorBot }   from '../agents/advisorbot.js';
import { creatorBot }   from '../agents/creatorbot.js';
import { agentRegistry } from '../agents/agent-registry.js';
import { alienClawConfig } from '../config/alienclaw-config.js';
import { selectHost } from './host-select.js';
import { getRegistry }      from '../registry/registry.js';
import { validateGenome }   from '../registry/genome-codec.js';
import { installSeeds }     from '../registry/seed-installer.js';
import { atomicWrite }      from '../utils.js';
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
  selectHost().wireToolAdapters();   // wire the active host's tools → Martian adapter layer (ALIENCLAW_HOST, default openclaw)

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
    // PKT-458: !Number.isFinite() catches NaN, Infinity, -Infinity (all fail the range check silently).
    if (!Number.isFinite(ms.fitness) || ms.fitness < 0 || ms.fitness > 1) {
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

      if (reports.length > 0) {
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

          // PKT-458: a non-finite ms.fitness (NaN/Infinity/-Infinity) means the prior tick's
          // writer was buggy or the .ms file was hand-edited. Blending NaN into the EMA
          // propagates NaN to newFitness, which then writes "# fitness: NaN" back to disk
          // and silently skips the URGENT enqueue (NaN < threshold is always false).
          if (!Number.isFinite(ms.fitness)) {
            creatorBot.enqueue(
              'URGENT',
              `fitness-update: martian ${martianId} has non-finite fitness (${ms.fitness}); skipping EMA, manual repair required`,
              'fitness-update',
            );
            continue;
          }

          // PKT-615: reject malformed outcomes before computing successRate so ghosts
          // don't inflate the denominator and deflate the EMA fitness.
          const validReports = martianReports.filter(r =>
            r.outcome === 'SUCCESS' || r.outcome === 'FAILURE' || r.outcome === 'ESCALATED',
          );
          const malformedCount = martianReports.length - validReports.length;
          // PKT-615: surface malformed-outcome count via NOTABLE enqueue. One-shot per Martian per tick.
          if (malformedCount > 0) {
            creatorBot.enqueue(
              'NOTABLE',
              `fitness-update: martian ${martianId} had ${malformedCount} report(s) with non-canonical outcome enum values; rejected before EMA blend`,
              'fitness-update',
            );
          }
          // PKT-615: if ALL reports are malformed (zero valid observations), skip the EMA blend,
          // .ms rewrite, and URGENT threshold check entirely. Decaying fitness on zero valid
          // evidence would create a spurious evolve-genome storm (the core PKT-615 symptom).
          if (validReports.length === 0) continue;
          const total      = validReports.length;
          const successes  = validReports.filter(r => r.outcome === 'SUCCESS').length;
          const successRate = total > 0 ? successes / total : 0;
          const newFitness = FITNESS_EMA_ALPHA * successRate + (1 - FITNESS_EMA_ALPHA) * ms.fitness;

          // PKT-458: defensive guard on the EMA result (both terms bounded in [0,1] so
          // this should be unreachable in practice, but guards against future regressions).
          if (!Number.isFinite(newFitness)) {
            creatorBot.enqueue(
              'URGENT',
              `fitness-update: martian ${martianId} produced non-finite newFitness (${newFitness}); skipping file rewrite`,
              'fitness-update',
            );
            continue;
          }

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
            atomicWrite(msPath, updated);
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
      }

      // Write live-fitness summary every tick so status readers see fresh data
      try {
        const allMs = registry.list();
        const summary = JSON.stringify({
          generated_at: new Date().toISOString(),
          martians: allMs.map(ms => ({ id: ms.id, fitness: ms.fitness })),
        }, null, 2);
        atomicWrite(PATHS.liveFitnessSummary, summary);
      } catch {
        // Non-fatal
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

      // PKT-756: find worst performer using valid-only count — malformed outcomes excluded from
      // denominator to prevent rate deflation and sub-threshold promotion (mirror of PKT-615).
      const byMartian = new Map<string, { valid: number; successes: number; malformed: number }>();
      for (const r of reports) {
        const e = byMartian.get(r.martianId) ?? { valid: 0, successes: 0, malformed: 0 };
        if (r.outcome === 'SUCCESS' || r.outcome === 'FAILURE' || r.outcome === 'ESCALATED') {
          e.valid++;
          if (r.outcome === 'SUCCESS') e.successes++;
        } else {
          e.malformed++;
        }
        byMartian.set(r.martianId, e);
      }

      let worst: { id: string; rate: number; valid: number } | null = null;
      for (const [id, e] of byMartian) {
        // PKT-756: surface malformed-outcome count via NOTABLE enqueue, one-shot per Martian per tick.
        if (e.malformed > 0) {
          creatorBot.enqueue(
            'NOTABLE',
            `advise-from-telemetry: martian ${id} had ${e.malformed} report(s) with non-canonical outcome enum values; rejected before advisor surface`,
            'advise-from-telemetry',
          );
        }
        if (e.valid < 3) continue;
        const rate = e.successes / e.valid;
        if (!worst || rate < worst.rate) worst = { id, rate, valid: e.valid };
      }

      if (!worst) return;

      const adviceReq: AdviceRequest = {
        requesterId: 'CreatorBot',
        context: `Over the last hour, Martian ${worst.id} ran ${worst.valid} times with a ${(worst.rate * 100).toFixed(0)}% success rate.`,
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

  /** Spawn `python3 -m alienclaw.bridge`, send a live-evo request, and handle the response. */
  function callLiveEvoBridge(martianType: string): Promise<void> {
    return new Promise((resolve) => {
      const req = JSON.stringify({
        bridge_version: '1.0',
        request_id:     'live-evo-check',
        request:        { kind: 'live-evo', martian_type: martianType },
      });
      const child = spawn('python3', ['-m', 'alienclaw.bridge'], { shell: false });
      let stdout = '';
      let stderrBuf = '';
      // PKT-912: track the inner SIGKILL grace timer so the 'close' handler can
      // cancel it. Without this, when SIGTERM is sent at t=30s and the child
      // exits cleanly at t=30.5s, the inner 5s SIGKILL timer still fires at
      // t=35s on the already-dead PID. Node swallows kill() on dead PIDs
      // (returns false) so production impact is silent, but it (a) leaks the
      // child ref + closure for 5s, and (b) is a near-miss for PID-reuse
      // races if an OS PID is recycled in that window.
      let sigkillTimer: ReturnType<typeof setTimeout> | null = null;
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        sigkillTimer = setTimeout(() => { child.kill('SIGKILL'); }, 5000);
      }, 30_000);
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk: Buffer) => { stderrBuf += chunk.toString('utf8'); });
      child.stdin.write(req + '\n');
      child.stdin.end();
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        if (sigkillTimer !== null) {
          clearTimeout(sigkillTimer);
          sigkillTimer = null;
        }
        handleLiveEvoResponse(martianType, exitCode, stdout, stderrBuf);
        resolve();
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        if (sigkillTimer !== null) {
          clearTimeout(sigkillTimer);
          sigkillTimer = null;
        }
        creatorBot.enqueue('NOTABLE',
          `live-evo spawn failed for ${martianType}: ${err.message}`,
          'live-evo-check');
        resolve();
      });
    });
  }

  function handleLiveEvoResponse(
    martianType: string,
    exitCode: number | null,
    stdout: string,
    stderr: string,
  ): void {
    if (exitCode !== 0) {
      creatorBot.enqueue('URGENT',
        `live-evo bridge exit ${exitCode} for ${martianType}: ${stderr.slice(-512) || '<no stderr>'}`,
        'live-evo-check');
      return;
    }
    try {
      const envelope = JSON.parse(stdout.trim()) as {
        response: {
          evolved: boolean;
          reason?: string;
          generation?: number;
          next_generation?: number;
          children_minted?: number;
          new_observations?: number;
        };
      };
      const r = envelope.response;
      if (r.evolved) {
        creatorBot.enqueue('NOTABLE',
          `live-evo evolved ${martianType}: gen ${r.generation} → ${r.next_generation}, children=${r.children_minted}, new_obs=${r.new_observations}`,
          'live-evo-check');
      }
    } catch (parseErr) {
      creatorBot.enqueue('URGENT',
        `live-evo response parse failed for ${martianType}: ${parseErr}; stdout=${stdout.slice(0, 256)}`,
        'live-evo-check');
    }
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
