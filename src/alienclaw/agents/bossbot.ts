import { readFileSync }                             from 'fs';
import { join, dirname }                            from 'path';
import { fileURLToPath }                            from 'url';
import {
  completeSimple,
  getEnvApiKey,
  getModel,
  type AssistantMessage,
  type Context,
  type TextContent,
} from '@mariozechner/pi-ai';
import { AGENT_MODELS, ALIENCLAW_PROVIDER }         from '../constants.js';
import type { TaskEnvelope, AdviceRequest, SubGoal } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOUL_PATH  = join(__dirname, '..', 'prompts', 'bossbot.soul.md');

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractText(msg: AssistantMessage): string {
  return (msg.content as Array<{ type: string; text?: string }>)
    .filter((c): c is TextContent => c.type === 'text')
    .map(c => c.text)
    .join('');
}

function parseSubGoals(raw: string): SubGoal[] {
  // Strip markdown code fences the LLM may add
  const clean = raw.replace(/```(?:json)?\n?/g, '').trim();
  try {
    const parsed = JSON.parse(clean) as Array<{
      description: string;
      domain?: string;
      dependsOn?: string[];
    }>;
    return parsed.map(item => ({
      id:          crypto.randomUUID(),
      description: item.description,
      domain:      item.domain ?? 'general',
      status:      'pending' as const,
      dependsOn:   item.dependsOn ?? [],
    }));
  } catch {
    // Graceful fallback: treat raw text as a single sub-goal
    return [{
      id:          crypto.randomUUID(),
      description: clean.slice(0, 200),
      domain:      'general',
      status:      'pending',
      dependsOn:   [],
    }];
  }
}

// ── BossBot ───────────────────────────────────────────────────────────────────

export class BossBot {
  readonly name  = 'BossBot' as const;
  readonly model = AGENT_MODELS.BossBot;
  readonly soul  = readFileSync(SOUL_PATH, 'utf-8');

  systemPrompt(): string {
    return this.soul;
  }

  buildAdviceRequest(context: string, question: string): AdviceRequest {
    return { requesterId: 'BossBot', context, question };
  }

  buildTask(
    description: string,
    domain: string,
    priority: TaskEnvelope['priority'] = 'normal'
  ): TaskEnvelope {
    return {
      taskId:      crypto.randomUUID(),
      description,
      domain,
      priority,
      createdAt:   Date.now(),
      strikeCount: 0,
      attempts:    [],
    };
  }

  /**
   * Decompose a goal description into ordered sub-goals via a real LLM call.
   * Routes through OpenClaw's provider layer (anthropic provider, claude-opus-4-5).
   */
  async decompose(goalDescription: string): Promise<SubGoal[]> {
    const model  = getModel(ALIENCLAW_PROVIDER, AGENT_MODELS.BossBot as 'MiniMax-M2.5');
    const apiKey = getEnvApiKey(ALIENCLAW_PROVIDER);
    const context: Context = {
      systemPrompt:
        `${this.soul}\n\n` +
        `## Decompose Task\n` +
        `Decompose the user goal into sub-goals.\n` +
        `Respond ONLY with a JSON array — no prose, no markdown fences.\n` +
        `Schema: [{"description":"string","domain":"string","dependsOn":[]}]\n` +
        `Use short domain tags: analysis, implementation, testing, research, writing, configuration.\n` +
        `Set dependsOn to [] for sub-goals that can start immediately in parallel.`,
      messages: [{
        role:      'user',
        content:   `Decompose this goal into sub-goals:\n\n${goalDescription}`,
        timestamp: Date.now(),
      }],
    };
    const response = await completeSimple(model, context, { apiKey });
    return parseSubGoals(extractText(response));
  }

  /**
   * Classify mid-execution user input into one of three categories.
   */
  async classifyUserInput(
    input: string
  ): Promise<'new_subgoal' | 'constraint' | 'direction_change'> {
    const model  = getModel(ALIENCLAW_PROVIDER, AGENT_MODELS.BossBot as 'MiniMax-M2.5');
    const apiKey = getEnvApiKey(ALIENCLAW_PROVIDER);
    const context: Context = {
      systemPrompt:
        `${this.soul}\n\n` +
        `## Classify User Input\n` +
        `Classify the user message as exactly one of:\n` +
        `- new_subgoal: user is adding new work to the plan\n` +
        `- constraint: user is adding a restriction (don't do X, must use Y)\n` +
        `- direction_change: user wants to change approach or reprioritize\n\n` +
        `Respond with exactly one word. No punctuation. No explanation.`,
      messages: [{
        role:      'user',
        content:   `Classify this input:\n${input}`,
        timestamp: Date.now(),
      }],
    };
    const response = await completeSimple(model, context, { apiKey });
    const raw = extractText(response).trim().toLowerCase();
    if (raw.includes('constraint'))        return 'constraint';
    if (raw.includes('direction_change'))  return 'direction_change';
    return 'new_subgoal';
  }

  /**
   * Generate sub-goals from a user input string (new_subgoal or direction_change path).
   */
  async generateSubGoals(input: string): Promise<SubGoal[]> {
    const model  = getModel(ALIENCLAW_PROVIDER, AGENT_MODELS.BossBot as 'MiniMax-M2.5');
    const apiKey = getEnvApiKey(ALIENCLAW_PROVIDER);
    const context: Context = {
      systemPrompt:
        `${this.soul}\n\n` +
        `## Generate Sub-Goals\n` +
        `Given user input, generate the sub-goals it implies.\n` +
        `Respond ONLY with a JSON array — no prose, no markdown fences.\n` +
        `Schema: [{"description":"string","domain":"string","dependsOn":[]}]`,
      messages: [{
        role:      'user',
        content:   `Generate sub-goals for:\n\n${input}`,
        timestamp: Date.now(),
      }],
    };
    const response = await completeSimple(model, context, { apiKey });
    return parseSubGoals(extractText(response));
  }
}

export const bossBot = new BossBot();
