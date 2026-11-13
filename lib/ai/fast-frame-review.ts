import { z } from 'zod';
import type { LaneEvidence } from './lanes/types';
import { equalTimelineValue } from '../editor/timeline-equality';
import { renderedFrameTime, timelineDuration, type Timeline } from '../editor/types';
import { evenly } from './frame-sampling';

const frameReview = z.object({ pendingFrameTimes: z.array(z.number().nonnegative()) });
export function readFastFrameTimes(evidence: LaneEvidence[], timelineId: string, fingerprint: string) {
  const saved = evidence.find(item => item.tool === 'fastFrameReview' && item.timelineId === timelineId && item.fingerprint === fingerprint);
  const parsed = frameReview.safeParse(saved?.output);
  return parsed.success ? parsed.data.pendingFrameTimes : undefined;
}

export function fastFrameEvidence(timelineId: string, fingerprint: string, pendingFrameTimes: number[]): LaneEvidence {
  return { tool: 'fastFrameReview', timelineId, fingerprint, input: {}, output: { pendingFrameTimes } };
}

/** Motion and layered compositions keep their normal review. */
export function isPlainReelTimeline(timeline: Timeline): boolean {
  return !timeline.clips.some(clip =>
    !['video', 'audio', 'caption'].includes(clip.kind) || clip.motion?.length ||
    clip.effectKeyframes?.length || clip.smoothZoom || clip.cameraMotion ||
    clip.speedRamp?.length || clip.transition || clip.textTemplate || clip.pixelTracking ||
    clip.audioReactive || clip.visualFade || clip.mask || clip.parallax ||
    clip.overlay || clip.frameShrink || clip.flash || clip.punch || clip.shake || clip.pop ||
    clip.effectPreset && clip.effectPreset !== 'none' ||
    clip.animation && clip.animation !== 'none'
  );
}

const SPEECH_CUT_TOOLS = ['retainSourceRanges', 'cleanSpeech', 'readCutScript'];

/** A speech cut on plain footage is checked from data in every lane: timeline data for gaps and overlaps, the script
 * as cut for the words. Its edges queue no rendered frames. Undefined means the normal per-change checks. */
export function speechCutMoments(tool: string, before: Timeline, after: Timeline): number[] | undefined {
  return SPEECH_CUT_TOOLS.includes(tool) && isPlainReelTimeline(before) && isPlainReelTimeline(after) ? [] : undefined;
}

/** Empty moments mean saved-data checks; undefined means the normal per-change checks. */
export function fastReelFrameMoments(tool: string, before: Timeline, after: Timeline): number[] | undefined {
  if (!isPlainReelTimeline(before) || !isPlainReelTimeline(after)) return undefined;
  if (SPEECH_CUT_TOOLS.includes(tool)) return [];
  if (['addSubtitlesFromTranscript', 'styleCaptions', 'transformClip', 'cropClip'].includes(tool)) {
    const old = new Map(before.clips.map(clip => [clip.id, clip]));
    const sample = after.clips.find(clip => clip.kind !== 'audio' && !equalTimelineValue(clip, old.get(clip.id)));
    return sample ? [sample.start + sample.duration / 2] : [];
  }
  return undefined;
}

/** Pending local frame checks (getFrames at each changed spot; a cut edge is the frame before and the frame after), carried between finished runner steps. Lane recipes with frames 'changes' or 'sample' use it. */
export class FastFrameReview {
  private pending: Set<number>;

  /** `limit` is the most frames a standard check asks the model to look at; undefined asks for all of them (a final check). */
  constructor(times: number[] = [], private limit: () => number | undefined = () => undefined) { this.pending = new Set(times); }

