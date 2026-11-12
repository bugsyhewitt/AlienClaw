/**
 * PKT-1460 — the campaign strike counter must ACCUMULATE across retries.
 *
 * DEFECT (live on main @ aa88b468):
 *
 *   src/alienclaw/governance/common/governance-loop.ts:351
 *       private async spawnCampaign(goalId: string, campaign: Campaign): Promise<void> {
 *         this.campaignStrikes.delete(campaign.id);     // <-- resets the counter
 *
 *   src/alienclaw/governance/common/governance-loop.ts:576-577
 *       const strikes = (this.campaignStrikes.get(event.subGoalId) ?? 0) + 1;
 *       this.campaignStrikes.set(event.subGoalId, strikes);
 *
 *   src/alienclaw/governance/common/governance-loop.ts:588
 *       if (strikes >= MAX_STRIKE_COUNT || ...) { /* surface to user *\/ }
 *
 * The PRODUCTION failure flow is:
 *
 *   JOB_FAILED -> handleJobFailed (strikes = 1)
 *              -> strikes < MAX_STRIKE_COUNT -> retry branch
 *              -> updateCampaign(status: 'pending')
 *              -> dispatchReadyCampaigns()      [line 603]
 *              -> spawnCampaign()                [line 336]
 *              -> campaignStrikes.delete(id)     [line 351]   <-- WIPES THE COUNT
 *              -> (campaign runs again, fails again)
 *              -> JOB_FAILED -> handleJobFailed (strikes = 1 AGAIN)
 *
 * So in production `strikes` is ALWAYS 1. `strikes >= MAX_STRIKE_COUNT`
 * (MAX_STRIKE_COUNT = 3) is UNREACHABLE through the strike path: a campaign
 * that fails deterministically is retried FOREVER and the user is never
 * surfaced to. The only ways out are AdvisorBot saying "user" or returning
 * low confidence — neither of which is a strike count.
 *
 * The existing test `governance-loop.test.ts` ("resets the strike counter when
 * spawnCampaign is called (fresh dispatch)") does NOT catch this: it stubs
 * `dispatchReadyCampaigns` to a no-op and then calls `campaignStrikes.delete`
 * BY HAND, asserting only on the Map it mutated itself. It never runs
 * `spawnCampaign`, so it can never observe the production reset. That test
 * asserts its own stub.
 *
 * The first existing test ("surfaces to the user after MAX_STRIKE_COUNT
 * failures") also misses it: it fires `handleJobFailed` directly, bypassing
 * the dispatch that resets the counter, so the counter accumulates there.
 *
 * This file asserts the FIXED behavior: the strike counter survives a
 * re-dispatch of the SAME campaign, and MAX_STRIKE_COUNT is reached after
 * MAX_STRIKE_COUNT consecutive failures of the same campaign.
 */
import { describe, it, expect } from 'vitest';
import { GovernanceLoop } from '../../../src/alienclaw/governance/common/governance-loop.js';
import { MAX_STRIKE_COUNT } from '../../../src/alienclaw/constants.js';
import type { GoalManager } from '../../../src/alienclaw/governance/common/goal-manager.js';
import type { AdvisorBot } from '../../../src/alienclaw/agents/advisorbot.js';
import type { UserChannel } from '../../../src/alienclaw/comms/user-channel.js';
import type { Campaign, GoalsFile } from '../../../src/alienclaw/types.js';

const GOAL_ID     = 'goal-strike-accum';
const CAMPAIGN_ID = 'camp-strike-accum';

/** Minimal goals file with a single retryable campaign. */
function makeFile(): GoalsFile {
  return {
    version:      '1',
    activeGoalId: GOAL_ID,
    goals: [{
      id:          GOAL_ID,
      description: 'strike accumulation goal',
      subGoals:    [],
      status:      'active',
      createdAt:   0,
      scheme: {
        goalId:    GOAL_ID,
        rationale: 'test',
        campaigns: [{
          id:        CAMPAIGN_ID,
          name:      'Retryable Campaign',
          objective: 'do something',
          subagents: [],
          dependsOn: [],
          status:    'pending',
        }],
        advisorEndorsement: '',
        createdAt:          0,
      },
    }],
  };
}

