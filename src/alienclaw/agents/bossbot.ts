import { readFileSync }                             from 'fs';
import { join, dirname }                            from 'path';
import { fileURLToPath }                            from 'url';
import {
  completeSimple,
  getEnvApiKey,
  getModel,
  type AssistantMessage,
  type Context,
} from '@mariozechner/pi-ai';
import { AGENT_MODELS, ALIENCLAW_PROVIDER }         from '../constants.js';
import { extractText, normalizeInput, parseModelJson } from '../utils.js';
import type {
  TaskEnvelope, AdviceRequest, SubGoal,
  Scheme, Campaign, SubagentRole,
} from '../types.js';
import type { AgentChannel } from '../comms/agent-channel.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOUL_PATH  = join(__dirname, '..', 'prompts', 'bossbot.soul.md');

// ── Helpers ───────────────────────────────────────────────────────────────────

export function parseSubGoals(raw: string): SubGoal[] {
  return parseModelJson(
    raw,
    parsed => (parsed as Array<{
      description: string;
      domain?: string;
      dependsOn?: string[];
    }>).map(item => ({
      id:          crypto.randomUUID(),
      description: item.description,
      domain:      item.domain ?? 'general',
      status:      'pending' as const,
      dependsOn:   item.dependsOn ?? [],
    })),
    // Graceful fallback: treat raw text as a single sub-goal
    clean => [{
      id:          crypto.randomUUID(),
      description: clean.slice(0, 200),
      domain:      'general',
      status:      'pending',
      dependsOn:   [],
    }],
  );
}

// ── Scheme parser ─────────────────────────────────────────────────────────────

export function parseSchemeDraft(goalId: string, raw: string): Scheme {
  return parseModelJson(raw, (json) => {
    const parsed = json as {
      rationale: string;
      campaigns: Array<{
        name:        string;
        objective:   string;
        dependsOn?:  string[];
        subagents:   Array<{
          role:          string;
          domain:        string;
          knowledgeBase: string;
          martianTags?: string[];
        }>;
      }>;
    };

    const campaigns: Campaign[] = parsed.campaigns.map(c => ({
      id:          crypto.randomUUID(),
      name:        c.name,
      objective:   c.objective,
      dependsOn:   c.dependsOn ?? [],
      status:      'pending' as const,
      subagents:   c.subagents.map(s => ({
        role:          s.role,
        domain:        s.domain ?? 'general',
        knowledgeBase: s.knowledgeBase ?? '',
        martianTags:  s.martianTags ?? [],
      }) satisfies SubagentRole),
    }));

    // Resolve dependsOn: names → IDs
    const nameToId = new Map(campaigns.map(c => [c.name, c.id]));
    for (const campaign of campaigns) {
      campaign.dependsOn = campaign.dependsOn
        .map(dep => nameToId.get(dep) ?? dep)
        .filter(id => campaigns.some(c => c.id === id));
    }

    return {
      goalId,
      rationale:          parsed.rationale ?? '',
      campaigns,
      advisorEndorsement: '',
      createdAt:          Date.now(),
    };
  },
  // Graceful fallback — single campaign, single generalist role
  clean => ({
    goalId,
    rationale: 'LLM produced non-JSON output; falling back to single-campaign scheme.',
    campaigns: [{
      id:          crypto.randomUUID(),
      name:        'Main Campaign',
      objective:   clean.slice(0, 200),
      dependsOn:   [],
      status:      'pending',
      subagents:   [{
        role:          'Generalist',
        domain:        'general',
        knowledgeBase: '',
        martianTags:   ['web_search', 'file_read', 'file_write'],
      }],
    }],
    advisorEndorsement: '',
    createdAt:          Date.now(),
  }));
}

// ── BossBot ───────────────────────────────────────────────────────────────────

export class BossBot {
  readonly name  = 'BossBot' as const;
  readonly model = AGENT_MODELS.BossBot;
  readonly soul  = readFileSync(SOUL_PATH, 'utf-8');

  systemPrompt(): string {
    return this.soul;
  }

