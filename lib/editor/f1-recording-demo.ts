import waveform from './f1-recording-waveform.json';
import { EMPTY_SCRIPTED_DEMO, type DemoBuildStep } from './scripted-demo';
import { normalizeTimeline, type Clip, type MediaAsset } from './types';

export const F1_RECORDING_ASSETS: MediaAsset[] = [
  {
    _id: 'f1-recording-video', kind: 'video', fileName: 'F1 edit · Prime Editx',
    url: '/demo/f1-edit/source.mp4', thumbnailUrl: '/demo/f1-edit/poster.jpg',
    duration: 89, width: 1280, height: 720, waveform, audioAssetId: 'f1-recording-audio', audioExtracted: true,
  },
  {
    _id: 'f1-recording-audio', kind: 'audio', fileName: 'F1 edit · original audio',
    url: '/demo/f1-edit/source.m4a', duration: 89, waveform,
  },
];

/** Places the prepared F1 edit in contiguous sections, preserving its original sound. */
export function f1RecordingDemoPlan(runId: string) {
  const initial = { ...EMPTY_SCRIPTED_DEMO, tracks: { visual: 1, overlay: 0, audio: 1, effects: 0 } };
  const boundaries = [0, 6, 13, 21, 29, 36, 44, 52, 60, 68, 75, 82, 89];
  const steps: DemoBuildStep[] = boundaries.slice(0, -1).map((start, index) => {
    const duration = boundaries[index + 1] - start;
    const id = `${runId}-section-${index}`, audioId = `${id}-audio`;
    const video: Clip = {
      id, kind: 'video', assetId: 'f1-recording-video', track: 1,
      start, duration, sourceStart: start, volume: 0, audioSeparated: true, linkedClipId: audioId,
    };
    const audio: Clip = {
      id: audioId, kind: 'audio', assetId: 'f1-recording-audio', track: 1,
      start, duration, sourceStart: start, volume: 1, linkedClipId: id,
    };
    return {
      clips: [video, audio], label: `Placing section ${index + 1} of 12`,
      reply: `Arranging the prepared F1 sequence. ${index + 1} of 12 sections placed.`, delayMs: 260,
    };
  });
  const timeline = normalizeTimeline({ ...initial, clips: steps.flatMap(step => step.clips) });
  return { initial, steps, timeline, assets: F1_RECORDING_ASSETS, summary: 'The F1 sequence is ready. Press play.' };
}