/** Private members are not part of the public surface — reach them via a cast. */
interface LoopInternals {
  campaignStrikes: Map<string, number>;
  activeJobs:      Map<string, Promise<void>>;
  transition:      () => void;
  handleJobFailed: (e: { type: 'JOB_FAILED'; goalId: string; subGoalId: string; error: string }) => Promise<void>;
  spawnCampaign:   (goalId: string, campaign: Campaign) => Promise<void>;
}

function internals(loop: GovernanceLoop): LoopInternals {
  return loop as unknown as LoopInternals;
}

describe('governance-loop campaign strike accumulation (PKT-1460)', () => {
  it('accumulates the strike counter across re-dispatches of the same campaign', async () => {
    const file = makeFile();

    const requiredMessages: string[] = [];

    const goalManager = {
      load:         () => file,
      save:         async () => {},
      updateCampaign: async (_goalId: string, campaignId: string, patch: { status?: string }) => {
        // Apply the status patch so the campaign is dispatchable again.
        const camp = file.goals[0].scheme!.campaigns.find(c => c.id === campaignId);
        if (camp && patch.status) camp.status = patch.status as Campaign['status'];
      },
      // The real getReadyCampaigns returns pending campaigns with no deps.
      getReadyCampaigns: () => file.goals[0].scheme!.campaigns.filter(c => c.status === 'pending'),
      isGoalComplete:   () => false,
    } as unknown as GoalManager;

    const advisorBot = {
      advise: async () => ({
        recommendation: 'rebuild',
        confidence:     'high' as const,
        verdict:        'Try again.',
      }),
      destroyTaskSessions: () => {},
    } as unknown as AdvisorBot;

    const userChannel = {
      required: (msg: string) => { requiredMessages.push(msg); },
      verbose:  () => {},
      status:   () => {},
      close:    () => {},
    } as unknown as UserChannel;

    const loop = new GovernanceLoop({
      bossBot:           {} as never,
      advisorBot,
      creatorBot:        {} as never,
      agentRegistry:     {} as never,
      goalManager,
      taskManager:       {} as never,
      escalationHandler: {} as never,
      completionHandler: {} as never,
      userChannel,
      agentChannel:      {} as never,
      adapter:           {} as never,
    });

    // State-machine wiring is not under test; the STRIKE COUNTER is.
    internals(loop).transition = () => {};

    const jobFailedEvent = {
      type:     'JOB_FAILED' as const,
      goalId:   GOAL_ID,
      subGoalId: CAMPAIGN_ID,
      error:    'deterministic failure',
    };

    const handleJobFailed = internals(loop).handleJobFailed.bind(loop);
    const spawnCampaign   = internals(loop).spawnCampaign.bind(loop);

    // ── The production flow ────────────────────────────────────────────────
    // Each failure retries through dispatchReadyCampaigns -> spawnCampaign.
    // spawnCampaign bails out early (campaignCreatorBot is not wired), but it
    // has ALREADY deleted the strike counter by then — which is the defect.
    for (let i = 1; i <= MAX_STRIKE_COUNT; i++) {
      await handleJobFailed(jobFailedEvent);

      // Production retry step: re-dispatch the SAME campaign.
      const campaign = file.goals[0].scheme!.campaigns.find(c => c.id === CAMPAIGN_ID)!;
      await spawnCampaign(GOAL_ID, campaign);

      const observed = internals(loop).campaignStrikes.get(CAMPAIGN_ID) ?? 0;

      // The counter must reflect the number of failures seen so far.
      expect(
        observed,
        `after ${i} failure(s) the campaign strike counter must be ${i}, got ${observed}`,
      ).toBe(i);
    }

    // After MAX_STRIKE_COUNT failures the user must have been surfaced to.
    const surfaced = requiredMessages.some(m => m.includes('needs your attention'));
    expect(
      surfaced,
      `the user must be surfaced to after ${MAX_STRIKE_COUNT} consecutive campaign failures`,
    ).toBe(true);
  });

  it('does not reset the strike counter when a DIFFERENT campaign is dispatched', async () => {
    const file = makeFile();
    // Add a second campaign so a fresh dispatch of another campaign is possible.
    file.goals[0].scheme!.campaigns.push({
      id:        'camp-other',
      name:      'Other Campaign',
      objective: 'something else',
      subagents: [],
      dependsOn: [],
      status:    'pending',
    });

    const goalManager = {
      load:             () => file,
      save:             async () => {},
      updateCampaign:   async () => {},
      getReadyCampaigns: () => [],
      isGoalComplete:   () => false,
    } as unknown as GoalManager;

    const advisorBot = {
      advise: async () => ({
        recommendation: 'rebuild',
        confidence:     'high' as const,
        verdict:        'Try again.',
      }),
      destroyTaskSessions: () => {},
    } as unknown as AdvisorBot;

    const userChannel = {
      required: () => {},
      verbose:  () => {},
      status:   () => {},
      close:    () => {},
    } as unknown as UserChannel;

    const loop = new GovernanceLoop({
      bossBot:           {} as never,
      advisorBot,
      creatorBot:        {} as never,
      agentRegistry:     {} as never,
      goalManager,
      taskManager:       {} as never,
      escalationHandler: {} as never,
      completionHandler: {} as never,
      userChannel,
      agentChannel:      {} as never,
      adapter:           {} as never,
    });

    internals(loop).transition = () => {};

    const strikes = internals(loop).campaignStrikes;
    strikes.set(CAMPAIGN_ID, 2);

    const spawnCampaign = internals(loop).spawnCampaign.bind(loop);

    const other = file.goals[0].scheme!.campaigns.find(c => c.id === 'camp-other')!;
    await spawnCampaign(GOAL_ID, other);

    expect(
      strikes.get(CAMPAIGN_ID),
      'dispatching a different campaign must not clear another campaign\'s strike count',
    ).toBe(2);
  });

  it('clears the strike counter when the campaign SUCCEEDS', async () => {
    const file = makeFile();

    const goalManager = {
      load:             () => file,
      save:             async () => {},
      updateCampaign:   async () => {},
      getReadyCampaigns: () => [],
      isGoalComplete:   () => false,
    } as unknown as GoalManager;

    const advisorBot = {
      advise: async () => ({
        recommendation: 'rebuild',
        confidence:     'high' as const,
        verdict:        'Try again.',
      }),
      destroyTaskSessions: () => {},
    } as unknown as AdvisorBot;

    const userChannel = {
      required: () => {},
      verbose:  () => {},
      status:   () => {},
      close:    () => {},
    } as unknown as UserChannel;

    // A campaignCreatorBot that returns a Subagent whose runCampaign SUCCEEDS.
    // The strike counter is sampled from INSIDE runCampaign — i.e. after the
    // dispatch but BEFORE onSuccess runs. That is what makes this test
    // non-vacuous: on the buggy source the counter is already gone by the time
    // the campaign runs, so a bare "counter is undefined at the end" assertion
    // would pass for the wrong reason.
    let strikesDuringRun: number | undefined;
    const campaignCreatorBot = {
      buildSubagent: () => ({
        birth: () => {},
        erase: () => {},
        runCampaign: async () => {
          strikesDuringRun = internals(loop).campaignStrikes.get(CAMPAIGN_ID);
          return {
            termination_reason: 'state_machine_finalized',
            fitness:            0.9,
            output:             'ok',
          };
        },
      }),
    };

    const loop = new GovernanceLoop({
      bossBot:           {} as never,
      advisorBot,
      creatorBot:        {} as never,
      agentRegistry:     {} as never,
      goalManager,
      taskManager:       {} as never,
      escalationHandler: {} as never,
      completionHandler: {} as never,
      userChannel,
      agentChannel:      {} as never,
      adapter:           {} as never,
      campaignCreatorBot: campaignCreatorBot as never,
    });

    internals(loop).transition = () => {};

    const strikes = internals(loop).campaignStrikes;
    strikes.set(CAMPAIGN_ID, 2);

    const campaign = file.goals[0].scheme!.campaigns.find(c => c.id === CAMPAIGN_ID)!;
    const spawnCampaign = internals(loop).spawnCampaign.bind(loop);

    await spawnCampaign(GOAL_ID, campaign);
    // spawnCampaign starts the job; wait for it to settle.
    const job = internals(loop).activeJobs.get(CAMPAIGN_ID);
    if (job) await job;
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(
      strikesDuringRun,
      'the strike counter must survive the dispatch — it is cleared on SUCCESS, not on dispatch',
    ).toBe(2);

    expect(
      strikes.get(CAMPAIGN_ID),
      'a successful campaign must clear its strike counter so a later failure run starts at 0',
    ).toBeUndefined();
  });
});
