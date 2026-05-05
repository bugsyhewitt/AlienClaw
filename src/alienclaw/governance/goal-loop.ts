/**
 * Goal-loop orchestrator for the Packet 6 governance layer.
 *
 * Wires BossBot, AdvisorBot, and CreatorBot with shared dependencies
 * (logger sink, summon adapter) and exposes a single run(goal) entry point.
 *
 * Usage:
 *   const loop = new GoalLoop();           // production defaults
 *   const response = await loop.run('Summarize HN today');
 *
 *   const loop = new GoalLoop({            // test injection
 *     logSink: mySink,
 *     summonAdapter: myMock,
 *   });
 */

import { assertLegalSend } from './comm-graph.js';
import { Logger, JsonStdoutSink } from './logger.js';
import { AdvisorBot } from './advisor-bot.js';
import { CreatorBot } from './creator-bot.js';
import { BossBot } from './boss-bot.js';
import { MockMartianSummonAdapter } from './summon-adapter.js';
import { newCorrelationId, nowIso } from './messages.js';
import type { UserGoalMessage, UserResponseMessage } from './messages.js';
import type { LogSink } from './logger.js';
import type { MartianSummonAdapter } from './summon-adapter.js';

export interface GoalLoopDeps {
  /** Log destination. Defaults to JsonStdoutSink (JSONL to stdout). */
  logSink?: LogSink;
  /** Martian summon adapter. Defaults to MockMartianSummonAdapter for Packet 6. */
  summonAdapter?: MartianSummonAdapter;
}

export class GoalLoop {
  private readonly boss: BossBot;

  constructor(deps: GoalLoopDeps = {}) {
    const sink    = deps.logSink       ?? new JsonStdoutSink();
    const adapter = deps.summonAdapter ?? new MockMartianSummonAdapter();
    const advisor = new AdvisorBot(new Logger(sink, 'AdvisorBot'));
    const creator = new CreatorBot(new Logger(sink, 'CreatorBot'), adapter);
    this.boss     = new BossBot(new Logger(sink, 'BossBot'), advisor, creator);
  }

  /**
   * Run one goal end-to-end through the governance loop.
   *
   * @param goal         Natural-language goal string.
   * @param constraints  Optional list of constraint strings.
   * @returns            The final user-facing response message.
   */
  async run(goal: string, constraints?: string[]): Promise<UserResponseMessage> {
    const message: UserGoalMessage = {
      from: 'user',
      to:   'BossBot',
      kind: 'user-goal',
      payload:        { goal, constraints },
      correlation_id: newCorrelationId(),
      timestamp:      nowIso(),
    };
    assertLegalSend(message);
    return this.boss.handleUserGoal(message);
  }
}
