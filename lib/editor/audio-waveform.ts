import type { AudioWaveform } from './types';

export function decodeWaveform(waveform: AudioWaveform) {
  const samples = Uint8Array.from(atob(waveform.peaks), value => value.charCodeAt(0));
  const maximum = samples.reduce((peak, value) => Math.max(peak, value), 32);
  return { samples, maximum, samplesPerSecond: waveform.samplesPerSecond };
}

/** Sample the visible pixels against original media time, never stretched trim data. */
export function waveformBars(data: ReturnType<typeof decodeWaveform>, sourceStart: number, duration: number, width: number, from: number, to: number, volume = 1, playbackRate = 1) {
  const bars: { left: number; amplitude: number }[] = [];
  if (width <= 0 || duration <= 0) return bars;
  for (let left = Math.max(0, Math.floor(from / 3) * 3); left < Math.min(width, to); left += 3) {
    const start = Math.floor((sourceStart + left / width * duration * playbackRate) * data.samplesPerSecond);
    const end = Math.max(start + 1, Math.ceil((sourceStart + Math.min(width, left + 3) / width * duration * playbackRate) * data.samplesPerSecond));
    let peak = 0;
    for (let index = Math.max(0, start); index < Math.min(data.samples.length, end); index++) peak = Math.max(peak, data.samples[index]);
    bars.push({ left, amplitude: Math.min(1, peak / data.maximum * Math.max(0, volume)) });
  }
  return bars;
}
