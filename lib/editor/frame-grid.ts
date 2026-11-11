import { isTransitionClip, reconcileTransitionEdits } from './clip-transitions';
import { playbackRateOf } from './playback-rate';
import { layerGroup, normalizeTimeline, trackOf, type Clip, type Timeline } from './types';

/**
 * The timeline's frame grid. Every cut lands on a frame: footage, stills, solid layers and sound start and
 * end on a multiple of 1 / fps, so two clips either share a boundary exactly or are a whole frame apart.
 *
 * The rule, in one place (snapTimelineToFrames):
 *  - An edge goes to the NEAREST frame. A clip is never shorter than one frame.
 *  - A boundary two clips share is rounded once: a clip that starts within a frame of the previous clip's end
 *    on its layer (or of the footage covering the picture just before it) starts exactly where that clip
 *    ends. A gap or overlap shorter than a frame is a rounding artefact, never an editing decision.
 *  - The picture does not slide. When a start moves by a fraction of a frame, the source in-point moves by
 *    the same fraction (times the playback rate), so each timeline instant still shows the same source
 *    instant and pieces cut from one source stay contiguous in it. A speed-ramped clip keeps its ramp and its
 *    in-point: the ramp is authored in clip seconds, so only its start and length move.
 *  - Linked sound takes its video's timing exactly.
 *
 * Old timelines with edges between frames still open and play as saved. They are put on the grid the next
 * time they are written (an assistant or MCP edit, a gesture in the editor), never by a migration.
 */

/** A cut never leaves a piece shorter than this many frames: it is dropped or refused, and the result says so. */
export const MIN_CUT_FRAMES = 2;
const EPSILON = 1e-6;

/** Kinds that carry cuts. Text and FX clips keep their own timing: their tools place them. */
const cuttable = (clip: Clip) => (clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'audio' || clip.kind === 'solid') && !isTransitionClip(clip);
const picture = (clip: Clip) => clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'solid' || clip.kind === 'scene';
const lane = (clip: Clip) => `${layerGroup(clip.kind)}:${trackOf(clip)}`;

export function gridTime(time: number, fps: number) { return Math.round(time * fps) / fps; }
export function onFrameGrid(time: number, fps: number) { return Math.abs(time - gridTime(time, fps)) <= EPSILON; }

export type FrameGridHeal = { kind: 'gap' | 'overlap'; at: number; seconds: number; clipId: string; previousClipId: string };
export type FrameGridResult = { timeline: Timeline; moved: string[]; healed: FrameGridHeal[] };

/**
 * Put every cut on the frame grid and close gaps and overlaps shorter than a frame. Returns the same
 * timeline object when it is already on the grid. Approved clips are never changed: their neighbours meet
 * them where they are. `sourceDuration` (seconds of an asset) keeps a rounded end inside its media. `previous`
 * is the timeline before the edit: a clip the edit only moved (same length and in-point) keeps its in-point,
 * so a move never re-cuts the clip; a clip that was cut or was saved between frames follows the picture rule.
 */
