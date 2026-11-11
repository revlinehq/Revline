import { checkCompletion, cutsGiven } from '../../lib/ai/lanes/clip/check';
import { makeFunctionReference } from 'convex/server';
import type { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { LANES, type LaneId } from '../../lib/ai/lanes';
import {
  changedFrameTimes,
  LaneFinishError,
  MAX_FINISH_ATTEMPTS,
} from '../../lib/ai/lanes/task';
import { timelineHistoryKey } from '../../lib/editor/timeline-history-key';
import { renderedFrameTime, type Timeline } from '../../lib/editor/types';
import { FastFrameReview, fastFrameEvidence, isPlainReelTimeline } from '../../lib/ai/fast-frame-review';
import { reelCaptionFailures, reelFinishKey } from '../../lib/ai/lanes/reel/check';
import { reelScriptFailures, type SavedScript } from '../../lib/ai/lanes/reel/script';
import { reelLookCheck, type SpotsEvidence } from '../../lib/ai/lanes/reel/looks';
import { changedFrameLimit, laneChecks, requestedLengthFailure, taskCheckLevel } from '../../lib/ai/lanes/checks';
import { MAX_SHEET_FRAMES, evenly } from '../../lib/ai/frame-sampling';
import { summarizeTimeline } from './inspectTimeline';
import type { EditorRun, LaneTask } from './run_types';
import type { LaneEvidence } from '../../lib/ai/lanes/types';
export type FinishResult = NonNullable<LaneTask['result']>;
/** Frames a standard finish draws to prove the changed timeline renders. */
const FINISH_PROOF_FRAMES = 4;
/** The turn ends here: the lane used up its finish attempts. */
export function exhaustedLaneError(lane: string, failures: string) {
  return new LaneFinishError(`The ${lane} task stopped after three failed finish checks: ${failures}`);
}
type Render = (
  times: number[],
  revision?: number,
  timelineId?: string,
) => Promise<{ revision: number; sheet?: string; frames: { time: number; image: string }[] }>;

/** Executes real checks; finish takes no model-provided scores, counts or acceptance flags. */
export async function finishLane(
  ctx: ActionCtx,
  options: {
    run: EditorRun;
    taskId: string;
    timelineId: string;
    timeline: Timeline;
    assets: Doc<'assets'>[];
    render: Render;
    staged: boolean;
    /** The reel lane's pending sampled frames, passed only for its standard (sample) recipe. */
    fastFrameTimes?: number[];
    clipping?: () => Promise<{
      required: boolean;
      passed: boolean;
      errors: string[];
      finalMessage?: string;
    }>;
    /** Reads the frames at each cut edge of the tabs a range-cut clip task built (lib/ai/lanes/clip/edges). */
    clipEdges?: (tabs: { label: string; timeline: Timeline }[]) => Promise<{ failures: string[]; warnings: string[] }>;
  },
): Promise<FinishResult> {
  const { run, taskId, timelineId, timeline, assets } = options,
    scope = { ownerId: run.ownerId, projectId: run.projectId, taskId };
  const task = (await ctx.runQuery(
    internal.lanes.task,
    scope,
  )) as LaneTask | null;
  if (!task) throw new Error('Start a lane task before finishing.');
  if (task.attempts >= MAX_FINISH_ATTEMPTS && task.result) return task.result;
  const fingerprint = await timelineHistoryKey(timeline),
    failures: string[] = [],
    warnings: string[] = [];
  if (task.lane === 'reel') {
    failures.push(...reelCaptionFailures(timeline, assets));
    // The cut is held to the script the agent read: its opening and closing lines and whole sentences.
    failures.push(...reelScriptFailures(timeline, assets, task.script as SavedScript | undefined));
    // Eyes: the first and last frame must be clean or looked at; other flagged edges are reported.
    const looks = reelLookCheck(timeline, LANES.reel.eyes, [...task.evidence].reverse().find(item => item.tool === 'checkSpots' && item.timelineId === timelineId)?.output as SpotsEvidence | undefined, !!task.script);
    failures.push(...looks.failures);
    warnings.push(...looks.warnings);
  }
  const tabs = (await ctx.runQuery(internal.lanes.timelines, scope)) as {
    timelineId: string;
    timeline: Timeline | null;
  }[];
  const checked = tabs.map((tab) =>
    tab.timelineId === timelineId ? { ...tab, timeline } : tab,
  );
  if (!checked.some((tab) => tab.timelineId === timelineId))
    checked.push({ timelineId, timeline });
  const sparseReel = task.lane === 'reel' && options.fastFrameTimes !== undefined && isPlainReelTimeline(timeline);
  const revision = sparseReel ? (await ctx.runQuery(internal.assistant.getRunTimeline, run)).revision : undefined;
  const checkedTimelines = sparseReel ? await Promise.all(checked.map(async tab => ({ timelineId: tab.timelineId, fingerprint: tab.timeline ? await timelineHistoryKey(tab.timeline) : null }))) : [];
  const checkKey = (evidence: LaneEvidence[]) => revision === undefined ? undefined : reelFinishKey({ fingerprint, revision, evidence: task.script ? [...evidence, { tool: 'planScript', timelineId, fingerprint, input: {}, output: { script: task.script } }] : evidence, timelines: checkedTimelines, assets });
  const initialKey = await checkKey(task.evidence);
  if (initialKey && task.result?.checkKey === initialKey && !task.result.passed)
    return ctx.runMutation(internal.lanes.recordFinish, { ...scope, result: task.result });
  // A clip-lane task that is not a /clip request, started no clipping run and created no tab is a follow-up edit on a
  // finished short (a restyled title, a mute, a trim). It gets the cheap timeline data checks below: no frames, no new run.
  const clipRun = task.lane === 'clip' && (await ctx.runQuery(internal.clipping.runStarted, { ...run, runId: taskId }));
  const clipFollowUp = task.lane === 'clip' && task.lockedLane !== 'clip' &&
    checked.every((tab) => task.initialTabIds.includes(tab.timelineId)) &&
    !clipRun;
  // Cuts made at source ranges the request named: nobody asked Revline to choose the moments and the task started no
  // clipping run, so there is no plan or whole-source analysis to hold the tabs to. The cheap checks below run instead:
  // timeline data, the 15-60 s clip length, populated source footage and a look at every cut edge.
  const rangeCuts = !clipFollowUp && cutsGiven(task, clipRun);
  const cheapClip = clipFollowUp || rangeCuts;
  const builtTabs: { label: string; timeline: Timeline }[] = [];
  // Range cuts are judged on the tabs the task built or changed. When it changed none (a task restarted on a tab an
  // earlier task built), the tab finish was called on is checked as it stands.
  const builtAny = rangeCuts && (await Promise.all(checked.map(async (tab) => {
    const baseline = task.baselines.find((item) => item.timelineId === tab.timelineId);
    return !!tab.timeline && !!baseline && baseline.fingerprint !== (await timelineHistoryKey(tab.timeline));
  }))).some(Boolean);
  for (const tab of task.lane === 'clip' && !cheapClip ? [] : checked) {
    const baseline = task.baselines.find(
      (item) => item.timelineId === tab.timelineId,
    );
    // A follow-up checks only the tabs it edited; other shorts keep their earlier delivery.
    if (cheapClip && !baseline) continue;
    if (!tab.timeline) {
      failures.push(`Timeline ${tab.timelineId} was removed before its check.`);
      continue;
    }
    const key = await timelineHistoryKey(tab.timeline);
    if ((tab.timelineId !== timelineId || builtAny) && baseline?.fingerprint === key)
      continue;
    const summary = summarizeTimeline(tab.timeline, assets),
      prefix =
        tab.timelineId === timelineId ? '' : `Timeline ${tab.timelineId}: `;
    const newClipTab = rangeCuts && !task.initialTabIds.includes(tab.timelineId);
    if (rangeCuts) builtTabs.push({ label: prefix, timeline: tab.timeline });
    if (newClipTab && summary.clipCount && !tab.timeline.clips.some((clip) => clip.kind === 'video'))
      failures.push(`${prefix}A clip needs populated source footage; this tab has no video.`);
    if (
      !summary.clipCount ||
      summary.duration <= 0 ||
      !tab.timeline.clips.some((clip) =>
        ['video', 'image', 'solid'].includes(clip.kind),
      )
    )
      failures.push(`${prefix}The task has no nonempty visual edit to finish.`);
    if (summary.missingAssetRefs.length)
      failures.push(
        `${prefix}Missing source media: ${summary.missingAssetRefs.map((item) => item.clipId).join(', ')}.`,
      );
    if (summary.overlapCount)
      failures.push(
        `${prefix}Resolve ${summary.overlapCount} same-layer collisions.`,
      );
    // The length the user asked for is part of the request; a /clip batch has its own per-clip length rules.
    const lengthFailure = tab.timelineId === timelineId && task.lane !== 'clip' ? requestedLengthFailure(task.requestedLength, summary.duration, tab.timeline.fps) : undefined;
    if (lengthFailure) failures.push(lengthFailure);
    const newGaps = summary.gaps.filter(
      (gap) =>
        !baseline?.gaps.some(
          (old) =>
            gap.start >= old.start - 1 / tab.timeline!.fps &&
            gap.end <= old.end + 1 / tab.timeline!.fps,
        ),
    );
    if (newGaps.length)
      failures.push(
        `${prefix}New uncovered visual ranges: ${newGaps.map((gap) => `${gap.start.toFixed(2)}–${gap.end.toFixed(2)}s`).join(', ')}.`,
      );
    try {
      await ctx.runMutation(internal.lanes.validate, {
        ownerId: run.ownerId,
        projectId: run.projectId,
        timeline: tab.timeline,
      });
    } catch (error) {
      failures.push(
        `${prefix}${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // A new clip must be 15–60 s. An existing short keeps that length unless the user asked otherwise, so leaving the range only warns.
    if (cheapClip && summary.duration > 0 && (summary.duration < 15 - 1 / tab.timeline.fps || summary.duration > 60 + 1 / tab.timeline.fps)) {
      if (newClipTab) failures.push(`${prefix}This clip is ${summary.duration.toFixed(2)}s; a clip must be 15–60 s. Lengthen or shorten its source range, or tell the user the range they gave is outside the clip length.`);
      else warnings.push(`${prefix}This short is now ${summary.duration.toFixed(2)}s, outside the 15–60 s clip length.`);
    }
    // Clip-lane checks never render frames.
    if (!cheapClip && !failures.length && summary.clipCount && summary.duration > 0) {
      const fastTimes = task.lane === 'reel' && tab.timelineId === timelineId && isPlainReelTimeline(tab.timeline) ? options.fastFrameTimes : undefined;
      const pendingReview = fastTimes === undefined ? undefined : new FastFrameReview(fastTimes);
      // Every sample is a frame this tab can draw: a time queued against a longer, discarded draft would be refused forever.
      const drawable = (time: number) => renderedFrameTime(time, summary.duration, tab.timeline!.fps);
      const times = [...new Set((fastTimes ?? (baseline
        ? await changedFrameTimes(tab.timeline, baseline)
        : [0, summary.duration / 2])).map(drawable))];
      // A plain reel at the standard level reuses its pending queue; other paths retain the rendered finish check.
      if (!times.length && fastTimes === undefined)
        times.push(
          Math.min(
            summary.duration / 2,
            Math.max(0, summary.duration - 1 / tab.timeline.fps),
          ),
        );
      try {
        // This render only proves the changed timeline draws; nobody looks at it. In a standard check the model has
        // already looked at a sheet of the changed spots (finish refuses until it has), so four evenly spaced frames
        // are the proof. A final check (export, publish, double-check) draws every changed frame. Gaps, overlaps and
        // missing media are measured from saved data above either way.
        const standard = !pendingReview && changedFrameLimit(laneChecks(task.lane, taskCheckLevel(task))) !== undefined;
        const drawn = standard ? evenly(times, FINISH_PROOF_FRAMES) : times;
        for (let index = 0; index < drawn.length; index += MAX_SHEET_FRAMES) {
          const batch = drawn.slice(index, index + MAX_SHEET_FRAMES),
            rendered = await options.render(batch, undefined, tab.timelineId);
          if (
            rendered.frames.length !== batch.length ||
            (!rendered.sheet && rendered.frames.some((frame) => !frame.image))
          )
            throw new Error('Changed-range rendering returned missing frames.');
          if (pendingReview) {
            pendingReview.reviewed(rendered.frames.map(frame => frame.time), tab.timeline);
            await ctx.runMutation(internal.lanes.evidence, { ...scope, evidence: fastFrameEvidence(tab.timelineId, key, pendingReview.times()) });
          }
        }
      } catch (error) {
        failures.push(
          `${prefix}Changed ranges did not render: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (task.lane !== 'clip') {
      const context = {
        timeline: tab.timeline,
        evidence: task.evidence as LaneEvidence[],
        fingerprint: key,
        timelineId: tab.timelineId,
        assets,

      };
      failures.push(...LANES[task.lane].check(context).map((error) => prefix + error));
      warnings.push(...(LANES[task.lane].warn?.(context) ?? []).map((warning) => prefix + warning));
    }
  }
  if (rangeCuts) {
    // The first and last frames of each cut, read from the source: a stray frame of the neighbouring shot fails here.
    // It runs beside any failure above, so one finish reports everything there is to repair.
    if (options.clipEdges && builtTabs.length) {
      const edges = await options.clipEdges(builtTabs);
      failures.push(...edges.failures);
      warnings.push(...edges.warnings);
    }
    // The final level's decode-health check is a checkClip receipt against a registered plan; range cuts have none.
    if (taskCheckLevel(task) === 'final') warnings.push('Decode health of the source was not checked: that check needs a registered clip plan, and these clips were cut at given source ranges.');
  }
  if (task.lane === 'clip' && !cheapClip) {
    // The stable task key spans separate MCP calls; the upstream ledger verifies every actual tab.
    failures.push(
      ...(await checkCompletion(
        options.clipping ??
          (() =>
            ctx.runQuery(
              makeFunctionReference<'query'>('clipping:completionState'),
              { ...run, runId: taskId, timelineId, timeline },
            )),
      )),
    );
  }
  const finalCheckKey = initialKey ? await checkKey(((await ctx.runQuery(internal.lanes.task, scope)) as LaneTask).evidence) : undefined;
  const result: FinishResult = {
    passed: failures.length === 0,
    lane: task.lane as LaneId,
    attempt: task.attempts + 1,
    exhausted: false,
    failures: [...new Set(failures)],
    fingerprint,
    timelineId,
    ...(finalCheckKey ? { checkKey: finalCheckKey } : {}),
    ...(warnings.length ? { warnings: [...new Set(warnings)] } : {}),
  };
  return ctx.runMutation(internal.lanes.recordFinish, { ...scope, result });
}
