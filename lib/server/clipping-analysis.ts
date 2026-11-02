import { execFile } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { locateFacecam } from '../media-analysis/gemini';
import { facecamAnalysis, speakerAnalysis, type SpeakerAnalysis } from '../media-analysis/clipping';
import type { Transcript } from '../media-analysis/transcript';
import { AnalysisError } from '../media-analysis/errors';
import { scanSourceFaces } from './source-face-evidence';
import { matchSpeakingFaces } from './match-speaking-faces';
import { optionalGeminiVision } from './optional-gemini-vision';
import { detectShots } from '../media-analysis/detect-shots';

const run = promisify(execFile);
export async function detectSourceFacecam(source: string, directory: string, duration: number, signal: AbortSignal, progress: (n: number) => void) {
  const count = Math.min(80, Math.max(3, Math.ceil(duration / 30)));
  const times = Array.from({ length: count }, (_, i) => Math.min(Math.max(0, duration - .05), i * duration / count));
  const evidence = await scanSourceFaces(source, times, false, signal, n => progress(10 + n * .4));
  const path = join(directory, 'facecam-evidence.json');
  await writeFile(path, JSON.stringify(evidence));
  let analysis;
  try {
    const python = process.env.SCENE_DETECT_PYTHON || join(process.cwd(), '.data/scene-detection/bin/python');
    const { stdout } = await run(python, [join(process.cwd(), 'scripts/detect-facecam.py'), source, path], { signal, maxBuffer: 8 * 1024 * 1024 });
    analysis = facecamAnalysis.parse(JSON.parse(stdout));
  } finally { await rm(path, { force: true }); }
  progress(90);
  const uncertain = analysis.samples.filter(s => s.kind === 'uncertain');
  if (uncertain.length) {
    const fallback = await optionalGeminiVision(signal, async key => {
      const samples = [];
      for (let first = 0; first < uncertain.length; first += 8) {
        const images = [];
        for (const sample of uncertain.slice(first, first + 8)) {
          const path = join(directory, 'facecam-fallback.jpg');
          await run('ffmpeg', ['-v', 'error', '-ss', String(sample.time), '-i', source, '-frames:v', '1', '-q:v', '2', '-y', path], { signal, maxBuffer: 1024 * 1024 });
          try { images.push({ time: sample.time, data: (await readFile(path)).toString('base64') }); }
          finally { await rm(path, { force: true }); }
        }
        samples.push(...await locateFacecam(images, key, signal));
      }
      return samples;
    });
    if (fallback) analysis = { ...analysis, samples: analysis.samples.map(s => fallback.find(f => f.time === s.time && f.kind !== 'uncertain' && f.confidence >= .7) ?? s) };
  }
  progress(99);
  return facecamAnalysis.parse(analysis);
}

export function diarizedSpeakerTurns(transcript: Transcript): SpeakerAnalysis['turns'] {
  const words = transcript.words;
  if (words.some(w => w.speaker === undefined)) throw new AnalysisError('Speaker diarization is unavailable. Run transcription with diarization on the updated worker.', 422);
  const turns: {
    start: number;
    end: number;
    speaker: number;
    confidence: number;
    speechSeconds: number;
  }[] = [];
  for (const word of words) {
    if (word.speaker === undefined) continue;
    const previous = turns.at(-1),
      confidence = word.speakerConfidence ?? 0;
    if (
      previous &&
      previous.speaker === word.speaker &&
      word.start - previous.end < 0.7
    ) {
      previous.end = Math.max(previous.end, word.end);
      const seconds = Math.max(0, word.end - word.start);
      previous.confidence = (previous.confidence * previous.speechSeconds + confidence * seconds) / Math.max(.001, previous.speechSeconds + seconds);
      previous.speechSeconds += seconds;
    } else if (word.end > word.start)
      turns.push({
        start: word.start,
        end: word.end,
        speaker: word.speaker,
        confidence,
        speechSeconds: word.end - word.start,
      });
  }
  if (turns.length > 2000)
    throw new AnalysisError(
      "Speaker analysis supports up to 2,000 turns. Use a shorter source.",
      400,
    );

  return turns.map(turn => ({ start: turn.start, end: turn.end, speaker: turn.speaker, confidence: turn.confidence, face: null }));
}

export async function trackSourceSpeakers(source: string, _directory: string, duration: number, transcript: Transcript, signal: AbortSignal, progress: (n: number) => void): Promise<SpeakerAnalysis> {
  const turns = diarizedSpeakerTurns(transcript);
  const detection = await detectShots(source, duration, signal);
  progress(15);
  const sparseTimes = [...new Set([
    ...Array.from({ length: Math.ceil(duration * 2.5) }, (_, i) => i / 2.5),
    ...detection.shots.map(shot => shot.start),
  ])].filter(time => time < duration).sort((a, b) => a - b);
  const evidence = await scanSourceFaces(source, sparseTimes, true, signal, n => progress(15 + n * .3));
  const first = matchSpeakingFaces(evidence, detection, [], duration);
  const multiFaceShots = detection.shots.filter((_, shot) => first.framing.some(frame => frame.shot === shot && frame.method === 'fallback'));
  const sampled = new Set(sparseTimes);
  const denseTimes = Array.from({ length: Math.ceil(duration * 10) }, (_, i) => i / 10).filter(time => !sampled.has(time) && multiFaceShots.some(shot => time >= shot.start && time < shot.end));
  if (denseTimes.length) {
    const dense = await scanSourceFaces(source, denseTimes, true, signal, n => progress(45 + n * .5));
    evidence.samples.push(...dense.samples);
    evidence.samples.sort((a, b) => a.time - b.time);
  }
  const matched = matchSpeakingFaces(evidence, detection, turns, duration);
  progress(99);
  return speakerAnalysis.parse(matched);
}
