import { openAsBlob } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { measureAudioEnergy } from '../server/measure-audio-activity';
import { AUDIO_ACTIVITY_FRAME_SECONDS, type AudioEnergyFrames } from './audio-activity';
import { AnalysisError, isRetryableAnalysisError } from './errors';
import { extractTranscriptionAudio } from './io';
import { MAX_TRANSCRIPT_WORDS, TRANSCRIPT_VERSION, transcriptFromWords, type Transcript, type TranscriptWord } from './transcript';

const MAX_UPLOAD_BYTES = 24_000_000; // Leave room below OpenAI's 25 MB limit.
// Whisper drops repeated takes and smears word times across long inputs: on a
// 4-minute retake-heavy source, whole-file requests lost a third of the words.
// Short windows cut at the quietest moment keep every take with measured timing.
export const WHISPER_WINDOW_MAX_SECONDS = 10;
const WINDOW_MIN_SECONDS = 4, WINDOW_TAIL_SECONDS = 1.5, MIN_SPEECH_SECONDS = .25;
const CONCURRENCY = 4, ATTEMPTS = 4;
const resultSchema = z.object({ text: z.string(), language: z.string().optional(), words: z.array(z.object({ word: z.string(), start: z.number().finite(), end: z.number().finite() })).optional(), segments: z.array(z.object({ start: z.number().finite(), end: z.number().finite(), no_speech_prob: z.number().finite().optional() })).optional() });
const wordLimitError = () => new AnalysisError('This source exceeds the 5,000-word transcript limit. Transcribe a shorter source.', 400);

export type SpeechWindow = { start: number; end: number };

/** Plan windows of at most 10 seconds, each cut at the quietest point the range
 * allows (a pause when one exists), and drop windows without audible speech:
 * Whisper invents text such as "Bye." for near silence. */
export function planSpeechWindows(frames: AudioEnergyFrames, duration: number): SpeechWindow[] {
  const count = frames.rmsDb.length, frame = AUDIO_ACTIVITY_FRAME_SECONDS;
  if (!count || !Number.isFinite(duration) || duration <= 0) return [];
  const sorted = Float32Array.from(frames.rmsDb).sort();
  const floor = sorted[Math.floor(count * .1)], speech = sorted[Math.min(count - 1, Math.floor(count * .9))];
  // Quiet false starts sit well under full speech; only near-floor windows are
  // skipped. Without measurable separation every frame may hold speech.
  const active = speech - floor >= 10 ? floor + (speech - floor) * .35 : -Infinity;
  // 50ms average so a single quiet sample inside a word is not a cut point.
  const smooth = new Float32Array(count);
  for (let index = 0, sum = 0; index < count; index++) {
    sum += frames.rmsDb[index]; if (index >= 5) sum -= frames.rmsDb[index - 5];
    smooth[index] = sum / Math.min(index + 1, 5);
  }
  const cuts = [0];
  while (duration - cuts.at(-1)! > WHISPER_WINDOW_MAX_SECONDS) {
    const at = cuts.at(-1)!, first = Math.ceil((at + WINDOW_MIN_SECONDS) / frame), last = Math.min(count - 1, Math.floor((at + WHISPER_WINDOW_MAX_SECONDS) / frame));
    let best = last, score = Infinity;
    // Prefer the quietest moment; among similar ones, the later cut keeps fewer requests.
    for (let index = first; index <= last; index++) {
      const value = smooth[index] + (last - index) * frame * .3;
      if (value < score) { score = value; best = index; }
    }
    cuts.push(Math.min(duration, Math.max(at + 1, best * frame)));
  }
  // A short remainder joins the previous window instead of becoming a fragment.
  if (cuts.length > 1 && duration - cuts.at(-1)! < WINDOW_TAIL_SECONDS) cuts.pop();
  cuts.push(duration);
  const windows: SpeechWindow[] = [];
  for (let index = 0; index < cuts.length - 1; index++) {
    const start = cuts[index], end = cuts[index + 1];
    let speaking = 0;
    for (let frameIndex = Math.floor(start / frame); frameIndex < Math.min(count, Math.ceil(end / frame)); frameIndex++) if (frames.rmsDb[frameIndex] >= active) speaking++;
    if (speaking * frame >= MIN_SPEECH_SECONDS) windows.push({ start, end });
  }
  return windows;
}

