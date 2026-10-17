import { normalizeTimeline, type Clip, type MediaAsset, type Timeline } from './types';
import type { MotionKeyframe } from './clip-effects';
import { addTransitionClip } from './operations';
import { audioSettings } from './audio-settings';

export type DemoBuildStep = { clips: Clip[]; label: string; reply: string; delayMs: number; narrate?: boolean; previewTime?: number };
export const EMPTY_SCRIPTED_DEMO: Timeline = { fps: 30, aspectRatio: 'landscape', tracks: { visual: 2, overlay: 0, audio: 1, effects: 2 }, clips: [] };
const keyframe = (time: number, patch: Partial<MotionKeyframe> = {}): MotionKeyframe => ({ time, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1, ...patch });

/** Local audio reuses the video container; it never uploads or duplicates the file. */
export function scriptedDemoMedia(originals: readonly MediaAsset[]) {
  const assets = [...originals], audioByVideo = new Map<string, string>(), ids = new Set(assets.map(asset => asset._id));
  for (const video of originals.filter(asset => asset.kind === 'video')) {
    let id = `${video._id}-demo-audio`; while (ids.has(id)) id += '-'; ids.add(id);
    assets.push({ ...video, _id: id, kind: 'audio', thumbnailUrl: undefined, fileName: `${video.fileName} · audio` });
    audioByVideo.set(video._id, id);
  }
  return { assets, audioByVideo };
}

/** A local recording script, never an analysis of the uploaded footage or speech. */
export function scriptedDemoPlan(assets: readonly MediaAsset[], prompt: string, runId: string) {
  const fps = 30;
  const visuals = assets.filter(asset => asset.kind === 'image' || asset.kind === 'video' && Number.isFinite(asset.duration) && asset.duration! >= 1 / fps).slice(0, 8);
  if (!visuals.length) throw new Error('Attach a readable video or image before starting the edit.');
  const aspectRatio = (visuals[0].height ?? 0) > (visuals[0].width ?? 0) ? 'vertical' as const : 'landscape' as const;
  const sound = assets.find(asset => asset.kind === 'audio' && Number.isFinite(asset.duration) && asset.duration! >= 1 / fps);
  const initial = { ...EMPTY_SCRIPTED_DEMO, aspectRatio, tracks: { ...EMPTY_SCRIPTED_DEMO.tracks!, audio: sound ? 2 : 1 } };
  const media = scriptedDemoMedia(assets);
  const steps: DemoBuildStep[] = [];
  const count = Math.min(16, Math.max(12, visuals.length * 2)), cadence = [36, 24, 45, 30, 21, 39];
  const captionLines = [...prompt.matchAll(/[“"]([^”"]{1,64})[”"]/g)].map(match => match[1]);
  if (!captionLines.length) captionLines.push('MAKE IT MOVE', 'ONE GOOD MOMENT', 'KEEP WATCHING', 'MADE IN REVLINE');
  let cursor = 0;
  let previousShot: Clip | undefined;
  for (let index = 0; index < count; index++) {
    const asset = visuals[index % visuals.length];
    const availableFrames = asset.kind === 'image' ? 60 : Math.floor(asset.duration! * fps + 1e-6);
    const frames = Math.min(cadence[index % cadence.length], availableFrames);
    const round = Math.floor(index / visuals.length), rounds = Math.ceil(count / visuals.length);
    const sourceStart = asset.kind === 'image' ? 0 : Math.floor((availableFrames - frames) * round / Math.max(1, rounds - 1)) / fps;
    const duration = frames / fps, start = cursor / fps;
    const shot: Clip = { id: `${runId}-shot-${index}`, kind: asset.kind, assetId: asset._id, track: 1, start, duration, sourceStart };
    const parallel: Clip[] = [shot];
    if (asset.kind === 'video') {
      const audioId = `${shot.id}-audio`;
      Object.assign(shot, { volume: 0, audioSeparated: true, linkedClipId: audioId });
      const audio: Clip = { id: audioId, kind: 'audio', assetId: media.audioByVideo.get(asset._id), track: 1, linkedClipId: shot.id, start, duration, sourceStart, volume: sound ? .3 : 1 };
      audio.audio = { ...audioSettings(audio), fadeIn: Math.min(.025, duration / 4), fadeOut: Math.min(.025, duration / 4) };
      parallel.push(audio);
    }
    if (sound) {
      const remaining = Math.floor(sound.duration! * fps) - cursor;
      if (remaining > 0) {
        const music: Clip = { id: `${runId}-sound-${index}`, kind: 'audio', assetId: sound._id, track: 2, start, sourceStart: start, duration: Math.min(frames, remaining) / fps, volume: .65 };
        music.audio = { ...audioSettings(music), role: 'music', fadeIn: Math.min(.015, music.duration / 4), fadeOut: Math.min(.015, music.duration / 4) };
        parallel.push(music);
      }
    }
    steps.push({ clips: parallel, label: `Building shot ${index + 1} of ${count}`, reply: `Building cuts and sound together. ${index + 1} of ${count} shots placed.`, delayMs: 180 });
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
    if (previousShot && index % 3 === 0) {
      const before = normalizeTimeline({ ...initial, clips: [...steps.flatMap(step => step.clips), ...additions] });
      const transitionId = `${runId}-transition-${index}`;
      const joined = addTransitionClip(before, transitionId, 'crossfade', previousShot.id, shot.id, { duration: .3 });
      additions.push(joined.clips.find(clip => clip.id === transitionId)!);
    }
    steps.push({ clips: additions, label: 'Placing captions and smooth transitions', reply: 'Adding captions, short accents, and smooth crossfades.', delayMs: 420 });
    previousShot = shot;
    cursor += frames;
  }
  const timeline = normalizeTimeline({ ...initial, clips: steps.flatMap(step => step.clips) });
  const audioCount = timeline.clips.filter(clip => clip.kind === 'audio').length;
  return { initial, steps, timeline, assets: media.assets, summary: `${count} shots, ${audioCount} audio blocks, captions, short effects, and smooth crossfades are ready. Press play to see the edit.` };
}
