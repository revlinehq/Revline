import { spawn } from 'node:child_process';
import { basename, extname, join } from 'node:path';
import type { MediaWorkItem } from '../../convex/mediaTasks';
import { audioFadeAttributes, audioSettings, audioVolumeEnvelope } from '../editor/audio-settings';
import { MAX_CLIP_VOLUME } from '../editor/clip-volume';
import { playbackRateOf, sourceEndOf, timelineTimeAtSource } from '../editor/playback-rate';
import type { Clip } from '../editor/types';
import { AnalysisError } from '../media-analysis/errors';
import { analyzeSound, SOUND_RATE, type DecodedTrack, type SoundKind, type SoundResult, type SoundWord, type VisualHit } from '../media-analysis/sound';

type Snapshot = NonNullable<MediaWorkItem['snapshot']>;
const num = (value: number) => String(Math.round(value * 1e6) / 1e6);
// Short audio clips without speech are sound effects; long ones are music.
const EFFECT_LENGTH = 6;

/** Decode a source window to 48 kHz stereo float, sped up as export does; null when the source has no audio. */
function decode(path: string, seek: number, duration: number, rate: number, signal: AbortSignal) {
  const stages: number[] = [];
  let remaining = rate;
  while (remaining < .5 - 1e-9) { stages.push(.5); remaining /= .5; }
  while (remaining > 2 + 1e-9) { stages.push(2); remaining /= 2; }
  if (Math.abs(remaining - 1) >= 1e-9) stages.push(remaining);
  const filter = [...stages.map(stage => `atempo=${num(stage)}`), `aresample=${SOUND_RATE}`].join(',');
  return new Promise<{ left: Float32Array; right: Float32Array } | null>((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-ss', num(seek), '-t', num(duration * rate), '-i', path, '-map', '0:a:0?', '-vn', '-sn', '-dn', '-af', filter, '-ac', '2', '-f', 'f32le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'], signal });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-1000); });
    child.on('error', reject);
    child.on('close', code => {
      const bytes = Buffer.concat(chunks);
      if (!bytes.length) return /does not contain any stream|matches no streams|Output file is empty/i.test(stderr) || code === 0 ? resolve(null) : reject(new AnalysisError(`Audio could not be decoded: ${stderr.trim().slice(-300)}`, 500));
      if (code !== 0) return reject(new AnalysisError(`Audio could not be decoded: ${stderr.trim().slice(-300)}`, 500));
      const samples = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 8) * 2);
      const frames = samples.length / 2, left = new Float32Array(frames), right = new Float32Array(frames);
      for (let i = 0; i < frames; i++) { left[i] = samples[2 * i]; right[i] = samples[2 * i + 1]; }
      resolve({ left, right });
    });
  });
}

/** The clip's gain at a time since its start: its volume lane (ducking, phase fades) times its own fades. */
function gainOf(timeline: Snapshot['timeline'], clip: Clip, volume: number) {
  const points = (JSON.parse(audioVolumeEnvelope(timeline, clip, volume)) as { lanes: { points: { t: number; v: number }[] }[] }).lanes[0].points;
  const { fadeIn, fadeOut } = audioFadeAttributes(clip);
  return (elapsed: number) => {
    let index = 0; while (index + 1 < points.length && points[index + 1].t <= elapsed) index++;
    const a = points[index], b = points[index + 1], lane = b ? a.v + (b.v - a.v) * (elapsed - a.t) / Math.max(1e-9, b.t - a.t) : a.v;
    return lane * (fadeIn > 0 ? Math.min(1, elapsed / fadeIn) : 1) * (fadeOut > 0 ? Math.min(1, Math.max(0, (clip.duration - elapsed) / fadeOut)) : 1);
  };
}

/** Decode every clip that sounds in the range as export mixes it, find the words spoken there, and analyze it. */
export async function measureTimelineSound(snapshot: Snapshot, directory: string, assetUrls: Record<string, string>, audioSourceOffsets: Record<string, number>, range: { start: number; end: number }, signal: AbortSignal, check?: { fps: number; hits: VisualHit[] }): Promise<SoundResult> {
  const { timeline } = snapshot, assets = new Map(snapshot.assets.map(asset => [asset._id as string, asset]));
  const tracks: DecodedTrack[] = [], words: SoundWord[] = [];
  for (const clip of timeline.clips) {
    if (clip.kind !== 'audio' && clip.kind !== 'video' || !clip.assetId) continue;
    const volume = Number.isFinite(clip.volume) ? Math.min(MAX_CLIP_VOLUME, Math.max(0, clip.volume!)) : 1;
    const from = Math.max(range.start, clip.start), to = Math.min(range.end, clip.start + clip.duration), asset = assets.get(clip.assetId), url = assetUrls[clip.assetId];
    if (volume === 0 || to <= from || !asset || !url?.startsWith('./')) continue;
    const rate = playbackRateOf(clip), sourceEnd = sourceEndOf(clip);
    const spoken = (asset.analysis?.transcript?.words ?? []).filter(word => word.text.trim() && word.start >= clip.sourceStart - 1e-7 && word.start < sourceEnd - 1e-7)
      .map(word => ({ text: word.text.trim(), start: Math.round(timelineTimeAtSource(clip, word.start) * 1000) / 1000, end: Math.round(timelineTimeAtSource(clip, Math.min(word.end, sourceEnd)) * 1000) / 1000 }))
      .filter(word => word.end > range.start && word.start < range.end);
    words.push(...spoken);
    const role = audioSettings(clip).role;
    const kind: SoundKind = clip.kind === 'video' ? 'footage' : role === 'voice' || asset.analysis?.transcript?.words.length ? 'voice' : role === 'music' || clip.duration > EFFECT_LENGTH ? 'music' : 'sfx';
    const name = basename(asset.fileName, extname(asset.fileName)).slice(0, 60);
    const offset = clip.kind === 'audio' ? audioSourceOffsets[clip.assetId] ?? 0 : 0;
    const decoded = await decode(join(directory, url.slice(2)), Math.max(0, clip.sourceStart + (from - clip.start) * rate - offset), to - from, rate, signal);
    if (!decoded) continue;
    const gain = gainOf(timeline, clip, volume), first = Math.round((from - range.start) * SOUND_RATE), length = Math.min(decoded.left.length, Math.round((to - from) * SOUND_RATE));
    const left = decoded.left.subarray(0, length), right = decoded.right.subarray(0, length);
    for (let i = 0; i < length; i++) { const g = gain(from - clip.start + i / SOUND_RATE); left[i] *= g; right[i] *= g; }
    tracks.push({ event: { clipId: clip.id, name, kind, start: Math.round(clip.start * 1000) / 1000, end: Math.round((clip.start + clip.duration) * 1000) / 1000, gain: Math.round(volume * 100) / 100 }, offset: first, left, right });
  }
  if (!tracks.length && !check) throw new AnalysisError('Nothing sounds in this range: no audio or footage with sound plays here.', 400);
  const masterGain = Number(process.env.PRODUCER_AUDIO_GAIN ?? 1);
  return analyzeSound(tracks, words.sort((a, b) => a.start - b.start), range, Number.isFinite(masterGain) && masterGain >= 0 ? masterGain : 1, check && { ...check, timelineFps: timeline.fps });
}
