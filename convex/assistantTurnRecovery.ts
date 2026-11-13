import { canChooseReasoningEffort, hasPaidModelAccess, productionOffer, requireEditorAccess } from './lib/billing_access';
import { runFailure } from '../lib/ai/run-failure';
import { freeEditorModel, offeredEditorModel, withPlanReasoning } from '../lib/ai/claude-model';
import { patchTurn, syncTurnView } from './lib/assistant_turn_data';
import { refusalReason } from '../lib/ai/failure-text';
import { stepTimingValidator } from './lib/step_timing_validator';
import { appendRunTimings } from './runTimings';
import { ConvexError, v, type ObjectType } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { assistantRunArgs, MAX_REPAIR_PASSES } from "./lib/assistant_run";
import { projectRun, writeProject } from "./lib/project_data";
import { equalTimelineValue } from "../lib/editor/timeline-equality";
import { activeTabOf } from "./timelineTabs";
import { agentRunnerConfigured, startRunnerTurn } from "./lib/runner_turns";
import { aiWorkflow } from "./lib/workflows";
import type { Timeline } from "../lib/editor/types";
import type { Doc } from "./_generated/dataModel";
import { abortStream, listStreams } from "@convex-dev/agent";
import { components } from "./_generated/api";

const scope = {
  projectId: v.id("projects"),
  ownerId: v.string(),
  runId: v.string(),
};
export const turnForRun = (
  ctx: Parameters<typeof projectRun>[0],
  runId: string,
): Promise<Doc<"assistantTurns"> | null> =>
  ctx.db
    .query("assistantTurns")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .unique();

export async function rememberTurn(
  ctx: MutationCtx,
  args: ObjectType<typeof assistantRunArgs>,
  project: Doc<"projects">,
): Promise<void> {
  const id=await ctx.db.insert("assistantTurns", {
    projectId: args.projectId,
    runId: args.runId,
    promptMessageId: args.promptMessageId,
    threadId: args.threadId,
    args,
    timelineId: activeTabOf(project),
    pass: 0,
    segment: 0,
    savedEdits: 0,
    pendingFastFrames: [],
    status: "running",
    updatedAt: Date.now(),
  });
  await syncTurnView(ctx,(await ctx.db.get(id))!);
}

/** What a turn may run on now, checked before anything is written: throws a ConvexError when the owner can no
 * longer edit (a lapsed trial or subscription). */
async function entitledTurn(
  ctx: MutationCtx,
  args: ObjectType<typeof assistantRunArgs>,
): Promise<ObjectType<typeof assistantRunArgs>> {
  await requireEditorAccess(ctx, args.ownerId);
  const offer = await hasPaidModelAccess(ctx, args.ownerId) ? await productionOffer(ctx, args.ownerId) : 'free';
  if (offer === 'free') return { ...args, pinnedModel: freeEditorModel() };
  // Production: every new, queued, retried or recovered paid turn runs what the plan's offer allows of its pin.
  if (offer) return { ...args, pinnedModel: offeredEditorModel(offer, args.pinnedModel) };
  // Every new, queued, retried or recovered turn starts here: a chosen effort holds only while the owner is on Ultra.
  if (args.pinnedModel) return { ...args, pinnedModel: withPlanReasoning(args.pinnedModel, await canChooseReasoningEffort(ctx, args.ownerId)) };
  return args;
}

async function startTurn(
  ctx: MutationCtx,
  args: ObjectType<typeof assistantRunArgs>,
): Promise<void> {
  if (agentRunnerConfigured()) {
    await startRunnerTurn(ctx, args);
    return;
  }
  const workflowId = await aiWorkflow.start(
    ctx,
    internal.assistantWorkflow.runTurn,
    args,
    {
      startAsync: true,
      onComplete: internal.assistantWorkflow.settle,
      context: {
        projectId: args.projectId,
        ownerId: args.ownerId,
        runId: args.runId,
      },
    },
  );
  await writeProject(ctx, args.projectId, { aiWorkflowId: workflowId });
}

export async function dispatchTurn(
  ctx: MutationCtx,
  args: ObjectType<typeof assistantRunArgs>,
): Promise<void> {
  await startTurn(ctx, await entitledTurn(ctx, args));
}

/** A server restart enters the next pass of the same bounded repair loop. */
export async function resumeInterruptedTurn(
  ctx: MutationCtx,
  runId: string,
  feedback: string,
): Promise<boolean> {
  const turn = await turnForRun(ctx, runId);
  if (!turn || turn.status !== "running" || turn.pass >= MAX_REPAIR_PASSES)
    return false;
  const run = await projectRun(ctx, turn.projectId, turn.args.ownerId).catch(
    () => null,
  );
  if (!run?.aiRunning || run.aiRunId !== runId) return false;
  const pass = turn.pass + 1,
    segment = turn.segment + 1;
  const continuation = {
    segment,
    repairPass: pass,
    savedEdits: turn.savedEdits,
    pendingFastFrames: turn.pendingFastFrames,
    feedback,
  };
  // Entitlement is settled before anything is written: a refusal throws here and leaves the turn exactly as it was.
  const entitled = await entitledTurn(ctx, { ...turn.args, continuation });
  const streams = await listStreams(ctx, components.agent, {
    threadId: turn.threadId,
    includeStatuses: ["streaming"],
  });
  for (const stream of streams)
    await abortStream(ctx, components.agent, {
      streamId: stream.streamId,
      reason: "Resuming the same request.",
    });
  await patchTurn(ctx,turn, {
    pass,
    segment,
    feedback,
    updatedAt: Date.now(),
  });
  await startTurn(ctx, entitled);
  console.info(
    `[ai-repair] ${JSON.stringify({ event: "scheduled-continuation", projectId: turn.projectId, runId, pass, segment })}`,
  );
  return true;
}

