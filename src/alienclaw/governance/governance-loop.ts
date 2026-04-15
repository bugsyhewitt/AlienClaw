import { sleep, errorMessage, normalizeInput } from '../utils.js';
import { EMPLOYEE_DEFAULT_MODEL, MAX_STRIKE_COUNT } from '../constants.js';
import type {
  GovernanceState, GovernanceEvent, TransitionHook,
  Goal, SubGoal, Campaign,
} from '../types.js';
import type { BossBot }    from '../agents/bossbot.js';
import type { AdvisorBot } from '../agents/advisorbot.js';
import type { CreatorBot } from '../agents/creatorbot.js';
import type { AgentRegistry } from '../agents/agent-registry.js';
import { buildEmployee, disposeCampaign } from '../agents/employee.js';
import type { Employee }       from '../agents/employee.js';
import type { GoalManager }        from './goal-manager.js';
import type { TaskManager }        from './task-manager.js';
import type { EscalationHandler }  from './escalation-handler.js';
import type { CompletionHandler }  from './completion-handler.js';
import type { UserChannel }        from '../comms/user-channel.js';

// ── Valid state transitions ───────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<GovernanceState, GovernanceState[]> = {
  IDLE:                  ['SCHEMING', 'CREATOR_BUILDING'],
  SCHEMING:              ['CREATOR_BUILDING', 'AWAITING_ADVICE'],
  DECOMPOSING:           ['EXECUTING', 'AWAITING_ADVICE'],
  CREATOR_BUILDING:      ['EXECUTING'],
  EXECUTING:             ['AWAITING_ADVICE', 'CREATOR_BUILDING', 'CREATOR_INTERRUPT',
                          'AWAITING_USER_INPUT', 'REVIEWING_COMPLETION'],
  AWAITING_ADVICE:       ['EXECUTING', 'CREATOR_BUILDING', 'DECOMPOSING', 'SCHEMING'],
  CREATOR_INTERRUPT:     ['EXECUTING', 'AWAITING_ADVICE'],
  AWAITING_USER_INPUT:   ['EXECUTING', 'COMPLETE'],
  REVIEWING_COMPLETION:  ['AWAITING_USER_SIGNOFF'],
  AWAITING_USER_SIGNOFF: ['COMPLETE', 'EXECUTING'],
  COMPLETE:              ['IDLE'],
  ESCALATED:             ['IDLE'],
};

// ── Deps ──────────────────────────────────────────────────────────────────────

export interface GovernanceLoopDeps {
  bossBot:            BossBot;
  advisorBot:         AdvisorBot;
  creatorBot:         CreatorBot;
  agentRegistry:      AgentRegistry;
  goalManager:        GoalManager;
  taskManager:        TaskManager;
  escalationHandler:  EscalationHandler;
  completionHandler:  CompletionHandler;
  userChannel:        UserChannel;
}

// ── GovernanceLoop ────────────────────────────────────────────────────────────

export class GovernanceLoop {
  private state:         GovernanceState = 'IDLE';
  private currentGoalId: string | null   = null;
  /** Bounded event queue — oldest events dropped when limit is exceeded. */
  private eventQueue:    GovernanceEvent[] = [];

  private static readonly EVENT_QUEUE_LIMIT = 200;

  /**
   * Active jobs: campaignId → running Promise tracking the campaign's
   * specialist work (one entry per active campaign).
   */
  private activeJobs     = new Map<string, Promise<void>>();

  /** subGoalId → Promise for legacy/fallback sub-goal dispatch */
  private legacyJobs     = new Map<string, Promise<void>>();

  private transitionHooks: TransitionHook[] = [];
  private running         = false;

  private readonly bossBot:           BossBot;
  private readonly advisorBot:        AdvisorBot;
  private readonly creatorBot:        CreatorBot;
  private readonly agentRegistry:     AgentRegistry;
  private readonly goalManager:       GoalManager;
  private readonly taskManager:       TaskManager;
  private readonly escalationHandler: EscalationHandler;
  private readonly completionHandler: CompletionHandler;
  private readonly userChannel:       UserChannel;

