import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnalysisError } from './errors';
import { BEAT_ANALYSIS_ENGINE, type BeatMap } from './beat-map';

const run = promisify(execFile);

/** Run the pinned music tracker in the background worker, never in a browser. */
export async function detectMusicBeats(source: string, duration: number, signal: AbortSignal): Promise<BeatMap> {
  const directory = await mkdtemp(join(tmpdir(), 'revline-beats-'));
  try {
    const audio = join(directory, 'music.wav');
    await run('ffmpeg', ['-v', 'error', '-threads', '1', '-i', source, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '22050', '-c:a', 'pcm_s16le', '-y', audio], { signal, timeout: 60_000, maxBuffer: 1024 * 1024 });
    const python = process.env.BEAT_TRACK_PYTHON || join(process.cwd(), '.data/beat-tracking/bin/python');
    const model = process.env.BEAT_TRACK_MODEL_PATH || join(process.cwd(), '.data/beat-tracking-models/hub/checkpoints/beat_this-final0.ckpt');
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
    return value;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
