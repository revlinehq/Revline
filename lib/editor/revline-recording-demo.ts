import data from './revline-recording-data.json';
import { normalizeTimeline, type Clip, type MediaAsset, type Timeline } from './types';
import type { DemoBuildStep } from './scripted-demo';
import type { DemoCutPreviewPlan } from './f1-recording-demo';

export const REVLINE_RECORDING_ASSETS = data.assets as MediaAsset[];

/** A scripted replay of the authorized day-three edit, independent of its saved project. */
export function revlineRecordingDemoPlan(runId: string) {
  const ids = new Map(data.timeline.clips.map(clip => [clip.id, `${runId}-${clip.id}`]));
  const timeline = normalizeTimeline({ ...data.timeline, clips: data.timeline.clips.map(clip => ({
    ...clip, id: ids.get(clip.id)!,
    ...('linkedClipId' in clip && clip.linkedClipId ? { linkedClipId: ids.get(clip.linkedClipId) } : {}),
  })) } as Timeline);
  const footage = timeline.clips.filter(clip => clip.kind === 'video' || clip.kind === 'audio');
  const compact = { ...timeline, clips: footage };
  const start = 4 + 5 / 30, gap = 2;
  const main = footage.find(clip => clip.kind === 'video')!;
  const sound = footage.find(clip => clip.id === main.linkedClipId);
  const removed: Clip[] = [
    { ...main, id: `${runId}-removed-video`, start, duration: gap, sourceStart: main.sourceStart + main.duration, linkedClipId: `${runId}-removed-audio` },
    ...(sound ? [{ ...sound, id: `${runId}-removed-audio`, start, duration: gap, sourceStart: sound.sourceStart + sound.duration, linkedClipId: `${runId}-removed-video` }] : []),
  ];
  const moving = footage.filter(clip => clip.start >= start - 1e-8);
  const initial = normalizeTimeline({ ...timeline, clips: [
    ...footage.map(clip => clip.start >= start - 1e-8 ? { ...clip, start: clip.start + gap } : clip), ...removed,
  ] });
  const cutPreview: DemoCutPreviewPlan = { start, end: start + gap, removedClipIds: removed.map(clip => clip.id), movingClipIds: moving.map(clip => clip.id), timeline: compact };
  const captions = timeline.clips.filter(clip => clip.kind === 'caption');
  const graphics = timeline.clips.filter(clip => clip.kind !== 'caption' && clip.kind !== 'video' && clip.kind !== 'audio');
  const steps: DemoBuildStep[] = [
    { clips: [], label: 'Tightening the cut', reply: 'I’ll tighten the talking footage, then add subtitles and the keyframe example.', delayMs: 650, narrate: true },
    { clips: captions, label: 'Adding subtitles', reply: 'Adding editable subtitles to the spoken sections.', delayMs: 800, narrate: true },
    { clips: graphics, label: 'Building the keyframe example', reply: 'Adding the text cards, camera movement, and the example overlay.', delayMs: 1000, narrate: true },
  ];
  return { initial, cutPreview, steps, timeline, assets: REVLINE_RECORDING_ASSETS, summary: 'Your short-form edit is ready, with the cuts, subtitles, text cards, and keyframe example on editable tracks. Press play.' };
}
