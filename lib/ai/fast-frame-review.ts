import { z } from 'zod';
import type { LaneEvidence } from './lanes/types';
import { equalTimelineValue } from '../editor/timeline-equality';
import { renderedFrameTime, timelineDuration, type Timeline } from '../editor/types';

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

/** Pending local frame checks (getFrames at each change ±1 frame), carried between finished runner steps. Lane recipes with frames 'changes' or 'sample' use it. */
export class FastFrameReview {
  private pending: Set<number>;

  constructor(times: number[] = []) { this.pending = new Set(times); }

  changed(before: Timeline, after: Timeline, moments?: number[]) {
    if (equalTimelineValue(before, after)) return;
    const duration = timelineDuration(after), fps = after.fps;
    if (duration <= 0) { this.pending = new Set([0]); return; }
    const clamp = (time: number) => renderedFrameTime(time, duration, fps);
    this.pending = new Set([...this.pending].map(clamp));
    const previous = new Map(before.clips.map(clip => [clip.id, clip]));
    const current = new Map(after.clips.map(clip => [clip.id, clip]));
    // Frames are for what only pixels show. Sound has no picture; footage that only moved (a ripple after a cut, a
    // reorder) on the bottom picture track shows the same picture, and where it sits is timeline data; newly added media needs one look at its framing.
    const placed: number[] = [];
    // The bottom picture track is the edit's spine; a clip moved on a layer above it changes what is drawn there.
    const base = Math.min(...after.clips.filter(clip => clip.kind === 'video').map(clip => clip.track ?? 1));
    let dataOnly = false;
    const anchors = moments ?? [
      ...after.clips.filter(clip => !equalTimelineValue(clip, previous.get(clip.id))).flatMap(clip => {
        const old = previous.get(clip.id);
        if (clip.kind === 'audio' || old && clip.kind === 'video' && (clip.track ?? 1) === base && equalTimelineValue({ ...clip, start: old.start }, old)) { dataOnly = true; return []; }
        if (!old) { placed.push(clip.start + clip.duration / 2); return []; }
        return old.start === clip.start && old.duration === clip.duration && old.sourceStart === clip.sourceStart
          ? [clip.start + clip.duration / 2]
          : [clip.start, clip.start + clip.duration];
      }),
      ...before.clips.filter(clip => !current.has(clip.id)).flatMap(clip => { if (clip.kind !== 'audio') return [clip.start]; dataOnly = true; return []; }),
    ];
    if (!anchors.length && !placed.length && !dataOnly && moments === undefined) anchors.push(0);
    for (const time of anchors) for (const offset of [-1, 0, 1]) this.pending.add(clamp(clamp(time) + offset / fps));
    for (const time of placed) this.pending.add(clamp(time));
  }

  /** A rendered frame satisfies a pending time it was clamped to, so a queue saved before the timeline end moved still clears. */
  reviewed(times: number[], timeline: Timeline) {
    const fps = timeline.fps, duration = timelineDuration(timeline);
    for (const pending of this.pending) {
      const drawn = renderedFrameTime(pending, duration, fps);
      if (times.some(time => Math.abs(time - drawn) < .1 / fps)) this.pending.delete(pending);
    }
  }

  restore(times: number[]) { this.pending = new Set(times); }

  times() { return [...this.pending].sort((a, b) => a - b); }

  feedback() {
    const times = this.times();
    return times.length ? `This lane requires rendered checks before completion. Call getFrames for these changed spots and their adjacent frames, in batches of up to four: ${JSON.stringify(times)}. Inspect the returned images, then finish. No full-video sweep or repeated checks.` : undefined;
  }
}
