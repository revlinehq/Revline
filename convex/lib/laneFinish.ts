import { checkCompletion } from '../../lib/ai/lanes/clip/check';
import { makeFunctionReference } from 'convex/server';
import type { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { LANES, type LaneId } from '../../lib/ai/lanes';
import {
  changedFrameTimes,
  MAX_FINISH_ATTEMPTS,
} from '../../lib/ai/lanes/task';
import { timelineHistoryKey } from '../../lib/editor/timeline-history-key';
import { timelineDuration, type Timeline } from '../../lib/editor/types';
import { captionSyncFailures } from '../../lib/ai/lanes/reel/check';
import {
  sourceEndOf,
  timelineTimeAtSource,
} from '../../lib/editor/playback-rate';
import { summarizeTimeline } from './inspectTimeline';
import type { EditorRun } from './editorToolkit';
import type { LaneEvidence, ReferenceMotionEvidence } from '../../lib/ai/lanes/types';
import { referenceMotionTargets } from '../../lib/ai/lanes/recreate/motion';
import { motionReport, motionTimelineKey } from '../../lib/ai/motion-coverage';
export type LaneTask = Doc<'editingLaneTasks'>;
export type FinishResult = NonNullable<LaneTask['result']>;
type Render = (
  times: number[],
  revision?: number,
  timelineId?: string,
) => Promise<{ revision: number; frames: { time: number; image: string }[] }>;

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
    clipping?: () => Promise<{
      required: boolean;
      passed: boolean;
      errors: string[];
      finalMessage?: string;
    }>;
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
    failures: string[] = [];
  const motionReports: string[] = [], motionOff: NonNullable<FinishResult['motionOff']> = [];
  let currentRevision: number | undefined;
  const tabs = (await ctx.runQuery(internal.lanes.timelines, scope)) as {
    timelineId: string;
    timeline: Timeline | null;
  }[];
  const checked = tabs.map((tab) =>
    tab.timelineId === timelineId ? { ...tab, timeline } : tab,
  );
  if (!checked.some((tab) => tab.timelineId === timelineId))
    checked.push({ timelineId, timeline });
  for (const tab of task.lane === 'clip' ? [] : checked) {
    const baseline = task.baselines.find(
      (item) => item.timelineId === tab.timelineId,
    );
    if (!tab.timeline) {
      failures.push(`Timeline ${tab.timelineId} was removed before its check.`);
      continue;
    }
    const key = await timelineHistoryKey(tab.timeline);
    if (tab.timelineId !== timelineId && baseline?.fingerprint === key)
      continue;
    const summary = summarizeTimeline(tab.timeline, assets),
      prefix =
        tab.timelineId === timelineId ? '' : `Timeline ${tab.timelineId}: `;
    const referencePolicy = LANES[task.lane].referenceMotion;
    const targets = referencePolicy ? referenceMotionTargets(tab.timeline, assets, tab.timelineId, referencePolicy === 'required') : [];
    const referenceMotion: ReferenceMotionEvidence[] = [];
    for (const target of targets) {
      currentRevision ??= (await ctx.runQuery(internal.assistant.getRunTimeline, run)).revision;
      const state = await ctx.runQuery(internal.referenceMotion.state, { ownerId: run.ownerId, projectId: run.projectId, assetId: target.assetId as Id<'assets'>, timelineId: tab.timelineId });
      const evidence = { ...target, ...state, projectId: run.projectId, revision: currentRevision!, timelineKey: await motionTimelineKey(tab.timeline) };
      referenceMotion.push(evidence);
      motionReports.push(prefix + motionReport(evidence));
      motionOff.push(...state.off.map(item => ({ ...item, assetId: target.assetId, timelineId: tab.timelineId })));
    }
    const checksReference = referencePolicy === 'required' || targets.length > 0;
    if (
      !summary.clipCount ||
      summary.duration <= 0 ||
      !tab.timeline.clips.some((clip) =>
        ['video', 'image', 'solid', 'scene'].includes(clip.kind),
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
    // Reference lanes already require dense rendered pairs, or explicit OFF windows, below.
    if (summary.clipCount && summary.duration > 0 && !checksReference) {
      const times = baseline
        ? await changedFrameTimes(tab.timeline, baseline)
        : [0, summary.duration / 2];
      // An unchanged timeline still needs a real render before certifying it.
      if (!times.length)
        times.push(
          Math.min(
            summary.duration / 2,
            Math.max(0, summary.duration - 1 / tab.timeline.fps),
          ),
        );
      try {
        for (let index = 0; index < times.length; index += 4) {
          const batch = times.slice(index, index + 4),
            rendered = await options.render(batch, undefined, tab.timelineId);
          if (
            rendered.frames.length !== batch.length ||
            rendered.frames.some((frame) => !frame.image)
          )
            throw new Error('Changed-range rendering returned missing frames.');
        }
      } catch (error) {
        failures.push(
          `${prefix}Changed ranges did not render: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (task.lane !== 'clip')
      failures.push(
        ...LANES[task.lane]
          .check({
            timeline: tab.timeline,
            evidence: task.evidence as LaneEvidence[],
            fingerprint: key,
            timelineId: tab.timelineId,
            assets,
            referenceMotion,
          })
          .map((error) => prefix + error),
      );
  }
  if (task.lane === 'clip') {
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
  if (task.lane === 'reel' && timeline.clips.some(clip => clip.kind === 'caption')) {
    const speechClips = timeline.clips.filter(
      (clip) =>
        (clip.kind === 'video' || clip.kind === 'audio') &&
        assets.some(
          (asset) =>
            asset._id === clip.assetId &&
            asset.analysis?.transcript?.words.length,
        ),
    );
    if (!speechClips.length)
      failures.push(
        'No retained speech transcript is available to verify caption synchronization.',
      );
    const words = [
      ...new Map(
        speechClips
          .flatMap((clip) => {
            const transcript = assets.find(
              (asset) => asset._id === clip.assetId,
            )?.analysis?.transcript;
            return (transcript?.words ?? [])
              .filter(
                (word) =>
                  word.start >= clip.sourceStart - 0.001 &&
                  word.end <= sourceEndOf(clip) + 0.001,
              )
              .map((word) => ({
                text: word.text,
                start: timelineTimeAtSource(clip, word.start),
                end: timelineTimeAtSource(clip, word.end),
              }));
          })
          .map((word) => [
            `${word.start.toFixed(3)}:${word.end.toFixed(3)}:${word.text}`,
            word,
          ]),
      ).values(),
    ].sort((a, b) => a.start - b.start);
    failures.push(...captionSyncFailures(timeline, words));
  }
  const result: FinishResult = {
    passed: failures.length === 0,
    lane: task.lane as LaneId,
    attempt: task.attempts + 1,
    exhausted: false,
    failures: [...new Set(failures)],
    fingerprint,
    timelineId,
    ...(motionReports.length ? { motionCheck: motionReports.join('\n') } : {}),
    ...(motionOff.length ? { motionOff } : {}),
  };
  return ctx.runMutation(internal.lanes.recordFinish, { ...scope, result });
}
