import { SR, type Stereo } from './dsp';

/** Generated audio peaks here, like the library files, so clip gain means the same thing for all of it. */
export const GENERATED_SOUND_PEAK = 10 ** (-3 / 20);

/** 16-bit PCM WAV with deterministic TPDF dither. */
export function encodeWav([left, right]: Stereo, rate = SR): Uint8Array<ArrayBuffer> {
  const n = left.length, bytes = new Uint8Array(44 + n * 4), view = new DataView(bytes.buffer), text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, 36 + n * 4, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, n * 4, true);
  let s = 0x9e3779b9;
  const dither = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for (let i = 0; i < n; i++) for (let ch = 0; ch < 2; ch++) {
    const v = (ch === 0 ? left : right)[i] + (dither() - dither()) / 32768;
    view.setInt16(44 + i * 4 + ch * 2, Math.round(Math.min(1, Math.max(-1, v)) * 32767), true);
  }
  return bytes;
}

/** The editor's waveform: base64 bytes of the per-10 ms peak of the mono mix. */
export function soundWaveform([left, right]: Stereo, rate = SR) {
  const bucketSize = Math.round(rate / 100), peaks = new Uint8Array(Math.ceil(left.length / bucketSize));
  for (let bucket = 0; bucket < peaks.length; bucket++) {
    let level = 0;
    for (let i = bucket * bucketSize; i < Math.min(left.length, (bucket + 1) * bucketSize); i++) level = Math.max(level, Math.abs((left[i] + right[i]) / 2));
    peaks[bucket] = Math.min(255, Math.round(level * 255));
  }
  let binary = '';
  for (const byte of peaks) binary += String.fromCharCode(byte);
  return { peaks: btoa(binary), samplesPerSecond: 100 };
}
