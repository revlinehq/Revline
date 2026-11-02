/** Per-10ms acoustic features of mono PCM: loudness, voicing, pitch and spectral shape. */
const FRAME_SECONDS = .01;
const WINDOW_SECONDS = .03;

export type Frames = {
  /** RMS level in dBFS. */
  db: Float32Array;
  /** Normalized autocorrelation peak 0..1 in the 70-400 Hz pitch range: high means voiced. */
  voicing: Float32Array;
  /** Estimated pitch in Hz, 0 when unvoiced. */
  pitch: Float32Array;
  /** Zero-crossing rate per sample: high for breath and hiss. */
  zcr: Float32Array;
  /** Change of the coarse spectrum from the previous frame: low for held sounds like "uhhh". */
  flux: Float32Array;
  count: number;
};

const BANDS = 12;

/** `samples` are -1..1 floats at `sampleRate`. */
export function analyzeFrames(samples: Float32Array, sampleRate: number): Frames {
  const hop = Math.round(sampleRate * FRAME_SECONDS), size = Math.round(sampleRate * WINDOW_SECONDS);
  const count = Math.max(0, Math.floor((samples.length - size) / hop) + 1);
  const db = new Float32Array(count), voicing = new Float32Array(count), pitch = new Float32Array(count), zcr = new Float32Array(count), flux = new Float32Array(count);
  const minLag = Math.floor(sampleRate / 400), maxLag = Math.min(size - 1, Math.ceil(sampleRate / 70));
  let previous = new Float32Array(BANDS);
  for (let frame = 0; frame < count; frame++) {
    const offset = frame * hop;
    let energy = 0, crossings = 0;
    for (let i = 0; i < size; i++) {
      const x = samples[offset + i];
      energy += x * x;
      if (i && (x >= 0) !== (samples[offset + i - 1] >= 0)) crossings++;
    }
    db[frame] = 10 * Math.log10(Math.max(1e-10, energy / size));
    zcr[frame] = crossings / size;
    // Pitch by normalized autocorrelation; only worth computing on audible frames.
    if (db[frame] > -50 && energy > 0) {
      let best = 0, bestLag = 0;
      for (let lag = minLag; lag <= maxLag; lag++) {
        let sum = 0, left = 0, right = 0;
        for (let i = 0; i + lag < size; i += 2) { const a = samples[offset + i], b = samples[offset + i + lag]; sum += a * b; left += a * a; right += b * b; }
        const r = sum / Math.sqrt(Math.max(1e-12, left * right));
        if (r > best) { best = r; bestLag = lag; }
      }
      voicing[frame] = Math.max(0, best);
      pitch[frame] = best > .5 && bestLag ? sampleRate / bestLag : 0;
    }
    // Coarse spectrum from band-limited energies (cheap Goertzel probes across 100-4000 Hz).
    const bands = new Float32Array(BANDS);
    for (let band = 0; band < BANDS; band++) {
      const frequency = 100 * Math.pow(40, band / (BANDS - 1)), w = 2 * Math.PI * frequency / sampleRate, coefficient = 2 * Math.cos(w);
      let s1 = 0, s2 = 0;
      for (let i = 0; i < size; i++) { const s0 = samples[offset + i] + coefficient * s1 - s2; s2 = s1; s1 = s0; }
      bands[band] = Math.log10(1e-9 + s1 * s1 + s2 * s2 - coefficient * s1 * s2);
    }
    let change = 0;
    for (let band = 0; band < BANDS; band++) change += Math.abs(bands[band] - previous[band]);
    flux[frame] = frame ? change / BANDS : 0;
    previous = bands;
  }
  return { db, voicing, pitch, zcr, flux, count };
}

export const frameAt = (seconds: number) => Math.max(0, Math.round(seconds / FRAME_SECONDS));
export const timeAt = (frame: number) => frame * FRAME_SECONDS;