  changed(before: Timeline, after: Timeline, moments?: number[]) {
    if (equalTimelineValue(before, after)) return;
    const duration = timelineDuration(after), fps = after.fps;
    if (duration <= 0) { this.pending = new Set([0]); return; }
    const clamp = (time: number) => renderedFrameTime(time, duration, fps);
    this.pending = new Set([...this.pending].map(clamp));
    const previous = new Map(before.clips.map(clip => [clip.id, clip]));
    const current = new Map(after.clips.map(clip => [clip.id, clip]));
    // A clip that only slid along the timeline with everything it shares the picture with (the shots after a ripple
    // delete or trim) draws the same frames as before. The cut that moved it is checked at the clip that changed.
    // A neighbour that slid by another amount, or did not move at all, changes the picture, so the clip keeps its edges.
    const shift = (clip: Timeline['clips'][number]) => {
      const old = previous.get(clip.id);
      return old && old.start !== clip.start && equalTimelineValue({ ...clip, start: 0 }, { ...old, start: 0 }) ? Math.round((clip.start - old.start) * fps) : undefined;
    };
    const rippled = (clip: Timeline['clips'][number]) => {
      const moved = shift(clip);
      return moved !== undefined && after.clips.every(other => other.id === clip.id || other.kind === 'audio' ||
        other.start >= clip.start + clip.duration || clip.start >= other.start + other.duration ||
        shift(other) === moved || shift(other) === undefined && !equalTimelineValue(other, previous.get(other.id)));
    };
    // A cut edge is two frames: the last one before it and the first one after. A change inside a clip is one frame.
    const edges: number[] = [], inside: number[] = moments ? [...moments] : [];
    if (!moments) {
      // Sound has no picture, so a change to it is never a frame to look at.
      let silent = false;
      for (const clip of after.clips) {
        const old = previous.get(clip.id);
        if (equalTimelineValue(clip, old) || rippled(clip)) continue;
        if (clip.kind === 'audio') { silent = true; continue; }
        // Newly added media needs one look at its framing; where it starts and ends is timeline data.
        if (!old || old.start === clip.start && old.duration === clip.duration && old.sourceStart === clip.sourceStart) inside.push(clip.start + clip.duration / 2);
        else edges.push(clip.start, clip.start + clip.duration);
      }
      for (const clip of before.clips) if (!current.has(clip.id)) { if (clip.kind === 'audio') silent = true; else edges.push(clip.start); }
      if (!edges.length && !inside.length && !silent) inside.push(0);
    }
    for (const time of inside) this.pending.add(clamp(time));
    for (const time of edges) for (const offset of [-1, 0]) this.pending.add(clamp(clamp(time) + offset / fps));
  }

  /** A rendered frame satisfies a pending time it was clamped to, so a queue saved before the timeline end moved still clears. */
  reviewed(times: number[], timeline: Timeline) {
    const fps = timeline.fps, duration = timelineDuration(timeline), asked = this.sample();
    const seen = (pending: number) => { const drawn = renderedFrameTime(pending, duration, fps); return times.some(time => Math.abs(time - drawn) < .1 / fps); };
    // Looking at the evenly spaced sample settles a standard check: the rest of a long queue is not asked for.
    if (this.limit() !== undefined && asked.length && asked.every(seen)) { this.pending.clear(); return; }
    for (const pending of this.pending) if (seen(pending)) this.pending.delete(pending);
  }

  restore(times: number[]) { this.pending = new Set(times); }

  /** Keep every pending time on a frame this timeline can draw. A queue carried over from a longer draft that was
   * discarded (a stopped run, a retry) otherwise asks for frames past the end, which no render can ever satisfy. */
  fit(timeline: Timeline) {
    const duration = timelineDuration(timeline);
    this.pending = new Set(duration <= 0 ? [] : [...this.pending].map(time => renderedFrameTime(time, duration, timeline.fps)));
  }

  /** To the millisecond: a frame time such as 42.43333333333 is noise in the model's context on every read. */
  times() { return [...new Set([...this.pending].map(time => Math.round(time * 1000) / 1000))].sort((a, b) => a - b); }

  /** What the model is asked to look at: every pending time, or at a standard check an evenly spaced sheet of them. */
  sample() { const all = this.times(), limit = this.limit(); return limit === undefined ? all : evenly(all, limit); }
}
