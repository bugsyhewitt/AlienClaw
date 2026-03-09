import { readFileSync }                     from 'fs';
import { join, dirname }                    from 'path';
import { fileURLToPath }                    from 'url';
import {
  completeSimple,
  getEnvApiKey,
  getModel,
  type AssistantMessage,
  type Context,
  type TextContent,
} from '@mariozechner/pi-ai';
import { AGENT_MODELS, ALIENCLAW_PROVIDER } from '../constants.js';
import type {
  AdviceRequest, AdviceResponse,
  AdvisorySession, AgentMessage,
} from '../types.js';
import type { TierAAgent } from '../constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOUL_PATH = join(__dirname, '..', 'src', 'alienclaw', 'prompts', 'advisorbot.soul.md');

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractText(msg: AssistantMessage): string {
  return (msg.content as Array<{ type: string; text?: string }>)
    .filter((c): c is TextContent => c.type === 'text')
    .map(c => c.text)
    .join('');
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

  parseResponse(raw: string): AdviceResponse {
    // Strip optional markdown fences
    const clean = raw.replace(/```(?:json)?\n?/g, '').trim();
    try {
      return JSON.parse(clean) as AdviceResponse;
    } catch {
      return {
        verdict:        clean.trim() || raw.trim(),
        confidence:     'medium',
        blindspots:     [],
        recommendation: '',
      };
    }
  }

  /**
   * Get formal advisory from AdvisorBot via a real LLM call.
   * Routes through OpenClaw's provider layer (anthropic provider, claude-opus-4-5).
   *
   * @param req     The advice request (requesterId, context, question).
   * @param taskId  Optional task ID — if provided, the session history for
   *                (req.requesterId, taskId) is included in the LLM context.
   */
  async advise(req: AdviceRequest, taskId?: string): Promise<AdviceResponse> {
    const model  = getModel(ALIENCLAW_PROVIDER, 'MiniMax-M2.5');
    const apiKey = getEnvApiKey(ALIENCLAW_PROVIDER);

    // Build user content — include session history when taskId is known
    let userContent: string;
    if (taskId) {
      const session = this.getOrCreateSession(req.requesterId, taskId);
      userContent   = this.buildContext(req, session);
    } else {
      userContent = `Context:\n${req.context}\n\nQuestion:\n${req.question}`;
    }

    const context: Context = {
      systemPrompt: this.soul,
      messages: [{
        role:      'user',
        content:   userContent,
        timestamp: Date.now(),
      }],
    };

    const response = await completeSimple(model, context, { apiKey });
    return this.parseResponse(extractText(response));
  }
}

export const advisorBot = new AdvisorBot();