  buildTask(
    description: string,
    domain: string,
    priority: TaskEnvelope['priority'] = 'normal',
    campaignId?: string,
  ): TaskEnvelope {
    return {
      taskId:      crypto.randomUUID(),
      description,
      domain,
      priority,
      createdAt:   Date.now(),
      strikeCount: 0,
      attempts:    [],
      campaignId,
    };
  }

  /**
   * Run one LLM round-trip: soul + task section as system prompt, a single
   * user message, plain text back. Shared shell for all BossBot LLM calls.
   */
  private async ask(section: string, userContent: string): Promise<string> {
    const model  = getModel(ALIENCLAW_PROVIDER, AGENT_MODELS.BossBot);
    const apiKey = getEnvApiKey(ALIENCLAW_PROVIDER);
    const context: Context = {
      systemPrompt: `${this.soul}\n\n${section}`,
      messages: [{
        role:      'user',
        content:   userContent,
        timestamp: Date.now(),
      }],
    };
    const response = await completeSimple(model, context, { apiKey });
    return extractText(response);
  }

  /**
   * Classify mid-execution user input into one of three categories.
   */
  async classifyUserInput(
    input: string
  ): Promise<'new_subgoal' | 'constraint' | 'direction_change'> {
    const text = await this.ask(
      `## Classify User Input\n` +
      `Classify the user message as exactly one of:\n` +
      `- new_subgoal: user is adding new work to the plan\n` +
      `- constraint: user is adding a restriction (don't do X, must use Y)\n` +
      `- direction_change: user wants to change approach or reprioritize\n\n` +
      `Respond with exactly one word. No punctuation. No explanation.`,
      `Classify this input:\n${input}`,
    );
    const raw = normalizeInput(text);
    if (raw.includes('constraint'))        return 'constraint';
    if (raw.includes('direction_change'))  return 'direction_change';
    return 'new_subgoal';
  }

  /**
   * Draft a Scheme (campaign plan) for a goal description.
   *
   * BossBot produces a full campaign breakdown: what campaigns are needed,
   * what Subagent roles each campaign requires, and what Martian tags
   * each subagent will use. This is then handed to AdvisorBot for review
   * before being finalised in schemeWithAdvisor().
   */
  async draftScheme(goalId: string, goalDescription: string): Promise<Scheme> {
    const text = await this.ask(
      `## Scheme Planning\n` +
        `You are designing a Scheme — a full campaign plan to achieve a goal.\n` +
        `A Scheme contains Campaigns. Each Campaign has a name, objective, dependency edges,\n` +
        `and a list of Subagent roles (each with a domain, knowledge base, and Martian tags).\n\n` +
        `Respond ONLY with a valid JSON object matching this schema — no prose, no markdown fences:\n` +
        `{\n` +
        `  "rationale": "string",\n` +
        `  "campaigns": [\n` +
        `    {\n` +
        `      "name": "string",\n` +
        `      "objective": "string",\n` +
        `      "dependsOn": [],\n` +
        `      "subagents": [\n` +
        `        {\n` +
        `          "role": "string",\n` +
        `          "domain": "string",\n` +
        `          "knowledgeBase": "string",\n` +
        `          "martianTags": ["string"]\n` +
        `        }\n` +
        `      ]\n` +
        `    }\n` +
        `  ]\n` +
        `}\n\n` +
        `Valid domain tags: analysis, implementation, testing, research, writing, configuration, review.\n` +
        `Valid martianTags: web_search, url_fetch, file_read, file_write (or any registered tool tag).\n` +
        `Set dependsOn to [] for campaigns that can start immediately in parallel.\n` +
        `Campaigns that depend on others must list those campaign names in dependsOn.`,
      `Draft a Scheme for this goal:\n\n${goalDescription}`,
    );
    return parseSchemeDraft(goalId, text);
  }

