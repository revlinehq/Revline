import { ffmpegTime } from '../ffmpeg-time.mjs';
import { runMediaCommand as run } from './media-command';
import { beatTrackModelPath, beatTrackPython } from './worker-tool-path';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnalysisError } from '../media-analysis/errors';
import { BEAT_ANALYSIS_ENGINE, MAX_MUSIC_ENERGY_SECONDS, type BeatMap, type MusicEnergy } from '../media-analysis/beat-map';
import { musicEnergy, SOUND_RATE } from '../media-analysis/sound';


/** Run the pinned music tracker in the background worker, never in a browser. */
export async function detectMusicBeats(source: string, duration: number, signal: AbortSignal): Promise<BeatMap> {
  const directory = await mkdtemp(join(tmpdir(), 'revline-beats-'));
  try {
    const audio = join(directory, 'music.wav'), raw = join(directory, 'music.f32');
    // One decode, two outputs: mono 22.05 kHz for the tracker, and 48 kHz stereo floats (up to the energy limit) for the energy.
    await run('ffmpeg', ['-v', 'error', '-threads', '1', '-i', source, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '22050', '-c:a', 'pcm_s16le', '-y', audio, '-map', '0:a:0', '-vn', '-t', ffmpegTime(MAX_MUSIC_ENERGY_SECONDS), '-ac', '2', '-ar', String(SOUND_RATE), '-f', 'f32le', '-y', raw], { signal, timeout: /^https?:\/\//.test(source) ? undefined : 60_000, maxBuffer: 1024 * 1024 });
    const python = beatTrackPython();
    const model = beatTrackModelPath();
    let stdout: string;
    try {
      ({ stdout } = await run(python, [join(process.cwd(), 'scripts/detect-beats.py'), audio, model], { signal, timeout: 180_000, maxBuffer: 1024 * 1024 }));
    } catch (error) {
      if (signal.aborted) throw error;
      const detail = error as { code?: string; stderr?: string };
      if (detail.code === 'ENOENT' || detail.stderr?.includes('ModuleNotFoundError') || detail.stderr?.includes('Beat model is not installed')) throw new AnalysisError('Music tracking is not configured on the media worker. Install the pinned Beat This dependencies and model.', 503);
      throw new AnalysisError('Music tracking could not finish. Try a shorter audio source.', 502);
    }
    let value: BeatMap;
    try { value = JSON.parse(stdout); } catch { throw new AnalysisError('Music tracking returned unreadable timestamps.', 502); }
    const validTimes = (times: number[]) => Array.isArray(times) && times.length <= 1000 && times.every((time, index) => Number.isFinite(time) && time >= 0 && time <= duration + .05 && (!index || time > times[index - 1]));
    const validHits = (hits: NonNullable<BeatMap['accents']>) => Array.isArray(hits) && validTimes(hits.map(hit => hit.time)) && hits.every(hit => Number.isFinite(hit.strength) && hit.strength >= 0 && hit.strength <= 1);
    if (value.engine !== BEAT_ANALYSIS_ENGINE || !validTimes(value.beats) || !validTimes(value.downbeats ?? []) || !validHits(value.accents ?? []) || !validHits(value.dropCandidates ?? []) || !Number.isFinite(value.bpm) || value.bpm < 0 || value.bpm > 400 || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new AnalysisError('Music tracking returned invalid or excessive events. Try a shorter source.', 502);
    // Energy is extra evidence for analyzeMusic: a beat map without it still serves every beat tool.
    const energy = await measureEnergy(raw).catch(error => { if (signal.aborted) throw error; console.warn('Music energy could not be measured', error); return undefined; });
    return { ...value, ...(energy ? { energy } : {}) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** Loudness, low band and onsets every half second, read from the decoded floats in chunks. */
async function measureEnergy(raw: string): Promise<MusicEnergy> {
  const file = await open(raw), energy = musicEnergy(), chunk = Buffer.alloc(SOUND_RATE * 8);
  try {
    for (let read = 0; (read = (await file.read(chunk, 0, chunk.length, null)).bytesRead) > 0;) energy.push(new Float32Array(chunk.buffer, chunk.byteOffset, Math.floor(read / 8) * 2));
  } finally { await file.close(); }
  return energy.finish();
}