export function snapTimelineToFrames(input: Timeline, sourceDuration?: (assetId: string) => number | undefined, previous?: Timeline): FrameGridResult {
  const timeline = normalizeTimeline(input), fps = timeline.fps;
  if (!Number.isFinite(fps) || fps <= 0) return { timeline: input, moved: [], healed: [] };
  const frame = 1 / fps, byId = new Map(timeline.clips.map(clip => [clip.id, clip]));
  // Linked sound follows its video; it is not rounded on its own.
  const follows = (clip: Clip) => {
    const pair = clip.kind === 'audio' && clip.linkedClipId ? byId.get(clip.linkedClipId) : undefined;
    return pair && pair.kind === 'video' && pair.linkedClipId === clip.id ? pair : undefined;
  };
  const was = new Map((previous?.clips ?? []).map(clip => [clip.id, clip]));
  const onlyMoved = (clip: Clip) => { const old = was.get(clip.id); return !!old && Math.abs(old.duration - clip.duration) <= EPSILON && Math.abs(old.sourceStart - clip.sourceStart) <= EPSILON && Math.abs(old.start - clip.start) > EPSILON; };
  // Clips this function never moves (text, FX, approved work): a rounded edge must not run into them.
  const fixed = timeline.clips.filter(clip => !cuttable(clip) || clip.approval);
  const blocks = (clip: Clip, from: number, to: number) => fixed.some(other => other.id !== clip.id && !isTransitionClip(other) && lane(other) === lane(clip) && [other.start, other.start + other.duration].some(edge => edge > from + EPSILON && edge < to - EPSILON));
  const order = timeline.clips.filter(cuttable).sort((a, b) => a.start - b.start || (a.kind === 'audio' ? 1 : 0) - (b.kind === 'audio' ? 1 : 0) || a.duration - b.duration);
  const placed = new Map<string, { start: number; end: number; sourceStart: number }>();
  const lanes = new Map<string, { id: string; end: number; to: number }>(), healed: FrameGridHeal[] = [];
  let cover: { id: string; end: number; to: number } | undefined;
  for (const clip of order) {
    const end = clip.start + clip.duration, key = lane(clip), before = lanes.get(key);
    let next = placed.get(clip.id);
    if (!next) {
      if (clip.approval || follows(clip)?.approval || !Number.isFinite(clip.start) || !Number.isFinite(clip.duration)) next = { start: clip.start, end, sourceStart: clip.sourceStart };
      else {
        const video = follows(clip);
        if (video && placed.has(video.id)) {
          const lead = placed.get(video.id)!;
          next = { start: lead.start, end: lead.end, sourceStart: Math.max(0, clip.sourceStart + lead.sourceStart - video.sourceStart) };
        } else {
          // The boundary this clip shares: the previous clip on its layer, else the footage covering the picture until it.
          const joins = (edge?: { id: string; end: number; to: number }) => edge && Math.abs(clip.start - edge.end) < frame - EPSILON ? edge : undefined;
          const shared = joins(before) ?? (picture(clip) && cover && clip.start > cover.end ? joins(cover) : undefined);
          let start = shared ? shared.to : onFrameGrid(clip.start, fps) ? clip.start : Math.max(0, gridTime(clip.start, fps));
          // Rounding down into a caption or approved clip that ends just before this one would collide: round up instead.
          if (!shared && start < clip.start && blocks(clip, start, clip.start + EPSILON * 2)) start += frame;
          if (shared && Math.abs(clip.start - shared.end) > EPSILON) healed.push({ kind: clip.start > shared.end ? 'gap' : 'overlap', at: shared.to, seconds: Math.abs(clip.start - shared.end), clipId: clip.id, previousClipId: shared.id });
          let to = onFrameGrid(end, fps) ? end : gridTime(end, fps);
          if (to > end && blocks(clip, end - EPSILON * 2, to) && to - frame >= start + frame - EPSILON) to -= frame;
          if (to < start + frame - EPSILON) to = start + frame;
          const timed = (clip.kind === 'video' || clip.kind === 'audio') && !clip.speedRamp?.length, rate = playbackRateOf(clip);
          const sourceStart = timed && !onlyMoved(clip) ? Math.max(0, clip.sourceStart + (start - clip.start) * rate) : clip.sourceStart;
          // A rounded-up end stays inside its media when the saved end was inside it.
          const limit = timed && clip.assetId ? sourceDuration?.(clip.assetId) : undefined;
          if (limit !== undefined && to > end && sourceStart + (to - start) * rate > limit + EPSILON && to - frame >= start + frame - EPSILON) to -= frame;
          next = { start, end: to, sourceStart };
        }
        const pair = clip.kind === 'video' && clip.linkedClipId ? byId.get(clip.linkedClipId) : undefined;
        if (pair && follows(pair)?.id === clip.id && !pair.approval) placed.set(pair.id, { start: next.start, end: next.end, sourceStart: Math.max(0, pair.sourceStart + next.sourceStart - clip.sourceStart) });
      }
      placed.set(clip.id, next);
    }
    if (!before || end > before.end) lanes.set(key, { id: clip.id, end, to: next.end });
    if (picture(clip) && (!cover || end > cover.end)) cover = { id: clip.id, end, to: next.end };
  }
  const moved: string[] = [];
  const clips = timeline.clips.map(clip => {
    const next = placed.get(clip.id);
    if (!next) return clip;
    const duration = next.end - next.start;
    if (Math.abs(next.start - clip.start) <= EPSILON && Math.abs(duration - clip.duration) <= EPSILON && Math.abs(next.sourceStart - clip.sourceStart) <= EPSILON) return clip;
    moved.push(clip.id);
    return { ...clip, start: next.start, duration, sourceStart: next.sourceStart };
  });
  if (!moved.length) return { timeline: input, moved, healed: [] };
  try { return { timeline: reconcileTransitionEdits(timeline, { ...timeline, clips }), moved, healed }; }
  // A transition that cannot follow its cut keeps the timeline as it was saved rather than refusing the edit.
  catch { return { timeline: input, moved: [], healed: [] }; }
}

