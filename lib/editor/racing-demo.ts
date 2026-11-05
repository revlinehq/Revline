import shots from '../../public/demo/racing/manifest.json';
import { DEFAULT_AUDIO_SETTINGS } from './audio-settings';
import { NEUTRAL_MOTION } from './motion-path';
import { DEFAULT_TEXT_APPEARANCE } from './text-style';
import { EMPTY_SCRIPTED_DEMO, type DemoBuildStep } from './scripted-demo';
import { normalizeTimeline, type Clip, type MediaAsset } from './types';

/** Six local, pre-cut sources. Native sound is extracted separately, never synthesized. */
export const RACING_DEMO_ASSETS: MediaAsset[] = shots.flatMap(shot => {
  const id = `racing-${shot.id}`, audioAssetId = `${id}-audio`, path = `/demo/racing/${shot.id}`;
  return [
    { _id: id, kind: 'video', fileName: `${shot.id}.mp4`, url: `${path}.mp4`, thumbnailUrl: `${path}.jpg`, duration: shot.duration, width: shot.width, height: shot.height, audioAssetId, audioExtracted: true, waveform: shot.waveform },
    { _id: audioAssetId, kind: 'audio', fileName: `${shot.id} · original sound`, url: `${path}.m4a`, duration: shot.duration, waveform: shot.waveform },
  ];
});

function wheelZoom(id: string, start: number, duration: number, amount: number, centerX: number, centerY: number): Clip {
  const smooth = (value: number) => value * value * (3 - 2 * value);
  return { id, kind: 'effect', effectPreset: 'quick-zoom-in', track: 1, start, duration, sourceStart: 0,
    motion: Array.from({ length: 25 }, (_, index) => {
      const progress = index / 24, scale = 1 + (amount - 1) * smooth(progress <= .5 ? progress * 2 : (1 - progress) * 2);
      return { ...NEUTRAL_MOTION, time: duration * progress, scale, x: (.5 - centerX) * (scale - 1), y: (.5 - centerY) * (scale - 1) };
    }),
  };
}

/** A fixed recording script with editable cuts, titles, sound, and two wheel accents. */
export function racingDemoPlan(runId: string) {
  const initial = { ...EMPTY_SCRIPTED_DEMO, tracks: { visual: 2, overlay: 0, audio: 1, effects: 1 } };
  const titles: Clip[] = [
    { text: 'RACE DAY', start: 0, duration: 2, fontSize: 140, y: .27 },
    { text: 'EVERY SECOND', start: 4.4, duration: 1.8, fontSize: 112, y: .25 },
    { text: 'COUNTS', start: 10.2, duration: 3, fontSize: 164, y: .32 },
  ].map((title, index) => ({
    ...title, id: `${runId}-title-${index}`, kind: 'graphic', track: 2, sourceStart: 0,
    fontFamily: 'anton', color: index === 2 ? '#FF593D' : '#FFFFFF', background: 'transparent', x: .5, animation: 'none',
    textTemplate: { preset: 'slide-title' },
    textStyle: { ...DEFAULT_TEXT_APPEARANCE, strokeWidth: 1.5, shadowBlur: 8, shadowY: 3, shadowColor: '#000000B3' },
  }));
  const zooms = [
    wheelZoom(`${runId}-zoom-wheel-change`, 4.4, 1.8, 1.04, .32, .62),
    wheelZoom(`${runId}-zoom-wheel-fit`, 8.6, 1.6, 1.05, .3, .56),
  ];
  const steps: DemoBuildStep[] = [];
  let cursor = 0;
  for (const [index, source] of shots.entries()) {
    const assetId = `racing-${source.id}`, id = `${runId}-shot-${index}`, audioId = `${id}-audio`;
    const start = cursor / 30, duration = source.frames / 30;
    const video: Clip = { id, kind: 'video', assetId, track: 1, start, duration, sourceStart: 0, volume: 0, audioSeparated: true, linkedClipId: audioId };
    const audio: Clip = { id: audioId, kind: 'audio', assetId: `${assetId}-audio`, track: 1, start, duration, sourceStart: 0, volume: 1, linkedClipId: id,
      audio: { ...DEFAULT_AUDIO_SETTINGS, ducking: { ...DEFAULT_AUDIO_SETTINGS.ducking }, fadeIn: .025, fadeOut: .025 } };
    steps.push({ clips: [video, audio], label: `Placing shot ${index + 1} of ${shots.length}`, reply: 'Building six racing shots with the original pit and track sound.', delayMs: 260 });
    const additions = [...titles, ...zooms].filter(clip => clip.start >= start - 1e-7 && clip.start < start + duration - 1e-7);
    if (additions.length) steps.push({ clips: additions, label: 'Adding titles and wheel accents', reply: 'Adding three short titles and two smooth zooms around the wheel changes.', delayMs: 360 });
    cursor += source.frames;
  }
  const timeline = normalizeTimeline({ ...initial, clips: steps.flatMap(step => step.clips) });
  return { initial, steps, timeline, assets: RACING_DEMO_ASSETS, summary: '13.2 seconds, six shots, original audio, three titles, and two subtle zooms are ready. Every layer is editable. Press play.' };
}
