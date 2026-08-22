import { readFileSync }                     from 'fs';
import { join, dirname }                    from 'path';
import { fileURLToPath }                    from 'url';
import { AGENT_MODELS } from '../constants.js';
import { parseModelJson } from '../utils.js';
import { selectHost } from '../wiring/host-select.js';
import type {
  AdviceRequest, AdviceResponse,
  AdvisorySession, AgentMessage,
} from '../types.js';
import type { TierAAgent } from '../constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOUL_PATH  = join(__dirname, '..', 'prompts', 'advisorbot.soul.md');

// ── Shape validator (PKT-694) ─────────────────────────────────────────────────

const CONFIDENCE_LITERALS = ['low', 'medium', 'high'] as const;

function validateAdviceResponse(parsed: unknown): AdviceResponse | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const r = parsed as Record<string, unknown>;
  if (typeof r.verdict        !== 'string') return null;
  if (typeof r.confidence     !== 'string' || !CONFIDENCE_LITERALS.includes(r.confidence as never)) return null;
  if (!Array.isArray(r.blindspots) || r.blindspots.some((b: unknown) => typeof b !== 'string')) return null;
  if (typeof r.recommendation !== 'string') return null;
  return {
    verdict:        r.verdict        as string,
    confidence:     r.confidence     as 'low' | 'medium' | 'high',
    blindspots:     r.blindspots     as string[],
    recommendation: r.recommendation as string,
  };
}

// ── AdvisorBot ────────────────────────────────────────────────────────────────

export class AdvisorBot {
  readonly name  = 'AdvisorBot' as const;
  readonly model = AGENT_MODELS.AdvisorBot;
  readonly soul  = readFileSync(SOUL_PATH, 'utf-8');

  /**
   * Sessions are keyed by `${callerId}::${taskId}`.
   * BossBot and CreatorBot NEVER share a session. Ever.
   * Sessions are destroyed when the task completes.
   */
  private sessions = new Map<string, AdvisorySession>();

  private sessionKey(callerId: TierAAgent, taskId: string): string {
    return `${callerId}::${taskId}`;
  }

  getOrCreateSession(callerId: TierAAgent, taskId: string): AdvisorySession {
    const key = this.sessionKey(callerId, taskId);
    if (!this.sessions.has(key)) {
      this.sessions.set(key, {
        callerId,
        taskId,
        history:   [],
        createdAt: Date.now(),
      });
    }
    return this.sessions.get(key)!;
  }

  appendToSession(callerId: TierAAgent, taskId: string, msg: AgentMessage): void {
    const session = this.getOrCreateSession(callerId, taskId);
    session.history.push(msg);
  }

  /**
   * Destroy both caller sessions for a task on completion.
   * Called by GovernanceLoop when transitioning to COMPLETE or ESCALATED.
   */
  destroyTaskSessions(taskId: string): void {
    for (const key of this.sessions.keys()) {
      if (key.endsWith(`::${taskId}`)) this.sessions.delete(key);
    }
  }

  systemPrompt(): string {
    return this.soul;
  }

  buildContext(req: AdviceRequest, session: AdvisorySession): string {
    const history = session.history
      .map(m => `[${m.from}]: ${m.content}`)
      .join('\n');
    return `${history ? `Previous exchanges:\n${history}\n\n` : ''}Context:\n${req.context}\n\nQuestion:\n${req.question}`;
  }

  static parseResponse(raw: string): AdviceResponse {
    return parseModelJson(
      raw,
      parsed => validateAdviceResponse(parsed) ?? {
        verdict:        '<malformed LLM JSON>',
        confidence:     'low',
        blindspots:     ['advisor_response_shape_mismatch'],
        recommendation: 'review AdvisorBot output shape',
      },
      clean => ({
        verdict:        clean || raw.trim(),
        confidence:     'medium',
        blindspots:     [],
        recommendation: '',
      }),
    );
  }

  /**
   * Get formal advisory from AdvisorBot via a real LLM call.
   * Routes through OpenClaw's provider layer (model from AGENT_MODELS.AdvisorBot).
   *
   * @param req     The advice request (requesterId, context, question).
   * @param taskId  Optional task ID — if provided, the session history for
   *                (req.requesterId, taskId) is included in the LLM context.
   */
  async advise(req: AdviceRequest, taskId?: string): Promise<AdviceResponse> {
    // Build user content — include session history when taskId is known
    let userContent: string;
    if (taskId) {
      const session = this.getOrCreateSession(req.requesterId, taskId);
      userContent   = this.buildContext(req, session);
    } else {
      userContent = `Context:\n${req.context}\n\nQuestion:\n${req.question}`;
    }

    // Provider is host-selected (ALIENCLAW_HOST): OpenClaw → pi-ai, Hermes → its provider layer.
    const text = await selectHost().llm().complete('AdvisorBot', this.soul, userContent);
    return AdvisorBot.parseResponse(text);
  }
}

export const advisorBot = new AdvisorBot();
