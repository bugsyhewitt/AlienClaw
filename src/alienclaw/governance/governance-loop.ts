import { EMPLOYEE_DEFAULT_MODEL } from '../constants.js';
import type {
  GovernanceState, GovernanceEvent, TransitionHook,
  Goal, SubGoal, GoalsFile,
} from '../types.js';
import type { BossBot }    from '../agents/bossbot.js';
import type { AdvisorBot } from '../agents/advisorbot.js';
import type { CreatorBot } from '../agents/creatorbot.js';
import type { AgentRegistry } from '../agents/agent-registry.js';
import { buildEmployee }       from '../agents/employee.js';
import type { GoalManager }        from './goal-manager.js';
import type { TaskManager }        from './task-manager.js';
import type { EscalationHandler }  from './escalation-handler.js';
import type { CompletionHandler }  from './completion-handler.js';
import type { UserChannel }        from '../comms/user-channel.js';

// ── Valid state transitions ───────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<GovernanceState, GovernanceState[]> = {
  IDLE:                  ['DECOMPOSING'],
  DECOMPOSING:           ['EXECUTING', 'AWAITING_ADVICE'],
  EXECUTING:             ['AWAITING_ADVICE', 'CREATOR_BUILDING', 'CREATOR_INTERRUPT',
                          'AWAITING_USER_INPUT', 'REVIEWING_COMPLETION'],
  AWAITING_ADVICE:       ['EXECUTING', 'CREATOR_BUILDING', 'DECOMPOSING'],
  CREATOR_BUILDING:      ['EXECUTING'],
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
  private state:          GovernanceState = 'IDLE';
  private currentGoalId:  string | null   = null;
  private eventQueue:     GovernanceEvent[] = [];
  /** subGoalId → running job promise (for parallel tracking) */
  private activeJobs      = new Map<string, Promise<void>>();
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

  getState(): GovernanceState {
    return this.state;
  }

  /** Push a user goal onto the event queue. */
  submitGoal(description: string): void {
    this.pushEvent({ type: 'USER_GOAL', description });
  }

  /** Push mid-execution user input onto the event queue. */
  submitUserInput(message: string): void {
    this.pushEvent({ type: 'USER_INPUT', message });
  }

  /**
   * Start the event-drain loop. Crash-recovers from goals.json before
   * blocking. Resolves when `stop()` is called.
   */
  async start(): Promise<void> {
    this.running = true;
    await this.recoverFromDisk();
    await this.drain();
    this.userChannel.close();
  }

  stop(): void {
    this.running = false;
  }

  /**
   * Re-dispatch an in-progress goal after a crash. Called by bootstrap
   * when goals.json shows an active goal on startup.
   */
  async resumeGoal(goalId: string): Promise<void> {
    const file = this.goalManager.load();
    const goal = file.goals.find(g => g.id === goalId);
    if (!goal) return;

    this.userChannel.required(`Resuming goal: "${goal.description}"`);

    // Reset any sub-goals that were mid-flight when we crashed
    for (const sg of goal.subGoals) {
      if (sg.status === 'active') {
        await this.goalManager.updateSubGoal(goalId, sg.id, {
          status: 'pending',
          taskId: undefined,
        });
      }
    }

    this.currentGoalId = goalId;
    this.transition('DECOMPOSING', 'Crash recovery — plan loaded from disk');
    this.transition('EXECUTING',   'Crash recovery — dispatching ready sub-goals');
    await this.dispatchReadySubGoals(goalId);
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
    this.eventQueue.push(event);
  }

  private async drain(): Promise<void> {
    while (this.running) {
      // 1. Check CreatorBot urgent queue after every iteration
      await this.checkUrgentQueue();

      // 2. Process next event
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
      case 'USER_GOAL':    await this.handleUserGoal(event.description); break;
      case 'USER_INPUT':   await this.handleUserInput(event.message);    break;
      case 'JOB_COMPLETE': await this.handleJobComplete(event);           break;
      case 'JOB_FAILED':   await this.handleJobFailed(event);             break;
    }
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  private async handleUserGoal(description: string): Promise<void> {
    if (this.state !== 'IDLE') {
      // Already running — fold as user input instead
      this.userChannel.status(`New input while goal is active — folding into plan.`);
      await this.handleUserInput(description);
      return;
    }

    this.userChannel.status(`New goal received: "${description}"`);
    this.transition('DECOMPOSING', 'User submitted goal');

    // ── BossBot forms its own decomposition ──────────────────────────────────
    const bossSubs = await this.bossBot.decompose(description);

    // ── AdvisorBot's independent read ─────────────────────────────────────
    this.transition('AWAITING_ADVICE', 'Consulting AdvisorBot on decomposition');
    const adviceReq = {
      requesterId: 'BossBot' as const,
      context:     `Goal: "${description}"\nBossBot decomposition:\n` +
                   bossSubs.map(s => `  - [${s.domain}] ${s.description}`).join('\n'),
      question:    'How would you decompose this goal? What dependencies and domains do you see?',
    };
    const advice = await this.advisorBot.advise(adviceReq, description);
    this.advisorBot.appendToSession('BossBot', description, {
      from: 'BossBot', to: 'AdvisorBot', content: adviceReq.question, ts: Date.now(),
    });
    this.advisorBot.appendToSession('BossBot', description, {
      from: 'AdvisorBot', to: 'BossBot', content: advice.verdict, ts: Date.now(),
    });
    this.userChannel.verbose(`AdvisorBot verdict: ${advice.verdict}`);

    // ── BossBot synthesizes both views (stub: use BossBot's decomposition) ──
    const subGoals: SubGoal[] = bossSubs;

    const goal: Goal = {
      id:          crypto.randomUUID(),
      description,
      subGoals,
      status:      'active',
      createdAt:   Date.now(),
    };

    await this.goalManager.addGoal(goal);
    this.currentGoalId = goal.id;

    this.transition('DECOMPOSING', 'Returning from advice');
    this.transition('EXECUTING',   'Plan written — dispatching ready sub-goals');
    await this.dispatchReadySubGoals(goal.id);
  }

  private async handleUserInput(message: string): Promise<void> {
    if (!this.currentGoalId || this.state === 'IDLE') {
      // No active goal — treat as a new goal
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
      // Phase 3+: propagate constraint to assigned employees
      this.userChannel.status(`Constraint noted. Will inform active Employees (Phase 3+).`);
    } else {
      // direction_change — treat as new sub-goals for Phase 2B
      const newSubs = await this.bossBot.generateSubGoals(message);
      await this.goalManager.foldUserInput(this.currentGoalId, newSubs);
      await this.dispatchReadySubGoals(this.currentGoalId);
    }
  }

  private async handleJobComplete(
    event: GovernanceEvent & { type: 'JOB_COMPLETE' }
  ): Promise<void> {
    this.activeJobs.delete(event.subGoalId);

    // Mark sub-goal complete
    await this.goalManager.updateSubGoal(event.goalId, event.subGoalId, {
      status: 'complete',
    });

    // Tear down task
    const file    = this.goalManager.load();
    const goal    = file.goals.find(g => g.id === event.goalId);
    const subGoal = goal?.subGoals.find(s => s.id === event.subGoalId);
    if (subGoal?.taskId) {
      this.advisorBot.destroyTaskSessions(subGoal.taskId);
      this.taskManager.deregister(subGoal.taskId);
    }

    this.userChannel.status(
      `Sub-goal complete: "${subGoal?.description ?? event.subGoalId}"`
    );

    // Check if the overall goal is done
    if (this.goalManager.isGoalComplete(this.goalManager.load(), event.goalId)) {
      await this.runCompletionFlow(event.goalId);
    } else {
      // Dispatch any newly-unblocked sub-goals
      await this.dispatchReadySubGoals(event.goalId);
    }
  }

  private async handleJobFailed(
    event: GovernanceEvent & { type: 'JOB_FAILED' }
  ): Promise<void> {
    this.activeJobs.delete(event.subGoalId);

    const file    = this.goalManager.load();
    const goal    = file.goals.find(g => g.id === event.goalId);
    const subGoal = goal?.subGoals.find(s => s.id === event.subGoalId);
    if (!subGoal || !subGoal.taskId) return;

    const task = this.taskManager.get(subGoal.taskId);
    if (!task) return;

    this.userChannel.status(
      `Sub-goal failed (strike ${task.strikeCount + 1}): "${subGoal.description}"`
    );

    const willBeExhausted = (task.strikeCount + 1) >= 3;

    if (!willBeExhausted) {
      this.transition('AWAITING_ADVICE',
        `Strike ${task.strikeCount + 1} — consulting AdvisorBot`);
    }

    const strikeAction = await this.escalationHandler.handleFailure(
      task, subGoal.domain, subGoal.domain ? [subGoal.domain] : [],
      event.error, task.taskId,
    );

    if (strikeAction.action === 'SURFACE_USER') {
      this.transition('AWAITING_USER_INPUT', `Strike ${task.strikeCount} — surfacing to user`);
      const userResp = await this.escalationHandler.handleStrikeThree(task);

      if (userResp.outcome === 'abandon') {
        await this.goalManager.updateSubGoal(event.goalId, event.subGoalId, {
          status: 'failed',
        });
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
        // new_instructions — reset and re-queue
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
      // REBUILD — escalationHandler already recorded the attempt
      this.transition('CREATOR_BUILDING', `Building generation-${strikeAction.spec.generation} employee`);

      const newEmployee = buildEmployee(strikeAction.spec);
      this.agentRegistry.registerEmployee(newEmployee);
      this.taskManager.assign(task.taskId, newEmployee.name);

      this.transition('EXECUTING', `New employee ${newEmployee.name} dispatched`);

      // Relaunch the job with the same task envelope
      const job = newEmployee.executeTask(task)
        .then(result => {
          this.pushEvent({
            type: 'JOB_COMPLETE', subGoalId: event.subGoalId,
            goalId: event.goalId, result,
          });
        })
        .catch((err: unknown) => {
          this.pushEvent({
            type: 'JOB_FAILED', subGoalId: event.subGoalId,
            goalId: event.goalId, error: String(err),
          });
        });

      this.activeJobs.set(event.subGoalId, job);
    }
  }

  // ── Completion flow ────────────────────────────────────────────────────────

  private async runCompletionFlow(goalId: string): Promise<void> {
    // Flush CreatorBot notable queue before reviewing
    const notable = this.creatorBot.flushNotable();
    if (notable.length > 0) {
      this.userChannel.verbose(
        `CreatorBot notable items:\n${notable.map(i => `  - ${i.observation}`).join('\n')}`
      );
    }

    this.transition('REVIEWING_COMPLETION', 'All sub-goals complete — reviewing with AdvisorBot');

    const review = await this.completionHandler.review(goalId);

    if (!review.proceed) {
      // AdvisorBot flagged gaps — re-open affected sub-goals
      for (const id of review.reopenIds) {
        await this.goalManager.updateSubGoal(goalId, id, { status: 'pending', taskId: undefined });
      }
      this.userChannel.status(`AdvisorBot flagged gaps. Re-opening ${review.reopenIds.length} sub-goal(s).`);
      this.transition('AWAITING_ADVICE',  'AdvisorBot flagged gaps');
      this.transition('EXECUTING',        'Re-dispatching after gap identified');
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
      // User wants changes — fold and continue
      this.userChannel.status('Changes requested. Folding into plan.');
      const newSubs = await this.bossBot.generateSubGoals(signoff.instructions);
      await this.goalManager.foldUserInput(goalId, newSubs);
      this.transition('EXECUTING', 'User requested changes after sign-off');
      await this.dispatchReadySubGoals(goalId);
    }
  }

  // ── Parallel dispatch ──────────────────────────────────────────────────────

  private async dispatchReadySubGoals(goalId: string): Promise<void> {
    const file  = this.goalManager.load();
    const ready = this.goalManager.getReadySubGoals(file, goalId);

    for (const subGoal of ready) {
      if (this.activeJobs.has(subGoal.id)) continue; // already running
      await this.spawnJob(goalId, subGoal);
    }

    if (ready.length > 1) {
      this.userChannel.verbose(
        `Dispatched ${ready.length} sub-goals in parallel: ` +
        ready.map(s => `"${s.description}"`).join(', ')
      );
    }
  }

  private async spawnJob(goalId: string, subGoal: SubGoal): Promise<void> {
    // Build employee
    const spec     = this.creatorBot.buildEmployeeSpec(
      subGoal.domain, [subGoal.domain], EMPLOYEE_DEFAULT_MODEL
    );
    const employee = buildEmployee(spec);
    this.agentRegistry.registerEmployee(employee);

    // Build and register task
    const task = this.bossBot.buildTask(subGoal.description, subGoal.domain);
    this.taskManager.register(task);
    this.taskManager.assign(task.taskId, employee.name);

    // Update sub-goal in goals.json
    await this.goalManager.updateSubGoal(goalId, subGoal.id, {
      status: 'active',
      taskId: task.taskId,
    });

    this.userChannel.status(`Dispatching [${subGoal.domain}]: "${subGoal.description}"`);

    // Launch — completion/failure pushes events back to the queue
    const job = employee.executeTask(task)
      .then(result => {
        this.pushEvent({ type: 'JOB_COMPLETE', subGoalId: subGoal.id, goalId, result });
      })
      .catch((err: unknown) => {
        this.pushEvent({ type: 'JOB_FAILED', subGoalId: subGoal.id, goalId, error: String(err) });
      });

    this.activeJobs.set(subGoal.id, job);
  }

  // ── CreatorBot urgent interrupt ────────────────────────────────────────────

  private async checkUrgentQueue(): Promise<void> {
    const urgent = this.creatorBot.peekUrgent();
    if (!urgent) return;

    // Only interrupt if we are in a state that can transition to CREATOR_INTERRUPT
    if (!VALID_TRANSITIONS[this.state].includes('CREATOR_INTERRUPT')) return;

    const resumeState = this.state;
    this.creatorBot.consumeUrgent();

    this.transition('CREATOR_INTERRUPT', `CreatorBot urgent: ${urgent.observation}`);
    this.userChannel.required(`[CreatorBot URGENT] ${urgent.observation}`);

    // BossBot decides action — may consult AdvisorBot
    if (VALID_TRANSITIONS['CREATOR_INTERRUPT'].includes('AWAITING_ADVICE')) {
      const adviceReq = {
        requesterId: 'BossBot' as const,
        context:     urgent.context,
        question:    `CreatorBot reports: "${urgent.observation}". What do you advise?`,
      };
      const advice = await this.advisorBot.advise(adviceReq);
      this.userChannel.verbose(`AdvisorBot on urgent: ${advice.verdict}`);
    }

    this.transition(resumeState as GovernanceState,
      `Resuming ${resumeState} after CreatorBot interrupt`);
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

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
