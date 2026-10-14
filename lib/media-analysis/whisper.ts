import { openAsBlob } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { AnalysisError } from './errors';
import { extractTranscriptionAudio } from './io';
import { MAX_TRANSCRIPT_WORDS, transcriptFromWords, type TranscriptWord } from './transcript';

const MAX_UPLOAD_BYTES = 24_000_000; // Leave room below OpenAI's 25 MB limit.
const CHUNK_SECONDS = 3600; // A 32 kbps mono MP3 stays below 15 MB per hour.
const resultSchema = z.object({ text: z.string(), words: z.array(z.object({ word: z.string(), start: z.number().finite(), end: z.number().finite() })).optional() });
const wordLimitError = () => new AnalysisError('This source exceeds the 5,000-word transcript limit. Transcribe a shorter source.', 400);

/** Whisper's measured word timestamps drive captions; Gemini still understands video. */
export async function transcribeWithWhisper(path: string, duration: number, key: string, signal: AbortSignal) {
  if (!Number.isFinite(duration) || duration <= 0) throw new AnalysisError('The source has no valid transcription duration.', 400);
  if ((await stat(path)).size <= MAX_UPLOAD_BYTES) return transcribeChunk(path, duration, key, signal);
  const directory = await mkdtemp(join(tmpdir(), 'revline-whisper-'));
  const words: TranscriptWord[] = [];
  try {
    for (let start = 0; start < duration; start += CHUNK_SECONDS) {
      signal.throwIfAborted();
      const end = Math.min(start + CHUNK_SECONDS, duration), chunk = join(directory, 'speech.mp3');
      await extractTranscriptionAudio(path, chunk, signal, { start, end });
      const transcript = await transcribeChunk(chunk, end - start, key, signal);
      // Chunk alignments are relative to the actual extracted source window.
      words.push(...transcript.words.map(word => ({ ...word, start: word.start + start, end: word.end + start })));
      if (words.length > MAX_TRANSCRIPT_WORDS) throw wordLimitError();
    }
    return buildTranscript(words, duration);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function transcribeChunk(path: string, duration: number, key: string, signal: AbortSignal) {
  if ((await stat(path)).size > MAX_UPLOAD_BYTES) throw new AnalysisError('The compressed audio window exceeds OpenAI’s upload limit. Transcribe a shorter source.', 400);
  const body = new FormData();
  body.append('file', await openAsBlob(path, { type: 'audio/mpeg' }), 'speech.mp3');
  body.append('model', 'whisper-1');
  body.append('response_format', 'verbose_json');
  body.append('timestamp_granularities[]', 'word');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body, signal });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { code?: string } } | null;
    if (response.status === 429 && payload?.error?.code === 'insufficient_quota') throw new AnalysisError('OpenAI transcription billing quota is exhausted. Check the OpenAI project’s credits or spending limit.', 429);
    if (response.status === 429) throw new AnalysisError('OpenAI transcription is rate limited. Please retry shortly.', 429);
    if (response.status === 401) throw new AnalysisError('OpenAI rejected the transcription API key. Check the media worker’s OpenAI credentials.', 503);
    if (response.status === 403) throw new AnalysisError('This OpenAI project or API key does not have access to Whisper transcription. Enable Audio transcription permissions and whisper-1 model access.', 503);
    if (response.status === 400 || response.status === 413) throw new AnalysisError('OpenAI could not read this audio window. Check the source audio or transcribe a shorter source.', 400);
    throw new AnalysisError(`OpenAI could not transcribe this audio (HTTP ${response.status}).`, 502);
  }
  const result = resultSchema.safeParse(await response.json().catch(() => null));
  if (!result.success) throw new AnalysisError('OpenAI Whisper returned an unreadable transcription.', 502);
  if (result.data.text.trim() && !result.data.words?.length) throw new AnalysisError('Whisper returned speech without measured word timestamps. Please retry transcription.', 502);
  return buildTranscript((result.data.words ?? []).map(word => ({ text: word.word, start: word.start, end: word.end })), duration);
}

function buildTranscript(words: TranscriptWord[], duration: number) {
  if (words.length > MAX_TRANSCRIPT_WORDS) throw wordLimitError();
  try { return transcriptFromWords(words, duration); }
  catch (error) {
    throw new AnalysisError(error instanceof Error ? `OpenAI Whisper: ${error.message}` : 'OpenAI Whisper returned invalid word timestamps.', 502);
  }
}
