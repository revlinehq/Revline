import { checkCompletion, cutsGiven } from '../../lib/ai/lanes/clip/check';
import { makeFunctionReference } from 'convex/server';
import type { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { LANES, type LaneId } from '../../lib/ai/lanes';
import {
  finishFrameBudget,
  finishLookSpots,
  touchedKinds,
  FINISH_FRAMES_PER_TASK,
  type FinishLookSpot,
  LaneFinishError,
  MAX_FINISH_ATTEMPTS,
} from '../../lib/ai/lanes/task';
import { footageGaps } from '../../lib/editor/frame-grid';
import { mainFootageTrack } from '../../lib/editor/shot-edits';
import { layerGroup, trackOf } from '../../lib/editor/types';
import { timelineHistoryKey } from '../../lib/editor/timeline-history-key';
import type { Timeline } from '../../lib/editor/types';
import { fastFrameEvidence, isPlainReelTimeline } from '../../lib/ai/fast-frame-review';
import { captionAdvice } from '../../lib/ai/lanes/caption-data';
import { reelCaptionFailures, reelFinishKey } from '../../lib/ai/lanes/reel/check';
import { reelScriptFailures, type SavedScript } from '../../lib/ai/lanes/reel/script';
import { cutScriptFailures } from '../../lib/ai/lanes/reel/cut-script';
import { reelLookCheck, type SpotsEvidence } from '../../lib/ai/lanes/reel/looks';
import { requestedLengthFailure, taskCheckLevel } from '../../lib/ai/lanes/checks';
import { MAX_SHEET_FRAMES } from '../../lib/ai/frame-sampling';
import { summarizeTimeline } from './inspectTimeline';
import type { EditorRun, LaneTask } from './run_types';
import type { LaneEvidence } from '../../lib/ai/lanes/types';
export type FinishResult = NonNullable<LaneTask['result']>;
/** The frames could not be drawn in time (a busy or slow media worker). That says nothing about the edit, so finish
 * reports it and goes on: it is never a failed check and spends no attempt. */
export class FramesUnavailableError extends Error {}
/** The turn ends here: the lane used up its finish attempts. */
export function exhaustedLaneError(lane: string, failures: string) {
  return new LaneFinishError(`The ${lane} task stopped because its finish check kept failing with nothing fixed in between: ${failures}`);
}
/** What an agent does once its task is closed. An MCP agent's job can outlive one task (many clips), so it names
 * the call that continues; an in-app request ends and the user sends the next one. */
export function exhaustedNext(overMcp: boolean) {
  return overMcp
    ? 'Stop editing this task: finish and the editing tools are closed for it and it stays unfinished. Report these failures honestly. To continue other work, call startTask for a new task; finish is available on every task.'
    : 'Stop. finish kept failing, so finish and the editing tools are now closed for this request. Report these failures honestly; this task is unfinished.';
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
    /** Told which frames finish drew for the current tab, and why, so the caller can hand them back as its look. */
    looked?: (spots: FinishLookSpot[]) => void;
    /** What the frame grid closed just before this check (sub-frame gaps and overlaps): reported, never a failure. */
    healed?: string[];
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
    warnings: string[] = [],
    // The one call that repairs a whole class of failure, and whether every failure has one.
    fixes: string[] = [];
  let unfixable = 0;
  const seconds = (value: number) => `${Math.round(value * 1000) / 1000}`;
  // finish scales to the change. A request that only added a header, restyled a text or changed a volume is not
  // held to the cut's script, its edge looks or its caption sync again: those belong to footage and captions it
  // never touched. The timeline data checks below (gaps, overlaps, missing media) always run; they cost nothing.
  const touched = await touchedKinds(timeline, task.baselines.find((item) => item.timelineId === timelineId));
  if (task.lane === 'reel' && (touched.footage || touched.captions)) failures.push(...reelCaptionFailures(timeline, assets));
  if (task.lane === 'reel' && touched.footage) {
    // The cut is held to the script the agent read: its opening and closing lines and whole sentences.
    failures.push(...reelScriptFailures(timeline, assets, task.script as SavedScript | undefined));
    // Eyes: the first and last frame must be clean or looked at; other flagged edges are reported.
    const looks = reelLookCheck(timeline, LANES.reel.eyes, [...task.evidence].reverse().find(item => item.tool === 'checkSpots' && item.timelineId === timelineId)?.output as SpotsEvidence | undefined, !!task.script);
    failures.push(...looks.failures);
    warnings.push(...looks.warnings);
  }
  // The script as cut: a task that read its cut back is held to it. Repeats, clipped words and half sentences left at
  // the cuts come back in one result. A task that never read the cut changed no speech on purpose and is not judged.
  const cutRead = [...task.evidence].reverse().find(item => item.tool === 'readCutScript' && item.timelineId === timelineId);
  if (cutRead) failures.push(...cutScriptFailures(timeline, assets, Object.keys((cutRead.output as { accepted?: Record<string, string> }).accepted ?? {}), !!task.script));
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
    if (summary.overlapCount) {
      // Every collision in one result, with the clips and times: timeline data proves it, no frames needed.
      const label = (group: string, track: number) => `${group === 'effects' ? 'FX' : group === 'audio' ? 'A' : 'V'}${track}`;
      failures.push(
        `${prefix}Resolve ${summary.overlapCount} same-layer collision${summary.overlapCount === 1 ? '' : 's'}: ${summary.overlaps.slice(0, 40).map((item) => `${item.clipIds.join(' and ')} on ${label(item.group, item.track)} at ${seconds(item.start)}–${seconds(item.end)} s`).join('; ')}${summary.overlapsTruncated || summary.overlaps.length > 40 ? '; and more' : ''}.`,
      );
      fixes.push(`${prefix}For each colliding pair move one clip to a free layer or time (moveClips takes several clips in one call), or trim the earlier clip to end where the later one starts.`);
      unfixable++;
    }
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
    // A gap shorter than a frame is a rounding artefact between frames: it never fails a check. It closes with the
    // next edit of this timeline, which puts every cut on the frame grid.
    const artefacts = newGaps.filter((gap) => gap.end - gap.start < 1 / tab.timeline!.fps - 1e-6);
    if (artefacts.length) { warnings.push(`${prefix}${artefacts.length} gap${artefacts.length === 1 ? '' : 's'} shorter than a frame at ${artefacts.map((gap) => `${seconds(gap.start)} s`).join(', ')}: rounding artefacts, not failures; the next edit closes them.`); newGaps.splice(0, newGaps.length, ...newGaps.filter((gap) => !artefacts.includes(gap))); }
    if (newGaps.length) {
      // All of them at once, with exact times and the clips either side, and the one call that closes them.
      const fps = tab.timeline.fps, between = footageGaps(tab.timeline), mainTrack = mainFootageTrack(tab.timeline);
      const footage = tab.timeline.clips.filter((clip) => layerGroup(clip.kind) === 'visual');
      const described = newGaps.map((gap) => {
        // The layer whose own hole this is: the tightest footage gap around it, the main footage layer first.
        const cut = between.filter((item) => item.start <= gap.start + 1e-6 && item.end >= gap.end - 1e-6).sort((a, b) => (a.end - a.start) - (b.end - b.start) || (a.track === mainTrack ? -1 : b.track === mainTrack ? 1 : 0))[0];
        const frames = Math.round((gap.end - gap.start) * fps);
        return { cut, text: `${seconds(gap.start)}–${seconds(gap.end)} s (${frames} frame${frames === 1 ? '' : 's'}${cut ? `, ${cut.afterClipId ? `after ${cut.afterClipId} ` : ''}before ${cut.beforeClipId} on V${cut.track}` : ''})` };
      });
      failures.push(`${prefix}${newGaps.length} new uncovered visual range${newGaps.length === 1 ? '' : 's'}: ${described.map((item) => item.text).join(', ')}.`);
      // closeGaps joins the main footage layer. A hole in front of an overlay on another layer is closed by moving
      // or removing that overlay, never by packing its layer.
      const closable = described.filter((item) => item.cut?.track === mainTrack).length, rest = described.length - closable;
      if (closable) fixes.push(`${prefix}closeGaps with no arguments closes ${closable === 1 ? 'this gap' : `all ${closable} of these gaps`} on V${mainTrack} in ONE call (later footage on that layer moves earlier with its linked audio; overlays stay put). Do not close them one at a time.`);
      if (rest) {
        // Nothing follows on a footage layer: the picture ends while other clips run on.
        const last = Math.max(0, ...footage.filter((clip) => ['video', 'image', 'solid'].includes(clip.kind) && (mainTrack === undefined || trackOf(clip) === mainTrack)).map((clip) => clip.start + clip.duration));
        const beyond = tab.timeline.clips.filter((clip) => clip.start + clip.duration > last + 1e-6).slice(0, 12).map((clip) => `${clip.id} (${clip.kind}, ${layerGroup(clip.kind) === 'audio' ? 'A' : layerGroup(clip.kind) === 'effects' ? 'FX' : 'V'}${trackOf(clip)}, ends ${seconds(clip.start + clip.duration)} s)`);
        fixes.push(`${prefix}The main footage${mainTrack === undefined ? '' : ` (V${mainTrack})`} ends at ${seconds(last)} s. ${beyond.length ? `These clips run past it: ${beyond.join(', ')}. In ONE call move them earlier with moveClips (an overlay left behind by a ripple moves by the same time the footage moved), trim them with trim edits, or delete them` : 'Extend the footage or shorten what runs past it'}.`);
      }
    }
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
    // Clip-lane checks never render frames. Other lanes render a few, on a hard budget (lib/ai/lanes/task.ts): the
    // frames only confirm that what this request changed draws. Gaps, overlaps, slivers, lengths, linked audio and
    // every caption check are read from the timeline data, never from pixels, and nothing is asked of the caller.
    if (!cheapClip && !failures.length && summary.clipCount && summary.duration > 0) {
      const looked = [...task.evidence].reverse().find((item) => item.tool === 'finishLook' && item.timelineId === tab.timelineId)?.output as { used?: number; seen?: string[] } | undefined;
      const used = looked?.used ?? 0, seen = looked?.seen ?? [];
      const budget = Math.max(0, Math.min(finishFrameBudget(task.lane, taskCheckLevel(task)), FINISH_FRAMES_PER_TASK - used));
      const plan = await finishLookSpots(tab.timeline, baseline, budget, new Set(seen));
      const times = plan.spots.map((spot) => spot.time);
      if (!times.length && plan.keys.length === 0 && used >= FINISH_FRAMES_PER_TASK) warnings.push(`${prefix}This request has used its ${FINISH_FRAMES_PER_TASK} finish frames; this check passed on timeline data alone.`);
      if (times.length) try {
        // One call, one contact sheet: the budget never exceeds a sheet.
        for (let index = 0; index < times.length; index += MAX_SHEET_FRAMES) {
          const batch = times.slice(index, index + MAX_SHEET_FRAMES),
            rendered = await options.render(batch, undefined, tab.timelineId);
          if (
            rendered.frames.length !== batch.length ||
            (!rendered.sheet && rendered.frames.some((frame) => !frame.image))
          )
            throw new Error('Changed-range rendering returned missing frames.');
        }
        if (tab.timelineId === timelineId) options.looked?.(plan.spots);
        // What was looked at is recorded, so a later finish of this request draws only what changed after it.
        await ctx.runMutation(internal.lanes.evidence, { ...scope, evidence: { tool: 'finishLook', timelineId: tab.timelineId, fingerprint: '', input: {}, output: { used: used + times.length, seen: [...seen, ...plan.keys].slice(-600) } } });
        if (options.fastFrameTimes !== undefined && tab.timelineId === timelineId) await ctx.runMutation(internal.lanes.evidence, { ...scope, evidence: fastFrameEvidence(tab.timelineId, key, []) });
      } catch (error) {
        // "Could not look" is not "looked and found a problem": only a render that ran and failed is a failed check.
        // A final check was asked to look, so there it still fails.
        if (error instanceof FramesUnavailableError && taskCheckLevel(task) !== 'final') warnings.push(`${prefix}The changed frames were not drawn (${error.message}) This check passed on timeline data alone; say the result was not looked at.`);
        else failures.push(
          `${prefix}Changed ranges did not render: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    // Captions are checked from data: timing, overlap, reading speed, line length, position and style. Advice only:
    // it comes back with a pass and spends no attempt. (The reel lane's word and sync check above is the blocking one.)
    if (task.lane !== 'clip' && (tab.timelineId !== timelineId || touched.captions)) warnings.push(...captionAdvice(tab.timeline).map((line) => prefix + line));
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
    ...(options.healed?.length ? { healed: options.healed } : {}),
    // A failed check the caller can act on in one step: the single call per problem, and what to expect after it.
    ...(failures.length && fixes.length ? { fixes: [...new Set(fixes)], rerun: fixes.length >= new Set(failures).size && !unfixable ? 'After these calls finish is expected to pass.' : 'These calls repair the listed timeline problems; the other failures need their own repair before finish passes.' } : {}),
  };
  return ctx.runMutation(internal.lanes.recordFinish, { ...scope, result });
}
