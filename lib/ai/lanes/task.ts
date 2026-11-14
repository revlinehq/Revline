import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import type { LaneId } from './types';
import type { RunFailureCode } from '../run-failure';
import type { Timeline } from '../../editor/types';
import { timelineHistoryKey } from '../../editor/timeline-history-key';
import { snapTimelineToFrames } from '../../editor/frame-grid';
import type { LanguageModelMiddleware } from 'ai';
/** Failed finish checks that repaired nothing: the same failures again, or no timeline change in between. */
export const MAX_FINISH_ATTEMPTS = 3;
/** Every failed finish check since the task last passed, progress or not: the hard stop for a task that never converges. */
export const MAX_FINISH_CHECKS = 8;
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
      // A step that may show text streams it live until the step shows tool intent; from then on its text is held
      // and released at finish only if the gate is still open, as before. Holding every step's text until finish made
      // each reply arrive in one piece instead of streaming.
      let intent = false;
      const live = new Set<string>();
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream<
            LanguageModelV4StreamPart,
            LanguageModelV4StreamPart
          >({
            transform(part, controller) {
              if (part.type === 'tool-call' || part.type === 'tool-input-start') {
                noteToolIntent(part.toolName);
                intent = true;
              }
              if (
                ['text-start', 'text-delta', 'text-end'].includes(part.type)
              ) {
                const id = (part as { id: string }).id;
                if (part.type === 'text-start' && showText && !intent && allowed()) live.add(id);
                // A live block stops the moment the gate closes (a tool that needs finish showed up mid-block); its end
                // still goes out, so the stream never leaves a block open.
                if (live.has(id)) { if (part.type === 'text-end' || (!intent && allowed())) controller.enqueue(part); }
                else if (showText) held.push(part);
                return;
              }
              // Text after tool intent waits for the step to finish, so a request phrased as a question cannot bypass the gate by editing.
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
