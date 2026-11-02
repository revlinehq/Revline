import { spawn } from 'node:child_process';
import type { Transcript } from '@/lib/media-analysis/transcript';
import { analyzeSpeech, MAX_CLEANUP_CUTS, MAX_CLEANUP_DETAIL, SPEECH_CLEANUP_VERSION, type SpeechCleanup } from '@/lib/speech-cleanup';

const SAMPLE_RATE = 16_000;
/** Mono float PCM for an hour is about 230 MB; longer sources skip the acoustic map. */
const MAX_SPEECH_CLEANUP_SECONDS = 3600;

/** The cleanup map for a source in SOURCE seconds: fillers, breaths, pauses and abandoned takes. */
export async function measureSpeechCleanup(input: string, duration: number, transcript: Transcript, signal: AbortSignal): Promise<SpeechCleanup | undefined> {
  if (!transcript.words.length || !Number.isFinite(duration) || duration <= 0 || duration > MAX_SPEECH_CLEANUP_SECONDS) return undefined;
  const samples = await decodeMono(input, duration, signal);
  const measured = analyzeSpeech(transcript.words, samples, SAMPLE_RATE);
  const cuts = measured.cuts.slice(0, MAX_CLEANUP_CUTS).map(cut => ({ ...cut, start: Math.max(0, cut.start), end: Math.min(duration, cut.end), detail: cut.detail.slice(0, MAX_CLEANUP_DETAIL) })).filter(cut => cut.end > cut.start);
  // Millisecond precision keeps the saved edges small: two numbers per transcript word.
  const edges = measured.edges.flatMap(edge => [Math.round(edge.start * 1000) / 1000, Math.round(Math.min(duration, edge.end) * 1000) / 1000]);
  return { version: SPEECH_CLEANUP_VERSION, cuts, edges };
}

/** Source-time aligned mono PCM, the same timing basis as the transcript and audio activity. */
async function decodeMono(input: string, duration: number, signal: AbortSignal) {
  const capacity = Math.ceil((duration + 1) * SAMPLE_RATE);
  const samples = new Float32Array(capacity);
  const child = spawn('ffmpeg', ['-v', 'error', '-copyts', '-i', input, '-map', '0:a:0', '-vn', '-ac', '1', '-af', `aresample=${SAMPLE_RATE}:async=1:first_pts=0`, '-acodec', 'pcm_f32le', '-f', 'f32le', '-'], { signal, timeout: 300_000, stdio: ['ignore', 'pipe', 'pipe'] });
  let errorOutput = '';
  child.stderr.on('data', (chunk: Buffer) => { if (errorOutput.length < 4096) errorOutput += chunk.toString().slice(0, 4096 - errorOutput.length); });
  const completion = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Could not decode speech audio: ${errorOutput.trim() || `ffmpeg exited ${code}`}`)));
  });
  void completion.catch(() => {});
  let count = 0, remainder: Buffer = Buffer.alloc(0);
  for await (const raw of child.stdout) {
    const chunk = remainder.length ? Buffer.concat([remainder, raw as Buffer]) : raw as Buffer;
    const bytes = chunk.length - chunk.length % 4;
    for (let offset = 0; offset < bytes && count < capacity; offset += 4) {
      const value = chunk.readFloatLE(offset);
      samples[count++] = Number.isFinite(value) ? value : 0;
    }
    remainder = chunk.subarray(bytes);
  }
  await completion;
  return samples.subarray(0, count);
}
