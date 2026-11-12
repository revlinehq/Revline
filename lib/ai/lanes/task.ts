import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import type { LaneId } from './types';
import type { RunFailureCode } from '../run-failure';
import { renderedFrameTime, type Timeline } from '../../editor/types';
import { timelineHistoryKey } from '../../editor/timeline-history-key';
import { snapTimelineToFrames } from '../../editor/frame-grid';
import type { LanguageModelMiddleware } from 'ai';
/** Failed finish checks that repaired nothing: the same failures again, or no timeline change in between. */
export const MAX_FINISH_ATTEMPTS = 3;
/** Every failed finish check since the task last passed, progress or not: the hard stop for a task that never converges. */
export const MAX_FINISH_CHECKS = 8;
/**
 * The frame budget of finish. Everything a check can read from the timeline is read from it: gaps, overlaps,
 * slivers, lengths, linked audio, caption words and timing. Pixels only confirm that what changed draws, so
 * finish renders at most this many frames per call, picked by priority (new cuts, new overlays, one caption
 * sample, first and last frame), and returns them itself. Nothing is ever asked of the caller.
 */
export function finishFrameBudget(lane: string, level: 'standard' | 'final') { return level === 'final' ? 8 : lane === 'reel' ? 3 : 4; }
/** The most frames all finish calls of one request may render on one tab. Past it, finish passes or fails on data alone. */
export const FINISH_FRAMES_PER_TASK = 12;
/** Evenly spaced picks from a sorted list, keeping the first and the last. */
export function evenlySpaced<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  if (limit <= 1) return items.slice(0, Math.max(0, limit));
  return Array.from({ length: limit }, (_, index) => items[Math.round(index * (items.length - 1) / (limit - 1))]);
}
/** The lane's checks still fail after the bounded attempts: the checks refuse the result. */
export class LaneFinishError extends Error { readonly failureCode: RunFailureCode = 'refused'; }
/** One clip's fingerprint, apart from the rest of its timeline: adding a layer or a marker elsewhere must not make
 * every clip read as changed. The frame rate and frame shape stay in, since they change how every clip draws. */
const clipKey = (timeline: Timeline, clip: Timeline['clips'][number]) => timelineHistoryKey({ clips: [clip], fps: timeline.fps, aspectRatio: timeline.aspectRatio });
export async function laneBaseline(
  timelineId: string,
  timeline: Timeline,
  gaps: { start: number; end: number }[],
) {
  return {
    timelineId,
    fingerprint: await timelineHistoryKey(timeline),
    aspectRatio: timeline.aspectRatio,
    // Clip keys are taken on the frame grid: an old timeline saved between frames is put on the grid by the first
    // edit, and that alone must not make every clip count as changed by the request.
    clips: await Promise.all(
      snapTimelineToFrames(timeline).timeline.clips.map(async (clip) => ({
        id: clip.id,
        key: await clipKey(timeline, clip),
        start: clip.start,
        duration: clip.duration,
        sourceStart: clip.sourceStart,
      })),
    ),
    gaps,
  };
}
/**
 * What a request touched on a timeline, so finish scales to the change: adding one header or changing one
 * volume must not replay the checks of footage and captions the request never touched. A removed clip counts
 * as both (its kind is no longer known); without a baseline everything counts.
 */
export async function touchedKinds(timeline: Timeline, baseline: { clips: { id: string; key: string; start: number; duration: number; sourceStart?: number }[] } | undefined) {
  if (!baseline) return { footage: true, captions: true };
  const grid = snapTimelineToFrames(timeline).timeline, old = new Map(baseline.clips.map((clip) => [clip.id, clip]));
  const removed = baseline.clips.some((clip) => !grid.clips.some((current) => current.id === clip.id));
  // Footage is touched when a cut changed: a clip added or removed, or its place, length or in-point moved. A volume,
  // colour or framing change leaves the cut, its script and its caption sync exactly as they were.
  const recut = (clip: Timeline['clips'][number]) => { const was = old.get(clip.id); return !was || Math.abs(was.start - clip.start) > 1e-6 || Math.abs(was.duration - clip.duration) > 1e-6 || was.sourceStart !== undefined && Math.abs(was.sourceStart - clip.sourceStart) > 1e-6; };
  const footage = removed || grid.clips.some((clip) => (clip.kind === 'video' || clip.kind === 'audio' || clip.kind === 'image') && recut(clip));
  const captions = removed || (await Promise.all(grid.clips.filter((clip) => clip.kind === 'caption').map(async (clip) => old.get(clip.id)?.key !== (await clipKey(grid, clip))))).some(Boolean);
  return { footage, captions };
}
export type FinishLookSpot = { time: number; why: 'cut' | 'overlay' | 'changed clip' | 'captions' | 'first frame' | 'last frame' };
/**
 * The few frames a finish check draws. Only clips changed since the task began and not yet looked at count:
 *  1. one caption, when any caption is new or restyled: the whole track shares its style, so one proves it draws;
 *  2. new or moved cuts on footage, spread over the timeline (the first frame after each cut);
 *  3. new or changed overlays and graphics, at their middle;
 *  4. the first and last frame when footage changed.
 * `seen` are clip keys an earlier finish of this request already looked at; `keys` are the ones this look settles.
 */
