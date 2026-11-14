import { isTransitionClip } from './clip-transitions';
import { linkedClipIds } from './operations';
import { layerGroup, normalizeTimeline, trackOf, type Clip, type Timeline } from './types';

const EPSILON = 1e-6;
const round = (value: number) => Math.round(value * 1000) / 1000;
const endOf = (clip: { start: number; duration: number }) => clip.start + clip.duration;
const lane = (clip: Clip) => `${layerGroup(clip.kind)}:${trackOf(clip)}`;
const label = (clip: Clip) => `${layerGroup(clip.kind) === 'audio' ? 'A' : layerGroup(clip.kind) === 'effects' ? 'FX' : 'V'}${trackOf(clip)}`;

export type MoveRoom = { timeline: Timeline; pushed: { clipId: string; by: number }[] };

/**
 * Make room for a group moved in time on its own layers, the way an insert edit does: every clip outside the group that
 * the moved group would land on, and everything after it on that layer, moves later (with its linked partner) until the
 * group fits. Only clips that start at or after the group's new start on that layer can be pushed; a clip the group
 * would land on from behind cannot, and the refusal names it with the timeDelta that fits instead.
 */
export function makeRoomForMove(input: Timeline, ids: readonly string[], timeDelta: number): MoveRoom {
  const timeline = normalizeTimeline(input), fps = timeline.fps;
  const members = new Set(linkedClipIds(timeline, [...ids]));
  const moving = timeline.clips.filter(clip => members.has(clip.id) && !isTransitionClip(clip));
  // Where the group lands, on the frame grid like the move itself.
  const delta = Math.round(timeDelta * fps) / fps;
  const target = new Map(moving.map(clip => [clip.id, { start: Math.max(0, clip.start + delta), duration: clip.duration }]));
  const pushes = new Map<string, number>();
  for (const key of new Set(moving.map(lane))) {
    const group = moving.filter(clip => lane(clip) === key), landing = group.map(clip => target.get(clip.id)!);
    const others = timeline.clips.filter(clip => !members.has(clip.id) && !isTransitionClip(clip) && lane(clip) === key);
    const hit = others.filter(other => landing.some(spot => other.start < endOf(spot) - EPSILON && spot.start < endOf(other) - EPSILON));
    if (!hit.length) continue;
    const groupStart = Math.min(...landing.map(spot => spot.start)), groupEnd = Math.max(...landing.map(endOf));
    const behind = hit.find(other => other.start < groupStart - EPSILON);
    if (behind) {
      // The group would land on this clip's tail: name it and the delta that puts the group right after it (or before it).
      const after = round(Math.max(...group.map(clip => endOf(behind) - clip.start))), before = round(Math.min(...group.map(clip => behind.start - endOf(clip))));
      const named = JSON.stringify([...ids]);
      throw new Error(`The moved group would land on clip ${behind.id} (${behind.kind}, ${label(behind)}, ${round(behind.start)}–${round(endOf(behind))} s), which starts before the group's new start, so nothing was moved. In one call: moveClips {clipIds: ${named}, timeDelta: ${after}} puts the group right after it${before <= 0 && group.every(clip => clip.start + before >= -EPSILON) ? `, or timeDelta: ${before} right before it` : ''}; or add ${behind.id} to clipIds to move it along. To join footage without gaps or overlaps, closeGaps {} is one call.`);
    }
    // Insert: the first clip in the way and everything after it on this layer move later by the overlap.
    const from = Math.min(...hit.map(other => other.start)), by = groupEnd - from;
    for (const other of others) if (other.start >= from - EPSILON) pushes.set(other.id, Math.max(pushes.get(other.id) ?? 0, by));
  }
  if (!pushes.size) return { timeline: input, pushed: [] };
  // A pushed clip's linked partner goes with it, and so does what follows the partner on its own layer, so picture and
  // sound stay together and the push never lands one sound on another.
  for (const [id, by] of [...pushes]) {
    const clip = timeline.clips.find(item => item.id === id)!, partner = clip.linkedClipId ? timeline.clips.find(item => item.id === clip.linkedClipId) : undefined;
    if (!partner || members.has(partner.id) || pushes.has(partner.id)) continue;
    for (const other of timeline.clips) if (!members.has(other.id) && !isTransitionClip(other) && lane(other) === lane(partner) && other.start >= partner.start - EPSILON) pushes.set(other.id, Math.max(pushes.get(other.id) ?? 0, by));
  }
  // Rounded up to the frame grid, so a push never leaves a sliver of overlap.
  const clips = timeline.clips.map(clip => pushes.has(clip.id) ? { ...clip, start: Math.ceil((clip.start + pushes.get(clip.id)!) * fps - EPSILON) / fps } : clip);
  return { timeline: { ...timeline, clips }, pushed: [...pushes].map(([clipId, by]) => ({ clipId, by: round(by) })) };
}