/** Whisper's measured word timestamps drive captions; Gemini still understands video. */
export async function transcribeWithWhisper(path: string, duration: number, key: string, signal: AbortSignal): Promise<Transcript> {
  if (!Number.isFinite(duration) || duration <= 0) throw new AnalysisError('The source has no valid transcription duration.', 400);
  const { frames } = await measureAudioEnergy(path, signal);
  const windows = planSpeechWindows(frames, duration);
  const directory = await mkdtemp(join(tmpdir(), 'revline-whisper-'));
  try {
    const transcribe = (window: SpeechWindow, index: number, language?: string) => transcribeWindow(path, join(directory, `window-${index}.mp3`), window, key, signal, language);
    const results = await mapLimit(windows, CONCURRENCY, (window, index) => transcribe(window, index));
    // Each window detects its own language, so a short or accented one can come
    // back as another language. Re-run outliers in the source's majority language.
    const spoken = new Map<string, number>();
    results.forEach((result, index) => { if (result.language && result.words.length >= 3) spoken.set(result.language, (spoken.get(result.language) ?? 0) + windows[index].end - windows[index].start); });
    const majority = [...spoken].sort((a, b) => b[1] - a[1])[0]?.[0], code = majority ? WHISPER_LANGUAGE_CODES[majority] : undefined;
    if (code) {
      const outliers = results.flatMap((result, index) => result.words.length && result.language && result.language !== majority ? [index] : []);
      const redone = await mapLimit(outliers, CONCURRENCY, index => transcribe(windows[index], index, code));
      outliers.forEach((index, position) => { results[index] = redone[position]; });
    }
    const words = results.flatMap(result => result.words);
    if (words.length > MAX_TRANSCRIPT_WORDS) throw wordLimitError();
    try { return { ...transcriptFromWords(words, duration), version: TRANSCRIPT_VERSION }; }
    catch (error) { throw new AnalysisError(error instanceof Error ? `OpenAI Whisper: ${error.message}` : 'OpenAI Whisper returned invalid word timestamps.', 502); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function transcribeWindow(source: string, path: string, window: SpeechWindow, key: string, signal: AbortSignal, language?: string): Promise<{ words: TranscriptWord[]; language?: string }> {
  await extractTranscriptionAudio(source, path, signal, window);
  if ((await stat(path)).size > MAX_UPLOAD_BYTES) throw new AnalysisError('The compressed audio window exceeds OpenAI’s upload limit. Transcribe a shorter source.', 400);
  for (let attempt = 1; ; attempt++) {
    signal.throwIfAborted();
    try { return await requestWindow(path, window, key, signal, language); }
    catch (error) {
      // A long source makes many requests; one rate-limited or dropped window
      // retries alone instead of failing the whole transcription.
      if (signal.aborted || !isRetryableAnalysisError(error) || attempt >= ATTEMPTS) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
    }
  }
}

async function requestWindow(path: string, window: SpeechWindow, key: string, signal: AbortSignal, language?: string) {
  const body = new FormData();
  body.append('file', await openAsBlob(path, { type: 'audio/mpeg' }), 'speech.mp3');
  body.append('model', 'whisper-1');
  body.append('response_format', 'verbose_json');
  body.append('timestamp_granularities[]', 'word');
  body.append('timestamp_granularities[]', 'segment');
  if (language) body.append('language', language);
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body, signal });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { code?: string } } | null;
    if (response.status === 429 && payload?.error?.code === 'insufficient_quota') throw new AnalysisError('OpenAI transcription billing quota is exhausted. Check the OpenAI project’s credits or spending limit.', 429, false);
    if (response.status === 429) throw new AnalysisError('OpenAI transcription is rate limited. Please retry shortly.', 429, true);
    if (response.status === 401) throw new AnalysisError('OpenAI rejected the transcription API key. Check the media worker’s OpenAI credentials.', 401);
    if (response.status === 403) throw new AnalysisError('This OpenAI project or API key does not have access to Whisper transcription. Enable Audio transcription permissions and whisper-1 model access.', 403);
    if (response.status === 400 || response.status === 413) throw new AnalysisError('OpenAI could not read this audio window. Check the source audio or transcribe a shorter source.', 400);
    throw new AnalysisError(`OpenAI could not transcribe this audio (HTTP ${response.status}).`, 502, true);
  }
  const result = resultSchema.safeParse(await response.json().catch(() => null));
  if (!result.success) throw new AnalysisError('OpenAI Whisper returned an unreadable transcription.', 502, true);
  // Whisper invents words such as "You" over noise and scores those segments as
  // non-speech: 0.85 on a silent clip, while real retake speech reached 0.70.
  const noise = (result.data.segments ?? []).filter(segment => (segment.no_speech_prob ?? 0) >= .8);
  // Whisper can emit empty alignment placeholders inside otherwise valid
  // speech. They contain no spoken text and must not become caption words.
  const words = (result.data.words ?? []).filter(word => word.word.trim() && !noise.some(segment => (word.start + word.end) / 2 >= segment.start && (word.start + word.end) / 2 <= segment.end));
  if (result.data.text.trim() && !words.length && !noise.length) throw new AnalysisError('Whisper returned speech without measured word timestamps. Please retry transcription.', 502, true);
  // Alignments are relative to the extracted window; keep them inside it.
  return {
    language: result.data.language?.toLowerCase(),
    words: words.map(word => {
      const start = Math.min(window.end, window.start + Math.max(0, word.start));
      return { text: word.word, start, end: Math.max(start, Math.min(window.end, window.start + word.end)) };
    }),
  };
}