export async function finishLookSpots(
  timeline: Timeline,
  baseline: { clips: { id: string; key: string; start?: number; duration?: number }[] } | undefined,
  budget: number,
  seen: ReadonlySet<string> = new Set(),
): Promise<{ spots: FinishLookSpot[]; keys: string[] }> {
  const old = new Map((baseline?.clips ?? []).map((clip) => [clip.id, clip.key])), placed = new Map((baseline?.clips ?? []).map((clip) => [clip.id, clip]));
  // A clip whose place and length are as they were was restyled, not recut: one frame inside it, no cut edges.
  const recut = (clip: Timeline['clips'][number]) => { const was = placed.get(clip.id); return !was || was.start === undefined || was.duration === undefined || Math.abs(was.start - clip.start) > 1e-6 || Math.abs(was.duration - clip.duration) > 1e-6; };
  const keyed = await Promise.all(timeline.clips.map(async (clip) => ({ clip, key: (await clipKey(timeline, clip)).slice(0, 16) })));
  const fresh = keyed.filter(({ clip, key }) => clip.kind !== 'audio' && !seen.has(key) && old.get(clip.id)?.slice(0, 16) !== key);
  const keys = fresh.map((item) => item.key);
  const duration = Math.max(0, ...timeline.clips.map((clip) => clip.start + clip.duration)), fps = timeline.fps;
  if (budget <= 0 || !fresh.length || duration <= 0) return { spots: [], keys: [] };
  const at = (time: number) => renderedFrameTime(time, duration, fps);
  const footage = (clip: Timeline['clips'][number]) => clip.kind === 'video' || clip.kind === 'image';
  const track = (clip: Timeline['clips'][number]) => clip.track ?? 1;
  // The layer the edit is cut on: the footage layer holding the most time.
  const totals = new Map<number, number>();
  for (const clip of timeline.clips) if (footage(clip)) totals.set(track(clip), (totals.get(track(clip)) ?? 0) + clip.duration);
  const main = [...totals].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  const changed = fresh.map((item) => item.clip).sort((a, b) => a.start - b.start);
  const captions = changed.filter((clip) => clip.kind === 'caption');
  const onMain = (clip: Timeline['clips'][number]) => footage(clip) && track(clip) === main;
  const cuts = changed.filter((clip) => onMain(clip) && recut(clip) && clip.start > 0.5 / fps);
  const overlays = changed.filter((clip) => clip.kind !== 'caption' && !(onMain(clip) && recut(clip)));
  const spots: FinishLookSpot[] = [], taken = new Set<number>();
  const add = (time: number, why: FinishLookSpot['why']) => { const frame = at(time); if (spots.length < budget && !taken.has(frame)) { taken.add(frame); spots.push({ time: frame, why }); } };
  if (captions.length) add(captions[0].start + Math.min(captions[0].duration / 2, 0.2), 'captions');
  // Leave one frame for an overlay when there is one; cuts take the rest.
  const forCuts = Math.max(0, budget - spots.length - (overlays.length ? 1 : 0));
  for (const clip of evenlySpaced(cuts, Math.max(forCuts, cuts.length && budget - spots.length > 0 ? 1 : 0))) add(clip.start, 'cut');
  for (const clip of evenlySpaced(overlays, Math.max(1, budget - spots.length))) add(clip.start + clip.duration / 2, onMain(clip) ? 'changed clip' : 'overlay');
  if (changed.some((clip) => footage(clip) && recut(clip))) { add(0, 'first frame'); add(duration, 'last frame'); }
  return { spots: spots.sort((a, b) => a.time - b.time), keys };
}
/** A provider cannot stream a premature completion claim into chat, even if it ignores toolChoice. */
export function laneReplyGate(
  allowed: () => boolean,
  lane: () => LaneId,
  scope: { projectId: string; runId: string },
  noteToolIntent: (name: string) => void,
  availableTools: () => string[],
  chosen: () => boolean,
): LanguageModelMiddleware {
  return {
    transformParams: async ({ params }) => {
      const tools = (params.tools ?? [])
        .filter((tool) => tool.type === 'function')
        .map((tool) => tool.name);
      const forbidden = tools.filter((tool) => !availableTools().includes(tool));
      if (forbidden.length)
        throw new LaneFinishError(
          `Model tool exposure crossed the ${lane()} lane: ${forbidden.join(', ')}`,
        );
      console.info(
        `[ai-lane-tools] ${JSON.stringify({ ...scope, lane: chosen()?lane():null, phase:chosen()?'working':'selection', tools })}`,
      );
      return params;
    },
    wrapStream: async ({ doStream }) => {
      const showText = allowed(),
        result = await doStream();
      const held: LanguageModelV4StreamPart[] = [];
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream<
            LanguageModelV4StreamPart,
            LanguageModelV4StreamPart
          >({
            transform(part, controller) {
              if (part.type === 'tool-call' || part.type === 'tool-input-start')
                noteToolIntent(part.toolName);
              if (
                ['text-start', 'text-delta', 'text-end'].includes(part.type)
              ) {
                if (showText) held.push(part);
                return;
              }
              // Buffer until tool intent is known, so a request phrased as a question cannot bypass the gate by editing.
              if (part.type === 'finish') {
                if (showText && allowed())
                  for (const text of held) controller.enqueue(text);
                held.length = 0;
              }
              controller.enqueue(part);
            },
          }),
        ),
      };
    },
  };
}
