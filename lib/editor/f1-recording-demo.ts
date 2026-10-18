import waveform from './f1-recording-waveform.json';
import { EMPTY_SCRIPTED_DEMO, type DemoBuildStep } from './scripted-demo';
import { normalizeTimeline, type Clip, type MediaAsset, type Timeline } from './types';
import { DEFAULT_TEXT_APPEARANCE } from './text-style';
import { flashKeyframes, punchKeyframes } from './motion-effect-settings';

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

export type DemoCutPreviewPlan = { start: number; end: number; removedClipIds: string[]; movingClipIds: string[]; timeline: Timeline };

/** Authored demo only: cut seven source seconds, then add editable text and accents. */
export function f1RecordingDemoPlan(runId: string) {
  const base = { ...EMPTY_SCRIPTED_DEMO, tracks: { visual: 2, overlay: 0, audio: 1, effects: 1 } };
  const cutStart = 6, cutEnd = 13;
  const editedTime = (sourceTime: number) => sourceTime >= cutEnd ? sourceTime - (cutEnd - cutStart) : sourceTime;
  const pair = (index: number, sourceStart: number, duration: number, start: number): Clip[] => {
    const id = `${runId}-section-${index}`, audioId = `${id}-audio`;
    return [
      { id, kind: 'video', assetId: 'f1-recording-video', track: 1, start, duration, sourceStart, volume: 0, audioSeparated: true, linkedClipId: audioId },
      { id: audioId, kind: 'audio', assetId: 'f1-recording-audio', track: 1, start, duration, sourceStart, volume: 1, linkedClipId: id },
    ];
  };
  const initial = normalizeTimeline({ ...base, clips: [...pair(0, 0, cutStart, 0), ...pair(1, cutStart, cutEnd-cutStart, cutStart), ...pair(2, cutEnd, 89-cutEnd, cutEnd)] });
  const boundaries = [0, 6, 13, 21, 29, 36, 44, 52, 60, 68, 75, 82, 89];
  const titles: Clip[] = [
    { start: 0, duration: 3.2, text: 'LIGHTS OUT', fontSize: 118 },
    { start: 21.2, duration: 3, text: 'FULL THROTTLE', fontSize: 108 },
    { start: 44.3, duration: 3, text: 'BUILT FOR SPEED', fontSize: 104 },
    { start: 68.25, duration: 3.25, text: 'EVERY SECOND COUNTS', fontSize: 94 },
    { start: 82.3, duration: 3, text: 'NO LIMITS', fontSize: 124 },
  ].map((title, index) => ({ ...title, id: `${runId}-title-${index}`, kind: 'graphic', track: 2, sourceStart: 0,
    fontFamily: 'anton', color: index % 2 ? '#FF5948' : '#FFFFFF', background: 'transparent', x: .5, y: .77, animation: 'none',
    textTemplate: { preset: index % 2 ? 'word-pop' : 'slide-title' },
    textStyle: { ...DEFAULT_TEXT_APPEARANCE, strokeWidth: 1.25, shadowBlur: 8, shadowY: 3, shadowColor: '#000000B3' },
  }));
  const punches: Clip[] = [.35, 22, 45.5, 69.1].map((start, index) => {
    const duration = .9, punch = { amount: 1.06, speed: 1, centerX: .5, centerY: .5, attack: .25, release: .55 };
    return { id: `${runId}-punch-${index}`, kind: 'effect', effectPreset: 'punch', track: 1, start, duration, sourceStart: 0, punch, motion: punchKeyframes(duration, punch) };
  });
  const flashes: Clip[] = [13, 36, 60, 75].map((start, index) => {
    const duration = .2, flash = { strength: .12, attack: .15, release: .7 };
    return { id: `${runId}-flash-${index}`, kind: 'effect', effectPreset: 'flash', track: 1, start, duration, sourceStart: 0, flash, motion: flashKeyframes(duration, flash) };
  });
  const compactClips: Clip[] = [];
  const steps: DemoBuildStep[] = [{ clips: [], label: 'Arranging the remaining clips', reply: 'The gap is closed. I’ll add bold titles and short visual accents around the remaining sequence.', delayMs: 650, narrate: true }];
  boundaries.slice(0, -1).forEach((start, index) => {
    const duration = boundaries[index + 1] - start;
    if (start === cutStart) return;
    compactClips.push(...pair(index, start, duration, editedTime(start)));
    const text = titles.filter(clip => clip.start >= start && clip.start < start + duration);
    if (text.length) steps.push({ clips: text.map(clip => ({ ...clip, start: editedTime(clip.start) })), label: index === 0 ? 'Adding the opening title' : 'Adding animated text',
      reply: 'Adding five animated title cards on a separate, editable text layer.', delayMs: 520,
      ...(index === 0 ? { narrate: true, previewTime: .6 } : {}),
    });
    const effects = [...punches, ...flashes].filter(clip => clip.start >= start && clip.start < start + duration).sort((a, b) => a.start - b.start);
    if (effects.length) steps.push({ clips: effects.map(clip => ({ ...clip, start: editedTime(clip.start) })), label: effects[0].effectPreset === 'flash' ? 'Adding a short flash accent' : 'Adding a subtle punch-in',
      reply: 'Placing four subtle punch-ins and four short flashes on the effects track.', delayMs: 520,
      ...(index === 0 ? { narrate: true } : {}),
    });
  });
  const compact = normalizeTimeline({ ...base, clips: compactClips });
  const cutPreview: DemoCutPreviewPlan = { start: cutStart, end: cutEnd, removedClipIds: pair(1, cutStart, cutEnd-cutStart, cutStart).map(clip => clip.id), movingClipIds: pair(2, cutEnd, 89-cutEnd, cutEnd).map(clip => clip.id), timeline: compact };
  const timeline = normalizeTimeline({ ...compact, clips: [...compact.clips, ...steps.flatMap(step => step.clips)] });
  return { initial, cutPreview, steps, timeline, assets: F1_RECORDING_ASSETS, summary: 'Seven seconds removed, with five animated titles and eight short effects. The retained footage and original sound stay in sync. Press play.' };
}
