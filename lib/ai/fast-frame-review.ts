import { equalTimelineValue } from '../editor/timeline-equality';
import { timelineDuration, type Timeline } from '../editor/types';

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

/** Empty moments mean saved-data checks; undefined means the normal per-change checks. */
export function fastReelFrameMoments(tool: string, before: Timeline, after: Timeline): number[] | undefined {
  if (!isPlainReelTimeline(before) || !isPlainReelTimeline(after)) return undefined;
  if (tool === 'retainSourceRanges' || tool === 'cleanSpeech') return [];
  if (['addSubtitlesFromTranscript', 'styleCaptions', 'transformClip', 'cropClip'].includes(tool)) {
    const old = new Map(before.clips.map(clip => [clip.id, clip]));
    const sample = after.clips.find(clip => clip.kind !== 'audio' && !equalTimelineValue(clip, old.get(clip.id)));
    return sample ? [sample.start + sample.duration / 2] : [];
  }
  return undefined;
}

/** Pending local frame checks, carried between finished runner steps. */
export class FastFrameReview {
  private pending: Set<number>;

  constructor(times: number[] = []) { this.pending = new Set(times); }

  changed(before: Timeline, after: Timeline, moments?: number[]) {
    if (equalTimelineValue(before, after)) return;
    const duration = timelineDuration(after), fps = after.fps;
    if (duration <= 0) { this.pending = new Set([0]); return; }
    const lastFrame = Math.max(0, Math.ceil(duration * fps) - 1);
    const clamp = (time: number) => Math.max(0, Math.min(lastFrame, Math.round(time * fps))) / fps;
    this.pending = new Set([...this.pending].map(clamp));
    const previous = new Map(before.clips.map(clip => [clip.id, clip]));
    const current = new Map(after.clips.map(clip => [clip.id, clip]));
    const anchors = moments ?? [
      ...after.clips.filter(clip => !equalTimelineValue(clip, previous.get(clip.id))).flatMap(clip => {
        const old = previous.get(clip.id);
        return old && old.start === clip.start && old.duration === clip.duration && old.sourceStart === clip.sourceStart
          ? [clip.start + clip.duration / 2]
          : [clip.start, clip.start + clip.duration];
      }),
      ...before.clips.filter(clip => !current.has(clip.id)).map(clip => clip.start),
    ];
    if (!anchors.length && moments === undefined) anchors.push(0);
    for (const time of anchors) for (const offset of [-1, 0, 1]) this.pending.add(clamp(clamp(time) + offset / fps));
  }

  reviewed(times: number[], fps: number) {
    for (const pending of this.pending) if (times.some(time => Math.abs(time - pending) < .1 / fps)) this.pending.delete(pending);
  }

  times() { return [...this.pending].sort((a, b) => a - b); }

  feedback() {
    const times = this.times();
    return times.length ? `Fast requires rendered checks before completion. Call getFrames for these changed spots and their adjacent frames, in batches of up to four: ${JSON.stringify(times)}. Inspect the returned images, then finish. No full-video sweep or repeated checks.` : undefined;
  }
}