  constructor(deps: GovernanceLoopDeps) {
    this.bossBot           = deps.bossBot;
    this.advisorBot        = deps.advisorBot;
    this.creatorBot        = deps.creatorBot;
    this.agentRegistry     = deps.agentRegistry;
    this.goalManager       = deps.goalManager;
    this.taskManager       = deps.taskManager;
    this.escalationHandler = deps.escalationHandler;
    this.completionHandler = deps.completionHandler;
    this.userChannel       = deps.userChannel;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  addTransitionHook(hook: TransitionHook): void {
    this.transitionHooks.push(hook);
  }

  submitGoal(description: string): void {
    this.pushEvent({ type: 'USER_GOAL', description });
  }

  submitUserInput(message: string): void {
    this.pushEvent({ type: 'USER_INPUT', message });
  }

  async start(): Promise<void> {
    this.running = true;
    await this.recoverFromDisk();
    await this.drain();
    this.userChannel.close();
  }

  stop(): void {
    this.running = false;
  }

  async resumeGoal(goalId: string): Promise<void> {
    const file = this.goalManager.load();
    const goal = file.goals.find(g => g.id === goalId);
    if (!goal) return;

    this.userChannel.required(`Resuming goal: "${goal.description}"`);

    if (goal.scheme) {
      // Scheme-based goal: reset any active campaigns to pending (mutate in-memory, single save)
      let dirty = false;
      for (const c of goal.scheme.campaigns) {
        if (c.status === 'active') { c.status = 'pending'; dirty = true; }
      }
      if (dirty) await this.goalManager.save(file);
    } else {
      // Legacy sub-goal goal
      let dirty = false;
      for (const sg of goal.subGoals) {
        if (sg.status === 'active') { sg.status = 'pending'; sg.taskId = undefined; dirty = true; }
      }
      if (dirty) await this.goalManager.save(file);
    }

    this.currentGoalId = goalId;
    this.transition('CREATOR_BUILDING', 'Crash recovery — rebuilding from plan');

    // Rebuild specialists so campaign specialistIds are populated
    if (goal.scheme) {
      const specialistMap = this.creatorBot.buildSchemeSpecialists(goal.scheme);
      for (const specialists of specialistMap.values()) {
        for (const s of specialists) this.agentRegistry.registerEmployee(s);
      }
      await this.goalManager.attachScheme(goalId, goal.scheme);
    }

    this.transition('EXECUTING', 'Crash recovery — dispatching ready campaigns');
    await this.dispatchReadyCampaigns(goalId);
  }

  // ── State machine ──────────────────────────────────────────────────────────

  private transition(to: GovernanceState, reason: string): void {
    const allowed = VALID_TRANSITIONS[this.state];
    if (!allowed.includes(to)) {
      throw new Error(
        `[GovernanceLoop] Invalid transition: ${this.state} → ${to} (${reason})`
      );
    }
    const from = this.state;
    this.state = to;
    this.userChannel.verbose(`State: ${from} → ${to} | ${reason}`);
    for (const hook of this.transitionHooks) hook(from, to, reason);
  }

  // ── Event loop ─────────────────────────────────────────────────────────────

  private pushEvent(event: GovernanceEvent): void {
    if (this.eventQueue.length >= GovernanceLoop.EVENT_QUEUE_LIMIT) {
      // Drop oldest — ring-buffer behavior prevents unbounded memory growth
      this.eventQueue.shift();
    }
    this.eventQueue.push(event);
  }

  private async drain(): Promise<void> {
    while (this.running) {
      await this.checkUrgentQueue();

      if (this.eventQueue.length > 0) {
        const event = this.eventQueue.shift()!;
        await this.processEvent(event);
      } else {
        await sleep(50);
      }
    }
  }

  private async processEvent(event: GovernanceEvent): Promise<void> {
    switch (event.type) {
      case 'USER_GOAL':
        await this.handleUserGoal(event.description);
        break;
      case 'USER_INPUT':
        await this.handleUserInput(event.message);
        break;
      case 'CAMPAIGN_READY':
        // Fired when a dependency completes and a blocked campaign becomes ready
        await this.dispatchReadyCampaigns(event.goalId);
        break;
      case 'JOB_COMPLETE':
        await this.handleJobComplete(event);
        break;
      case 'JOB_FAILED':
        await this.handleJobFailed(event);
        break;
    }
  }

  // ── New goal: SCHEMING phase ────────────────────────────────────────────────

  private async handleUserGoal(description: string): Promise<void> {
    if (this.state !== 'IDLE') {
      this.userChannel.status(`New input while goal is active — folding into plan.`);
      await this.handleUserInput(description);
      return;
    }

    this.userChannel.status(`New goal received: "${description}"`);
    this.transition('SCHEMING', 'User submitted goal — BossBot + AdvisorBot scheming');

    // ── BossBot + AdvisorBot iterate on a Scheme ─────────────────────────────
    const goalId = crypto.randomUUID();
    const scheme = await this.bossBot.schemeWithAdvisor(
      goalId,
      description,
      this.advisorBot,
      2  // max 2 rounds of iteration
    );

    this.userChannel.verbose(
      `Scheme agreed: ${scheme.campaigns.length} campaign(s)\n` +
      scheme.campaigns.map((c, i) =>
        `  ${i + 1}. ${c.name}: ${c.objective} ` +
        `(${c.specialists.length} specialist(s))`
      ).join('\n')
    );
    this.userChannel.verbose(
      `AdvisorBot endorsement: ${scheme.advisorEndorsement || '(none recorded)'}`
    );

    // Persist goal with Scheme attached
    const goal: Goal = {
      id:          goalId,
      description,
      subGoals:    [],   // Scheme-based goals use campaigns instead
      status:      'active',
      createdAt:   Date.now(),
      scheme,
    };
    await this.goalManager.addGoal(goal);
    this.currentGoalId = goalId;

    // ── CreatorBot builds all specialists ─────────────────────────────────────
    this.transition('CREATOR_BUILDING',
      `CreatorBot building ${scheme.campaigns.reduce((n, c) => n + c.specialists.length, 0)} specialist(s)`
    );

    const specialistMap = this.creatorBot.buildSchemeSpecialists(scheme);

    // Register all specialists in the agent registry
    for (const specialists of specialistMap.values()) {
      for (const s of specialists) {
        this.agentRegistry.registerEmployee(s);
      }
    }

    // Note: goal already persisted via addGoal above with scheme attached.
    // buildSchemeSpecialists mutates campaign.specialistIds in-place on the
    // same scheme object, so the in-memory goal is already correct.

    this.userChannel.status(
      `All specialists built. Dispatching ready campaigns.`
    );
    this.transition('EXECUTING', 'Specialists ready — dispatching campaigns');
    await this.dispatchReadyCampaigns(goalId);
  }

  // ── Campaign dispatch ──────────────────────────────────────────────────────

  /**
   * Dispatch all campaigns whose dependencies are satisfied.
   * Each campaign's specialists collectively execute tasks; the campaign
   * is complete when all tasks return SUCCESS.
   */
  private async dispatchReadyCampaigns(goalId: string): Promise<void> {
    const file  = this.goalManager.load();
    const ready = this.goalManager.getReadyCampaigns(file, goalId);

    // Dispatch all ready campaigns in parallel
    const toSpawn = ready.filter(c => !this.activeJobs.has(c.id));
    if (toSpawn.length > 0) {
      await Promise.all(toSpawn.map(c => this.spawnCampaign(goalId, c)));
      this.userChannel.verbose(
        `Dispatched ${toSpawn.length} campaign(s) in parallel: ` +
        toSpawn.map(c => `"${c.name}"`).join(', ')
      );
    }
  }

  /**
   * Run a campaign by dispatching a task to each of its specialists.
   * The campaign succeeds when all specialist tasks return SUCCESS.
   */
  private async spawnCampaign(goalId: string, campaign: Campaign): Promise<void> {
    await this.goalManager.updateCampaign(goalId, campaign.id, { status: 'active' });
    this.userChannel.status(
      `Campaign started: "${campaign.name}" — ${campaign.objective}`
    );

    // Build specialist task envelopes
    const specialists = (campaign.specialistIds ?? [])
      .map(id => this.agentRegistry.getEmployee(id))
      .filter((s): s is Employee => s !== undefined);

    if (specialists.length === 0) {
      // No specialists found — may happen on crash recovery; escalate
      this.userChannel.required(
        `Campaign "${campaign.name}" has no built specialists. Escalating.`
      );
      await this.goalManager.updateCampaign(goalId, campaign.id, { status: 'failed' });
      return;
    }

    // Each specialist gets a task scoped to the campaign objective
    const taskPromises = specialists.map(specialist => {
      const task = this.bossBot.buildTask(
        `[Campaign: ${campaign.name}] ${campaign.objective}`,
        specialist.domain,
        'normal'
      );
      this.taskManager.register(task);
      this.taskManager.assign(task.taskId, specialist.id);

      return specialist.executeTask(task).then(result => ({
        specialistId: specialist.id,
        task,
        result,
      }));
    });

    const campaignJob: Promise<void> = Promise.all(taskPromises)
      .then(async results => {
        const failed = results.filter(r => r.result.outcome !== 'SUCCESS');

        if (failed.length === 0) {
          // Campaign complete
          await this.goalManager.updateCampaign(goalId, campaign.id, { status: 'complete' });
          this.userChannel.status(`Campaign complete: "${campaign.name}"`);

          // Dispose campaign specialists — their work is done
          disposeCampaign(campaign.id);

          this.pushEvent({ type: 'JOB_COMPLETE',
            subGoalId: campaign.id, goalId,
            result: {
              taskId:     campaign.id,
              employeeId: campaign.name,
              outcome:    'SUCCESS',
              summary:    `Campaign "${campaign.name}" completed successfully.`,
              ts:         Date.now(),
            },
          });
        } else {
          // At least one specialist failed — surface as campaign failure
          const reasons = failed.map(f =>
            `${f.specialistId}: ${f.result.failureReason ?? 'unknown'}`
          ).join('; ');
          this.pushEvent({ type: 'JOB_FAILED',
            subGoalId: campaign.id, goalId,
            error: `Campaign "${campaign.name}" failed: ${reasons}`,
          });
        }
      })
      .catch(err => {
        this.pushEvent({
          type: 'JOB_FAILED',
          subGoalId: campaign.id,
          goalId,
          error: `Campaign "${campaign.name}" threw: ${errorMessage(err)}`,
        });
      })
      .finally(() => {
        this.activeJobs.delete(campaign.id);
      });

    this.activeJobs.set(campaign.id, campaignJob);
  }

  // ── Campaign vs legacy sub-goal ID resolution ───────────────────────────────

  /** Returns true if `subGoalId` refers to a campaign (not a legacy sub-goal). */
  private isCampaignSubGoal(file: ReturnType<GoalManager['load']>, subGoalId: string): boolean {
    for (const goal of file.goals) {
      if (goal.scheme?.campaigns.some(c => c.id === subGoalId)) return true;
    }
    return false;
  }

  // ── JOB_COMPLETE / JOB_FAILED ─────────────────────────────────────────────

  private async handleJobComplete(
    event: GovernanceEvent & { type: 'JOB_COMPLETE' }
  ): Promise<void> {
    // Determine if this was a campaign or legacy sub-goal
    const file = this.goalManager.load();
    const goal = file.goals.find(g => g.id === event.goalId);

    const isCampaign = this.isCampaignSubGoal(file, event.subGoalId);

    if (isCampaign) {
      this.userChannel.status(
        `Campaign complete: "${event.result.summary}"`
      );

      // Check if all campaigns done
      if (this.goalManager.isSchemeComplete(file, event.goalId)) {
        await this.runCompletionFlow(event.goalId);
      } else {
        // Unblock next campaigns
        this.pushEvent({ type: 'CAMPAIGN_READY', goalId: event.goalId, campaignId: event.subGoalId });
      }
    } else {
      // Legacy sub-goal completion
      await this.goalManager.updateSubGoal(event.goalId, event.subGoalId, { status: 'complete' });
      const subGoal = goal?.subGoals.find(s => s.id === event.subGoalId);
      if (subGoal?.taskId) {
        this.advisorBot.destroyTaskSessions(subGoal.taskId);
        this.taskManager.deregister(subGoal.taskId);
      }
      this.userChannel.status(`Sub-goal complete: "${subGoal?.description ?? event.subGoalId}"`);

      if (this.goalManager.isGoalComplete(file, event.goalId)) {
        await this.runCompletionFlow(event.goalId);
      } else {
        await this.dispatchReadySubGoals(event.goalId);
      }
    }
  }

  private async handleJobFailed(
    event: GovernanceEvent & { type: 'JOB_FAILED' }
  ): Promise<void> {
    const file = this.goalManager.load();
    const goal = file.goals.find(g => g.id === event.goalId);

    const isCampaign = this.isCampaignSubGoal(file, event.subGoalId);

    if (isCampaign) {
      const campaign = goal!.scheme!.campaigns.find(c => c.id === event.subGoalId);
      this.userChannel.required(
        `Campaign failed: "${campaign?.name ?? event.subGoalId}" — ${event.error}`
      );

      this.transition('AWAITING_ADVICE', 'Campaign failure — consulting AdvisorBot');
      const adviceReq = {
        requesterId: 'BossBot' as const,
        context:     `Campaign "${campaign?.name}" failed: ${event.error}`,
        question:    'Should we rebuild specialists and retry, or surface to the user?',
      };
      const advice = await this.advisorBot.advise(adviceReq, event.goalId);
      this.userChannel.verbose(`AdvisorBot on campaign failure: ${advice.verdict}`);

      if (normalizeInput(advice.recommendation).includes('user') ||
          advice.confidence === 'low') {
        // Surface to user
        this.transition('AWAITING_USER_INPUT', 'Campaign failure — surfacing to user');
        this.userChannel.required(
          `Campaign "${campaign?.name}" failed and needs your attention.\n` +
          `Error: ${event.error}\n` +
          `AdvisorBot: ${advice.verdict}`
        );
      } else {
        // Rebuild specialists and retry
        this.transition('CREATOR_BUILDING', `Rebuilding campaign "${campaign?.name}"`);
        await this.goalManager.updateCampaign(event.goalId, event.subGoalId, { status: 'pending' });
        // Re-build specialists for the campaign
        if (campaign && goal?.scheme) {
          const newMap = this.creatorBot.buildSchemeSpecialists(
            { ...goal.scheme, campaigns: [campaign] }
          );
          for (const specialists of newMap.values()) {
            for (const s of specialists) this.agentRegistry.registerEmployee(s);
          }
        }
        this.transition('EXECUTING', `Campaign "${campaign?.name}" rebuilt — retrying`);
        await this.dispatchReadyCampaigns(event.goalId);
      }
      return;
    }

    // Legacy sub-goal failure path (preserved from Phase 2B)
    const subGoal = goal?.subGoals.find(s => s.id === event.subGoalId);
    if (!subGoal?.taskId) return;
    const task = this.taskManager.get(subGoal.taskId);
    if (!task) return;

    this.userChannel.status(
      `Sub-goal failed (strike ${task.strikeCount + 1}): "${subGoal.description}"`
    );

    const willBeExhausted = (task.strikeCount + 1) >= MAX_STRIKE_COUNT;
    if (!willBeExhausted) {
      this.transition('AWAITING_ADVICE', `Strike ${task.strikeCount + 1} — consulting AdvisorBot`);
    }

    const strikeAction = await this.escalationHandler.handleFailure(
      task, subGoal.domain, subGoal.domain ? [subGoal.domain] : [],
      event.error, task.taskId,
    );

    if (strikeAction.action === 'SURFACE_USER') {
      this.transition('AWAITING_USER_INPUT', `Strike ${task.strikeCount} — surfacing to user`);
      const userResp = await this.escalationHandler.handleStrikeThree(task);

      if (userResp.outcome === 'abandon') {
        await this.goalManager.updateSubGoal(event.goalId, event.subGoalId, { status: 'failed' });
        this.taskManager.deregister(task.taskId);
        this.userChannel.required(`Sub-goal abandoned: "${subGoal.description}"`);
        this.transition('EXECUTING', 'User abandoned task — continuing with others');
        await this.dispatchReadySubGoals(event.goalId);
      } else if (userResp.outcome === 'resume_budget') {
        this.taskManager.resetStrikes(task.taskId, userResp.budget);
        await this.goalManager.updateSubGoal(event.goalId, event.subGoalId, {
          status: 'pending', taskId: undefined,
        });
        this.taskManager.deregister(task.taskId);
        this.transition('EXECUTING', 'User extended retry budget');
        await this.dispatchReadySubGoals(event.goalId);
      } else {
        this.taskManager.resetStrikes(task.taskId);
        await this.goalManager.updateSubGoal(event.goalId, event.subGoalId, {
          status:      'pending',
          description: `${subGoal.description} [User: ${userResp.instructions}]`,
          taskId:      undefined,
        });
        this.taskManager.deregister(task.taskId);
        this.transition('EXECUTING', 'User provided new instructions');
        await this.dispatchReadySubGoals(event.goalId);
      }
    } else {
      this.transition('CREATOR_BUILDING', `Building generation-${strikeAction.spec.generation} employee`);
      const newEmployee = buildEmployee(strikeAction.spec);
      this.agentRegistry.registerEmployee(newEmployee);
      this.taskManager.assign(task.taskId, newEmployee.name);
      this.transition('EXECUTING', `New employee ${newEmployee.name} dispatched`);

      const job = newEmployee.executeTask(task)
        .then(result => {
          this.pushEvent({ type: 'JOB_COMPLETE', subGoalId: event.subGoalId, goalId: event.goalId, result });
        })
        .catch((err: unknown) => {
          this.pushEvent({ type: 'JOB_FAILED', subGoalId: event.subGoalId, goalId: event.goalId, error: errorMessage(err) });
        });
      this.legacyJobs.set(event.subGoalId, job);
    }
  }

  // ── User input mid-execution ───────────────────────────────────────────────

  private async handleUserInput(message: string): Promise<void> {
    if (!this.currentGoalId || this.state === 'IDLE') {
      await this.handleUserGoal(message);
      return;
    }

    this.userChannel.status(`Folding user input into active plan.`);
    const classification = await this.bossBot.classifyUserInput(message);
    this.userChannel.verbose(`Input classified as: ${classification}`);

    if (classification === 'new_subgoal') {
      const newSubs = await this.bossBot.generateSubGoals(message);
      await this.goalManager.foldUserInput(this.currentGoalId, newSubs);
      this.userChannel.status(`Added ${newSubs.length} sub-goal(s) to the plan.`);
      await this.dispatchReadySubGoals(this.currentGoalId);
    } else if (classification === 'constraint') {
      this.userChannel.status(`Constraint noted. Will inform active specialists (next iteration).`);
    } else {
      const newSubs = await this.bossBot.generateSubGoals(message);
      await this.goalManager.foldUserInput(this.currentGoalId, newSubs);
      await this.dispatchReadySubGoals(this.currentGoalId);
    }
  }

  // ── Completion flow ────────────────────────────────────────────────────────

  private async runCompletionFlow(goalId: string): Promise<void> {
    const notable = this.creatorBot.flushNotable();
    if (notable.length > 0) {
      this.userChannel.verbose(
        `CreatorBot notable items:\n${notable.map(i => `  - ${i.observation}`).join('\n')}`
      );
    }

    this.transition('REVIEWING_COMPLETION', 'All campaigns complete — reviewing with AdvisorBot');
    const review = await this.completionHandler.review(goalId);

    if (!review.proceed) {
      const file = this.goalManager.load();
      const goal = file.goals.find(g => g.id === goalId);
      for (const id of review.reopenIds) {
        // reopenIds may be campaign IDs or legacy subGoalIds
        const isCampaign = goal?.scheme?.campaigns.some(c => c.id === id);
        if (isCampaign) {
          await this.goalManager.updateCampaign(goalId, id, { status: 'pending' });
        } else {
          await this.goalManager.updateSubGoal(goalId, id, { status: 'pending', taskId: undefined });
        }
      }
      this.userChannel.status(`AdvisorBot flagged gaps. Re-opening ${review.reopenIds.length} item(s).`);
      this.transition('AWAITING_ADVICE', 'AdvisorBot flagged gaps');
      this.transition('EXECUTING', 'Re-dispatching after gap identified');
      await this.dispatchReadyCampaigns(goalId);
      await this.dispatchReadySubGoals(goalId);
      return;
    }

    this.transition('AWAITING_USER_SIGNOFF', 'AdvisorBot agrees — awaiting user sign-off');
    const signoff = await this.completionHandler.promptSignoff(goalId);

    if (signoff.approved) {
      await this.goalManager.markGoalComplete(goalId);
      this.advisorBot.destroyTaskSessions(goalId);
      this.agentRegistry.closeTask(goalId);
      this.currentGoalId = null;
      this.transition('COMPLETE', 'User signed off');
      this.userChannel.required('Goal marked complete. ');
      this.transition('IDLE', 'Ready for next goal');
    } else {
      this.userChannel.status('Changes requested. Folding into plan.');
      const newSubs = await this.bossBot.generateSubGoals(signoff.instructions);
      await this.goalManager.foldUserInput(goalId, newSubs);
      this.transition('EXECUTING', 'User requested changes after sign-off');
      await this.dispatchReadySubGoals(goalId);
    }
  }

  // ── Legacy sub-goal dispatch (folded user input, crash recovery) ───────────

  private async dispatchReadySubGoals(goalId: string): Promise<void> {
    const file  = this.goalManager.load();
    const ready = this.goalManager.getReadySubGoals(file, goalId);

    const toSpawn = ready.filter(s => !this.legacyJobs.has(s.id));
    if (toSpawn.length > 0) {
      await Promise.all(toSpawn.map(s => this.spawnLegacyJob(goalId, s)));
    }
  }

  private async spawnLegacyJob(goalId: string, subGoal: SubGoal): Promise<void> {
    const spec     = this.creatorBot.buildEmployeeSpec(
      subGoal.domain, [subGoal.domain], EMPLOYEE_DEFAULT_MODEL
    );
    const employee = buildEmployee(spec);
    this.agentRegistry.registerEmployee(employee);

    const task = this.bossBot.buildTask(subGoal.description, subGoal.domain);
    this.taskManager.register(task);
    this.taskManager.assign(task.taskId, employee.name);

    await this.goalManager.updateSubGoal(goalId, subGoal.id, {
      status: 'active',
      taskId: task.taskId,
    });

    this.userChannel.status(`Dispatching [${subGoal.domain}]: "${subGoal.description}"`);

    const job = employee.executeTask(task)
      .then(result => {
        this.pushEvent({ type: 'JOB_COMPLETE', subGoalId: subGoal.id, goalId, result });
      })
      .catch((err: unknown) => {
        this.pushEvent({ type: 'JOB_FAILED', subGoalId: subGoal.id, goalId, error: errorMessage(err) });
      })
      .finally(() => {
        this.legacyJobs.delete(subGoal.id);
      });

    this.legacyJobs.set(subGoal.id, job);
  }

  // ── CreatorBot urgent interrupt ────────────────────────────────────────────

  private async checkUrgentQueue(): Promise<void> {
    const urgent = this.creatorBot.peekUrgent();
    if (!urgent) return;

    if (!VALID_TRANSITIONS[this.state].includes('CREATOR_INTERRUPT')) return;

    const resumeState = this.state;
    this.creatorBot.consumeUrgent();

    this.transition('CREATOR_INTERRUPT', `CreatorBot urgent: ${urgent.observation}`);
    this.userChannel.required(`[CreatorBot URGENT] ${urgent.observation}`);

    // Always consult AdvisorBot on urgent matters
    const adviceReq = {
      requesterId: 'BossBot' as const,
      context:     urgent.context,
      question:    `CreatorBot reports: "${urgent.observation}". What do you advise?`,
    };
    const advice = await this.advisorBot.advise(adviceReq);
    this.userChannel.verbose(`AdvisorBot on urgent: ${advice.verdict}`);

    this.transition(resumeState, `Resuming ${resumeState} after CreatorBot interrupt`);
  }

  // ── Crash recovery ─────────────────────────────────────────────────────────

  private async recoverFromDisk(): Promise<void> {
    const file = this.goalManager.load();
    if (!file.activeGoalId) return;

    const goal = file.goals.find(g => g.id === file.activeGoalId);
    if (!goal) return;

    if (goal.status === 'complete') {
      this.userChannel.required(`Previous goal "${goal.description}" is already complete.`);
    } else if (goal.status === 'active') {
      await this.resumeGoal(goal.id);
    }
  }
}