/** Resume an interrupted turn, or end it. Every watcher of a run goes through here: a resumption that throws
 * (access lapsed since the turn began) used to escape the watcher and leave the run marked running for good. */
export async function resumeOrFinish(
  ctx: MutationCtx,
  run: { projectId: Doc<"projects">["_id"]; ownerId: string; runId: string },
  feedback: string,
  error: string,
): Promise<void> {
  let reason = error;
  try {
    if (await resumeInterruptedTurn(ctx, run.runId, feedback)) return;
  } catch (failure) {
    // Only a refusal ends the run here (nothing was written before it). Any other error rolls this mutation back as before.
    const refused = refusalReason(failure);
    if (!refused) throw failure;
    reason = refused;
    console.error(`[ai-repair] ${JSON.stringify({ event: "resume-refused", projectId: run.projectId, runId: run.runId, reason: reason.slice(0, 300) })}`);
  }
  await ctx.runMutation(internal.assistant.finish, { ...run, error: reason });
}

export const advance = internalMutation({
  args: {
    ...scope,
    expectedPass: v.number(),
    segment: v.number(),
    feedback: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const turn = await turnForRun(ctx, args.runId),
      run = await projectRun(ctx, args.projectId, args.ownerId);
    if (!run.aiRunning || run.aiRunId !== args.runId) return false;
    // Native administrative turns started before rollout still have the same local bound.
    if (!turn) return args.expectedPass < MAX_REPAIR_PASSES;
    if (
      turn.status !== "running" ||
      turn.pass !== args.expectedPass ||
      turn.segment !== args.segment ||
      turn.pass >= MAX_REPAIR_PASSES
    )
      return false;
    await patchTurn(ctx,turn, {
      pass: turn.pass + 1,
      feedback: args.feedback.slice(0, 14000),
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const interrupted = internalMutation({
  args: { ...scope, feedback: v.string(), segment:v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await projectRun(ctx, args.projectId, args.ownerId);
    const turn=await turnForRun(ctx,args.runId);
    if(turn&&turn.segment!==args.segment)return false;
    // A refused resumption wrote nothing, so the turn goes on to report its own failure on this segment.
    try {
      return await resumeInterruptedTurn(ctx, args.runId, args.feedback.slice(0, 14000));
    } catch (error) {
      const refused = refusalReason(error);
      if (!refused) throw error;
      console.error(`[ai-repair] ${JSON.stringify({ event: "resume-refused", projectId: args.projectId, runId: args.runId, reason: refused.slice(0, 300) })}`);
      return false;
    }
  },
});

export const checkpoint = internalMutation({
  args: {
    ...scope,
    segment: v.number(),
    savedEdits: v.number(),
    pendingFastFrames: v.array(v.number()),
    // This step's model and tool timings, saved in the same round trip (lib/ai/step-timing.ts).
    timings: v.optional(v.object({ lane: v.optional(v.string()), model: v.optional(v.string()), effort: v.optional(v.string()), steps: v.array(stepTimingValidator) })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turn = await turnForRun(ctx, args.runId);
    if (args.timings && turn && turn.projectId === args.projectId && turn.args.ownerId === args.ownerId) {
      const { steps, ...facts } = args.timings;
      // A timing row is never worth losing the step's checkpoint for.
      try { await appendRunTimings(ctx, { runId: args.runId, source: 'editor', ...facts }, steps); } catch { /* The report misses this step. */ }
    }
    if (
      turn &&
      turn.projectId === args.projectId &&
      turn.args.ownerId === args.ownerId &&
      turn.status === "running" &&
      turn.segment === args.segment
    )
      await patchTurn(ctx,turn, {
        savedEdits: Math.max(turn.savedEdits, args.savedEdits),
        pendingFastFrames: args.pendingFastFrames,
        updatedAt: Date.now(),
      });
    return null;
  },
});

/** Only the same run and base revision may restore a private checkpoint. */
export const draft = internalQuery({
  args: scope,
  handler: async (
    ctx,
    args,
  ): Promise<{ timeline: Timeline; revision: number } | null> => {
    const run = await projectRun(ctx, args.projectId, args.ownerId);
    if (!run.aiRunning || run.aiRunId !== args.runId)
      throw runFailure('locked', 'AI run is no longer active.');
    const project = await ctx.db.get(args.projectId),
      preview = await ctx.db
        .query("aiTimelinePreviews")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .unique();
    if (
      !preview ||
      preview.runId !== args.runId ||
      preview.ownerId !== args.ownerId ||
      preview.baseRevision !== (project?.revision ?? 0)
    )
      return null;
    if (
      project?.timeline &&
      equalTimelineValue(project.timeline, preview.timeline)
    )
      return null;
    const published = await ctx.db
      .query("toolWriteReceipts")
      .withIndex("by_run_stage", (q) =>
        q.eq("runId", args.runId).eq("stagedRevision", preview.baseRevision),
      )
      .first();
    if (published?.receipt?.status === "saved") return null;
    return {
      timeline: preview.timeline,
      revision: preview.baseRevision,
    };
  },
});