async function mapLimit<T, R>(items: T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await run(items[index], index); }
  }));
  return results;
}

/** Whisper reports language names; its `language` request field takes ISO 639-1. */
const WHISPER_LANGUAGE_CODES: Record<string, string> = {
  afrikaans: 'af', arabic: 'ar', armenian: 'hy', azerbaijani: 'az', belarusian: 'be', bosnian: 'bs', bulgarian: 'bg', catalan: 'ca', chinese: 'zh', croatian: 'hr', czech: 'cs', danish: 'da', dutch: 'nl', english: 'en', estonian: 'et', finnish: 'fi', french: 'fr', galician: 'gl', german: 'de', greek: 'el', hebrew: 'he', hindi: 'hi', hungarian: 'hu', icelandic: 'is', indonesian: 'id', italian: 'it', japanese: 'ja', kannada: 'kn', kazakh: 'kk', korean: 'ko', latvian: 'lv', lithuanian: 'lt', macedonian: 'mk', malay: 'ms', marathi: 'mr', maori: 'mi', nepali: 'ne', norwegian: 'no', persian: 'fa', polish: 'pl', portuguese: 'pt', romanian: 'ro', russian: 'ru', serbian: 'sr', slovak: 'sk', slovenian: 'sl', spanish: 'es', swahili: 'sw', swedish: 'sv', tagalog: 'tl', tamil: 'ta', thai: 'th', turkish: 'tr', ukrainian: 'uk', urdu: 'ur', vietnamese: 'vi', welsh: 'cy', georgian: 'ka', bengali: 'bn', gujarati: 'gu', punjabi: 'pa', telugu: 'te', malayalam: 'ml', albanian: 'sq', amharic: 'am', basque: 'eu', mongolian: 'mn', uzbek: 'uz', somali: 'so', yoruba: 'yo',
};
