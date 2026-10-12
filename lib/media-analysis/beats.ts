export type BeatMap = { beats: number[]; bpm: number; confidence: number };

function fft(real: Float64Array, imaginary: Float64Array) {
  const size = real.length;
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let width = 2; width <= size; width *= 2) {
    const angle = -2 * Math.PI / width;
    for (let block = 0; block < size; block += width) {
      for (let i = 0; i < width / 2; i++) {
        const cosine = Math.cos(angle * i);
        const sine = Math.sin(angle * i);
        const a = block + i;
        const b = a + width / 2;
        const re = real[b] * cosine - imaginary[b] * sine;
        const im = real[b] * sine + imaginary[b] * cosine;
        real[b] = real[a] - re;
        imaginary[b] = imaginary[a] - im;
        real[a] += re;
        imaginary[a] += im;
      }
    }
  }
}

/** Spectral-flux onset detection and tempo autocorrelation on the actual source PCM. */
export function detectBeats(samples: Float32Array, sampleRate = 16_000): BeatMap {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 48000) throw new Error('Unsupported audio sample rate.');
  if (samples.length < sampleRate / 2) return { beats: [], bpm: 0, confidence: 0 };
  const size = 512;
  const hop = Math.round(sampleRate / 100);
  const frames = Math.max(0, Math.floor((samples.length - size) / hop) + 1);
  const flux = new Float64Array(frames);
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  const previous = new Float64Array(size / 2);
  const window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  if (energy / samples.length < 1e-8) return { beats: [], bpm: 0, confidence: 0 };
  for (let frame = 0; frame < frames; frame++) {
    const start = frame * hop;
    for (let i = 0; i < size; i++) { real[i] = samples[start + i] * window[i]; imaginary[i] = 0; }
    fft(real, imaginary);
    let onset = 0;
    for (let bin = 2; bin < size / 2; bin++) {
      const magnitude = Math.log1p(Math.hypot(real[bin], imaginary[bin]));
      onset += Math.max(0, magnitude - previous[bin]);
      previous[bin] = magnitude;
    }
    flux[frame] = onset;
  }
  const prefix = new Float64Array(frames + 1);
  const squarePrefix = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) { prefix[i + 1] = prefix[i] + flux[i]; squarePrefix[i + 1] = squarePrefix[i] + flux[i] ** 2; }
  const peaks: { time: number; frame: number; strength: number }[] = [];
  const envelope = new Float64Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    const left = Math.max(0, frame - 50);
    const right = Math.min(frames, frame + 51);
    const count = right - left;
    const mean = (prefix[right] - prefix[left]) / count;
    const deviation = Math.sqrt(Math.max(0, (squarePrefix[right] - squarePrefix[left]) / count - mean ** 2));
    const threshold = mean * 1.4 + deviation * 0.25;
    if (flux[frame] <= threshold || flux[frame] < (flux[frame - 1] ?? -1) || flux[frame] <= (flux[frame + 1] ?? -1)) continue;
    let peakSample = frame * hop;
    for (let index = frame * hop; index < Math.min(samples.length, frame * hop + size); index++) if (Math.abs(samples[index]) > Math.abs(samples[peakSample])) peakSample = index;
    const time = peakSample / sampleRate;
    const last = peaks[peaks.length - 1];
    if (last && time - last.time < 0.2) {
      if (flux[frame] > last.strength) { envelope[last.frame] = 0; peaks[peaks.length - 1] = { time, frame, strength: flux[frame] }; envelope[frame] = flux[frame]; }
    } else { peaks.push({ time, frame, strength: flux[frame] }); envelope[frame] = flux[frame]; }
  }
  if (peaks.length < 3) return { beats: peaks.map(peak => Number(peak.time.toFixed(3))), bpm: 0, confidence: 0 };
  let bestLag = 0;
  let bestScore = 0;
  let bestCorrelation = 0;
  for (let lag = 30; lag <= 100; lag++) {
    let product = 0;
    let aEnergy = 0;
    let bEnergy = 0;
    // A ±1 frame allowance tolerates drift and sample quantization.
    for (let frame = lag; frame < frames; frame++) {
      const a = envelope[frame];
      const b = Math.max(envelope[frame - lag], envelope[frame - lag - 1] ?? 0, envelope[frame - lag + 1] ?? 0);
      product += a * b;
      aEnergy += a * a;
      bEnergy += b * b;
    }
    const correlation = aEnergy && bEnergy ? product / Math.sqrt(aEnergy * bEnergy) : 0;
    const bpm = 60 * sampleRate / (hop * lag);
    const score = correlation * (0.8 + 0.2 * Math.exp(-(Math.log(bpm / 120) ** 2) / 0.5));
    if (score > bestScore) { bestScore = score; bestLag = lag; bestCorrelation = correlation; }
  }
  const gaps = peaks.slice(1).map((peak, i) => peak.time - peaks[i].time).sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)];
  const estimatedGap = bestLag * hop / sampleRate;
  // Use precise observed timing when it agrees with the coarse autocorrelation lag.
  const beatPeriod = Math.abs(medianGap - estimatedGap) < 0.03 ? medianGap : estimatedGap;
  const confidence = Math.max(0, Math.min(1, bestCorrelation * Math.min(1, peaks.length / 8)));
  return {
    beats: peaks.slice().sort((a, b) => b.strength - a.strength).slice(0, 1000).sort((a, b) => a.time - b.time).map(peak => Number(peak.time.toFixed(3))),
    bpm: bestLag && confidence > 0.15 ? Math.round(60 / beatPeriod) : 0,
    confidence: Number(confidence.toFixed(3)),
  };
}
