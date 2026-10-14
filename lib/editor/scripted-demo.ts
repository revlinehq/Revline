import { normalizeTimeline, type Clip, type MediaAsset, type Timeline } from './types';
import type { MotionKeyframe } from './clip-effects';

export type DemoBuildStep = { clips: Clip[]; label: string; reply: string };
export const EMPTY_SCRIPTED_DEMO: Timeline = { fps: 30, aspectRatio: 'landscape', tracks: { visual: 2, overlay: 0, audio: 1, effects: 2 }, clips: [] };
const keyframe = (time: number, patch: Partial<MotionKeyframe> = {}): MotionKeyframe => ({ time, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1, ...patch });

/** A local recording script, never an analysis of the uploaded footage or speech. */
export function scriptedDemoPlan(assets: readonly MediaAsset[], prompt: string, runId: string) {
  const fps = 30;
  const visuals = assets.filter(asset => asset.kind === 'image' || asset.kind === 'video' && Number.isFinite(asset.duration) && asset.duration! >= 1 / fps).slice(0, 8);
  if (!visuals.length) throw new Error('Attach a readable video or image before starting the demo.');
  const aspectRatio = (visuals[0].height ?? 0) > (visuals[0].width ?? 0) ? 'vertical' as const : 'landscape' as const;
  const initial = { ...EMPTY_SCRIPTED_DEMO, aspectRatio };
  const steps: DemoBuildStep[] = [];
  const count = Math.min(8, Math.max(4, visuals.length * 2));
  const captionLines = [...prompt.matchAll(/[“"]([^”"]{1,64})[”"]/g)].map(match => match[1]);
  if (!captionLines.length) captionLines.push('MAKE IT MOVE', 'ONE GOOD MOMENT', 'KEEP WATCHING', 'MADE IN REVLINE');
  let cursor = 0;
  for (let index = 0; index < count; index++) {
    const asset = visuals[index % visuals.length];
    const availableFrames = asset.kind === 'image' ? 60 : Math.floor(asset.duration! * fps + 1e-6);
    const frames = Math.min(60, availableFrames);
    const round = Math.floor(index / visuals.length), rounds = Math.ceil(count / visuals.length);
    const sourceStart = asset.kind === 'image' ? 0 : Math.floor((availableFrames - frames) * round / Math.max(1, rounds - 1)) / fps;
    const duration = frames / fps, start = cursor / fps;
    const shot: Clip = { id: `${runId}-shot-${index}`, kind: asset.kind, assetId: asset._id, track: 1, start, duration, sourceStart };
    steps.push({ clips: [shot], label: `Building shot ${index + 1} of ${count}`, reply: `Building the sequence, one shot at a time. ${index + 1} of ${count} shots placed.` });
    const caption: Clip = { id: `${runId}-caption-${index}`, kind: 'caption', track: 2, start, duration, sourceStart: 0,
      text: captionLines[index % captionLines.length], fontSize: aspectRatio === 'vertical' ? 64 : 78, color: '#FFFFFF', background: '#101010B3', x: .5, y: .8, animation: 'fade' };
    const additions: Clip[] = [caption];
    if (index % 2 === 0) {
      const end = Math.min(duration, .5);
      additions.push({ id: `${runId}-zoom-${index}`, kind: 'effect', effectPreset: 'punch', track: 1, start, duration: end, sourceStart: 0,
        motion: [keyframe(0), keyframe(end * .25, { scale: 1.09 }), keyframe(end)] });
    } else {
      const end = Math.min(duration, .2);
      additions.push({ id: `${runId}-flash-${index}`, kind: 'effect', effectPreset: 'flash', track: 2, start, duration: end, sourceStart: 0,
        motion: [keyframe(0), keyframe(end * .2, { brightness: 1.35 }), keyframe(end)] });
    }
    steps.push({ clips: additions, label: 'Placing captions and effects', reply: 'Adding editable sample captions and short accents on separate tracks.' });
    cursor += frames;
  }
  const sound = assets.find(asset => asset.kind === 'audio' && Number.isFinite(asset.duration) && asset.duration! >= 1 / fps);
  if (sound) steps.push({ clips: [{ id: `${runId}-sound`, kind: 'audio', assetId: sound._id, track: 1, start: 0, sourceStart: 0, duration: Math.min(cursor, Math.floor(sound.duration! * fps)) / fps, volume: .65 }], label: 'Laying in the soundtrack', reply: 'Soundtrack placed under the sequence.' });
  const timeline = normalizeTimeline({ ...initial, clips: steps.flatMap(step => step.clips) });
  return { initial, steps, timeline, summary: `${count} shots, ${count} sample captions, and ${count} short effects are ready. Press play to see the edit.` };
}