export type FootageGap = { start: number; end: number; frames: number; track: number; afterClipId?: string; beforeClipId?: string };

/** Every gap between footage on each visual layer, with the clips either side: what one closeGaps call closes. */
export function footageGaps(input: Timeline): FootageGap[] {
  const timeline = normalizeTimeline(input), gaps: FootageGap[] = [];
  const tracks = new Set(timeline.clips.filter(clip => clip.kind === 'video' || clip.kind === 'image').map(trackOf));
  for (const track of [...tracks].sort((a, b) => a - b)) {
    let end = 0, last: Clip | undefined;
    for (const clip of timeline.clips.filter(clip => layerGroup(clip.kind) === 'visual' && trackOf(clip) === track).sort((a, b) => a.start - b.start)) {
      if (clip.start > end + EPSILON) gaps.push({ start: end, end: clip.start, frames: Math.round((clip.start - end) * timeline.fps * 100) / 100, track, ...(last ? { afterClipId: last.id } : {}), beforeClipId: clip.id });
      if (clip.start + clip.duration > end) { end = clip.start + clip.duration; last = clip; }
    }
  }
  return gaps.sort((a, b) => a.start - b.start);
}

/** Stretches where nothing is on screen: no footage, still or solid on any layer. Sparse overlay layers are not gaps. */
export function pictureGaps(input: Timeline): FootageGap[] {
  const timeline = normalizeTimeline(input), gaps: FootageGap[] = [];
  let end = 0, last: Clip | undefined;
  for (const clip of timeline.clips.filter(picture).sort((a, b) => a.start - b.start)) {
    if (clip.start > end + EPSILON) gaps.push({ start: end, end: clip.start, frames: Math.round((clip.start - end) * timeline.fps * 100) / 100, track: trackOf(clip), ...(last ? { afterClipId: last.id } : {}), beforeClipId: clip.id });
    if (clip.start + clip.duration > end) { end = clip.start + clip.duration; last = clip; }
  }
  return gaps;
}

/** What an edit left empty that was not empty before, for the tool result of the edit that did it. */
export function newPictureGaps(before: Timeline, after: Timeline) {
  const old = pictureGaps(before), frame = 1 / after.fps;
  return pictureGaps(after).filter(gap => !old.some(item => gap.start >= item.start - frame && gap.end <= item.end + frame));
}

export function pictureGapNote(gaps: FootageGap[]) {
  if (!gaps.length) return undefined;
  const list = gaps.slice(0, 12).map(gap => `${seconds(gap.end - gap.start)} at ${seconds(gap.start)} (${gap.afterClipId ? `after ${gap.afterClipId}, ` : ''}before ${gap.beforeClipId} on V${gap.track})`).join('; ');
  return `This edit leaves ${gaps.length === 1 ? 'a gap' : `${gaps.length} gaps`} where nothing is on screen (black frames): ${list}${gaps.length > 12 ? '; and more' : ''}. finish fails on ${gaps.length === 1 ? 'it' : 'them'}. Unless the hole is wanted, call closeGaps now: one call with no arguments closes every gap on the main footage layer (pass track for a gap on another layer). Trims and deletes take ripple:true to close up as they cut.`;
}

const seconds = (value: number) => `${Math.round(value * 1000) / 1000} s`;

/** One line for a tool result: what the frame grid closed, with times and clip ids. */
export function healedNote(healed: FrameGridHeal[]) {
  if (!healed.length) return undefined;
  const gaps = healed.filter(item => item.kind === 'gap'), overlaps = healed.filter(item => item.kind === 'overlap');
  const list = (items: FrameGridHeal[]) => items.slice(0, 12).map(item => `${seconds(item.at)} (${item.previousClipId} | ${item.clipId})`).join(', ') + (items.length > 12 ? `, and ${items.length - 12} more` : '');
  return [gaps.length ? `Closed ${gaps.length} sub-frame gap${gaps.length === 1 ? '' : 's'} at ${list(gaps)}` : '', overlaps.length ? `${gaps.length ? 'r' : 'R'}emoved ${overlaps.length} sub-frame overlap${overlaps.length === 1 ? '' : 's'} at ${list(overlaps)}` : ''].filter(Boolean).join('; ') + '. These were rounding artefacts between frames; cuts now meet on the frame grid and nothing else moved.';
}
