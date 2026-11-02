import { execFile } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { locateFacecam, locateSpeakingFaces } from '../media-analysis/gemini';
import { facecamAnalysis, speakerAnalysis, speakerFocus, type SpeakerAnalysis } from '../media-analysis/clipping';
import type { Transcript } from '../media-analysis/transcript';
import { AnalysisError } from '../media-analysis/errors';
import { scanSourceFaces } from './source-face-evidence';
import { matchSpeakingFaces } from './match-speaking-faces';
import { optionalGeminiVision } from './optional-gemini-vision';
import { trackSourceFace } from './track-source-face';

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

export async function trackSourceSpeakers(source: string, directory: string, duration: number, transcript: Transcript, signal: AbortSignal, progress: (n: number) => void): Promise<SpeakerAnalysis> {
  const words = transcript.words;
  if (!words.length) return { version: 1, start: 0, end: duration, identityScope: 'window', turns: [], focus: [] };
  if (words.some(w => w.speaker === undefined)) throw new AnalysisError('Speaker diarization is unavailable. Run transcription with diarization on the updated worker.', 422);
  const turns: {
    start: number;
    end: number;
    speaker: number;
    text: string;
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
      word.start - previous.end < 0.7 &&
      word.end - previous.start < 12
    ) {
      previous.end = Math.max(previous.end, word.end);
      previous.text += ` ${word.text}`;
      const seconds = Math.max(0, word.end - word.start);
      previous.confidence = (previous.confidence * previous.speechSeconds + confidence * seconds) / Math.max(.001, previous.speechSeconds + seconds);
      previous.speechSeconds += seconds;
    } else if (word.end > word.start)
      turns.push({
        start: word.start,
        end: word.end,
        speaker: word.speaker,
        text: word.text,
        confidence,
        speechSeconds: word.end - word.start,
      });
  }
  if (turns.length > 2000)
    throw new AnalysisError(
      "Speaker analysis supports up to 2,000 turns. Use a shorter source.",
      400,
    );

  const times = Array.from({ length: Math.ceil(duration * 10) }, (_, i) => i / 10);
  const evidence = await scanSourceFaces(source, times, true, signal, n => progress(15 + n * .75));
  const matched = matchSpeakingFaces(evidence, transcript, turns.map(t => ({ ...t, face: null })));
  const missing = matched.turns.filter(t => !t.face && t.end - t.start >= .8);
  if (missing.length) {
    const fallback = await optionalGeminiVision(signal, key => locateSpeakingFaces(source, missing.map(t => ({ ...t, text: words.filter(w => w.start >= t.start && w.end <= t.end).map(w => w.text).join(' ') })), duration, key, signal));
    if (fallback) {
      matched.turns = matched.turns.map(t => fallback.find(f => f.start === t.start && f.end === t.end && f.speaker === t.speaker && f.face && f.confidence >= .7) ?? t);
      const anchors = fallback.flatMap(t => t.face && t.confidence >= .7 ? [{ start: t.start, end: t.end, speaker: t.speaker, x: t.face.x + t.face.w / 2, y: t.face.y + t.face.h / 2 }] : []);
      if (anchors.length) matched.tracked.push(...await trackSourceFace(source, duration, n => progress(90 + n * .09), signal, anchors));
      matched.tracked.sort((a, b) => a.time - b.time);
    }
  }
  const framingTurns = matched.turns.flatMap(turn => {
    if (turn.face || turn.end - turn.start < .8) return [turn];
    const groups: typeof evidence.samples[] = [];
    for (const sample of evidence.samples.filter(s => s.time >= turn.start && s.time < turn.end)) {
      if (sample.faces.length !== 1) continue;
      const previous = groups.at(-1);
      if (previous && sample.time - previous[previous.length - 1].time < .2) previous.push(sample);
      else groups.push([sample]);
    }
    // Visible-face fallback never changes the saved, unresolved voice match.
    return groups.filter(group => group.length >= 8).map(group => {
      const first = group[0].faces[0];
      for (const sample of group) { const face = sample.faces[0]; matched.tracked.push({ time: sample.time, x: face.x + face.w / 2, y: face.y + face.h / 2 }); }
      return { ...turn, start: group[0].time, end: Math.min(turn.end, group[group.length - 1].time + .1), face: { x: first.x, y: first.y, w: first.w, h: first.h }, confidence: .75 };
    });
  });
  matched.tracked.sort((a, b) => a.time - b.time);
  progress(99);
  return speakerAnalysis.parse({ version: 1, start: 0, end: duration, identityScope: 'window', turns: matched.turns, focus: speakerFocus(framingTurns, duration, matched.tracked) });
}
