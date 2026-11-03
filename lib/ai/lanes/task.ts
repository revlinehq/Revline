import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { laneToolAllowed, type LaneId } from './index';
import type { Timeline } from '../../editor/types';
import { timelineHistoryKey } from '../../editor/timeline-history-key';
import type { LanguageModelMiddleware } from 'ai';
export const MAX_FINISH_ATTEMPTS = 3;
export class LaneFinishError extends Error {}
export async function laneBaseline(
  timelineId: string,
  timeline: Timeline,
  gaps: { start: number; end: number }[],
) {
  return {
    timelineId,
    fingerprint: await timelineHistoryKey(timeline),
    aspectRatio: timeline.aspectRatio,
    clips: await Promise.all(
      timeline.clips.map(async (clip) => ({
        id: clip.id,
        key: await timelineHistoryKey({ ...timeline, clips: [clip] }),
        start: clip.start,
        duration: clip.duration,
      })),
    ),
    gaps,
  };
}
export async function changedFrameTimes(
  timeline: Timeline,
  baseline: {
    timelineId: string;
    fingerprint: string;
    aspectRatio: string;
    clips: { id: string; key: string; start: number; duration: number }[];
    gaps: { start: number; end: number }[];
  },
) {
  const current = await laneBaseline(baseline.timelineId, timeline, []),
    old = new Map(baseline.clips.map((clip) => [clip.id, clip]));
  const changed = current.clips.filter(
    (clip) => old.get(clip.id)?.key !== clip.key,
  );
  const ids = new Set(current.clips.map((clip) => clip.id));
  const anchors = [
    ...changed.flatMap((clip) => [
      clip.start,
      clip.start + clip.duration / 2,
      clip.start + clip.duration,
    ]),
    ...baseline.clips
      .filter((clip) => !ids.has(clip.id))
      .map((clip) => clip.start),
  ];
  if (current.aspectRatio !== baseline.aspectRatio)
    anchors.push(
      ...current.clips.map((clip) => clip.start + clip.duration / 2),
    );
  const duration = Math.max(
      0,
      ...timeline.clips.map((clip) => clip.start + clip.duration),
    ),
    last = Math.max(0, Math.ceil(duration * timeline.fps) - 1);
  return [
    ...new Set(
      anchors.flatMap((time) =>
        [-1, 0, 1].map(
          (offset) =>
            Math.max(
              0,
              Math.min(last, Math.round(time * timeline.fps) + offset),
            ) / timeline.fps,
        ),
      ),
    ),
  ].sort((a, b) => a - b);
}
/** A provider cannot stream a premature completion claim into chat, even if it ignores toolChoice. */
export function laneReplyGate(
  allowed: () => boolean,
  lane: () => LaneId,
  scope: { projectId: string; runId: string },
  noteToolIntent: (name: string) => void,
): LanguageModelMiddleware {
  return {
    transformParams: async ({ params }) => {
      const tools = (params.tools ?? [])
        .filter((tool) => tool.type === 'function')
        .map((tool) => tool.name);
      const forbidden = tools.filter((tool) => !laneToolAllowed(lane(), tool));
      if (forbidden.length)
        throw new LaneFinishError(
          `Model tool exposure crossed the ${lane()} lane: ${forbidden.join(', ')}`,
        );
      console.info(
        `[ai-lane-tools] ${JSON.stringify({ ...scope, lane: lane(), tools })}`,
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