  /**
   * Iterate with AdvisorBot to produce a finalised Scheme.
   *
   * BossBot drafts → AdvisorBot critiques → BossBot refines.
   * Up to maxRounds of iteration; returns the agreed Scheme with AdvisorBot's endorsement.
   *
   * @param goalId          - The Goal ID this Scheme belongs to
   * @param goalDescription - The original user goal description
   * @param advisorBot      - AdvisorBot instance to consult
   * @param agentChannel    - AgentChannel for inter-agent audit log
   * @param maxRounds       - Maximum back-and-forth iterations (default 2)
   */
  async schemeWithAdvisor(
    goalId:          string,
    goalDescription: string,
    advisorBot:      { advise(req: AdviceRequest, sessionId?: string): Promise<{ verdict: string; recommendation: string; confidence: string }> },
    agentChannel:    AgentChannel,
    maxRounds        = 2,
  ): Promise<Scheme> {
    let scheme = await this.draftScheme(goalId, goalDescription);

    for (let round = 0; round < maxRounds; round++) {
      const adviceReq: AdviceRequest = {
        requesterId: 'BossBot',
        context:
          `Goal: "${goalDescription}"\n\n` +
          `Proposed Scheme (round ${round + 1}):\n` +
          `Rationale: ${scheme.rationale}\n` +
          `Campaigns:\n` +
          scheme.campaigns.map((c, i) =>
            `  ${i + 1}. ${c.name}: ${c.objective}\n` +
            `     Subagents: ${c.subagents.map(s => s.role).join(', ')}\n` +
            `     Depends on: ${c.dependsOn.join(', ') || 'none'}`
          ).join('\n'),
        question:
          'Does this campaign breakdown cover all the work needed? ' +
          'Are there missing campaigns, roles, or dependency gaps? ' +
          'What should be changed?',
      };

      const advice = await advisorBot.advise(adviceReq, goalId);

      // Route through AgentChannel for the structural audit log (Rule 5)
      agentChannel.send({
        from: 'BossBot', to: 'AdvisorBot', kind: 'request',
        content: adviceReq.question, ts: Date.now(), taskId: goalId,
      });
      agentChannel.send({
        from: 'AdvisorBot', to: 'BossBot', kind: 'response',
        content: advice.verdict, ts: Date.now(), taskId: goalId,
      });

      // If AdvisorBot is confident and has no significant changes, we're done
      if (advice.confidence === 'high' && !normalizeInput(advice.recommendation).includes('should')) {
        return {
          ...scheme,
          advisorEndorsement: advice.verdict,
        };
      }

      // Refine based on advice
      const refined = await this.refineSchemeDraft(goalId, goalDescription, scheme, advice.recommendation);
      scheme = {
        ...refined,
        advisorEndorsement: round === maxRounds - 1 ? advice.verdict : '',
      };
    }

    return scheme;
  }

  /**
   * Refine a Scheme draft based on AdvisorBot feedback.
   * Internal helper called during schemeWithAdvisor iteration.
   */
  private async refineSchemeDraft(
    goalId:          string,
    goalDescription: string,
    current:         Scheme,
    feedback:        string
  ): Promise<Scheme> {
    const text = await this.ask(
      `## Scheme Refinement\n` +
      `You are refining a campaign Scheme based on AdvisorBot feedback.\n` +
      `Respond ONLY with the revised JSON object (same schema as before) — no prose, no fences.`,
      `Goal: "${goalDescription}"\n\n` +
      `Current Scheme:\n${JSON.stringify(current, null, 2)}\n\n` +
      `AdvisorBot feedback:\n${feedback}\n\n` +
      `Produce a revised Scheme that addresses this feedback.`,
    );
    return parseSchemeDraft(goalId, text);
  }

  /**
   * Generate sub-goals from a user input string (new_subgoal or direction_change path).
   */
  async generateSubGoals(input: string): Promise<SubGoal[]> {
    const text = await this.ask(
      `## Generate Sub-Goals\n` +
      `Given user input, generate the sub-goals it implies.\n` +
      `Respond ONLY with a JSON array — no prose, no markdown fences.\n` +
      `Schema: [{"description":"string","domain":"string","dependsOn":[]}]`,
      `Generate sub-goals for:\n\n${input}`,
    );
    return parseSubGoals(text);
  }
}

export const bossBot = new BossBot();
