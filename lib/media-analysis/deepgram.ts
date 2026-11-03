import { openAsBlob } from 'node:fs';
import { z } from 'zod';
import { AnalysisError, isRetryableAnalysisError } from './errors';
import { MAX_TRANSCRIPT_WORDS, TRANSCRIPT_VERSION, transcriptFromWords, type Transcript } from './transcript';

const ATTEMPTS = 4;
// Nova-3 keeps every retake and measures each word tightly, so cleanup cuts land
// between words. Filler words are kept so "um"/"uh" can be cut by their own times.
const LISTEN_URL = 'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&filler_words=true&detect_language=true&diarize=true';
const resultSchema = z.object({ results: z.object({ channels: z.array(z.object({ alternatives: z.array(z.object({ words: z.array(z.object({ word: z.string(), punctuated_word: z.string().optional(), start: z.number().finite(), end: z.number().finite(), speaker: z.number().int().nonnegative().optional(), speaker_confidence: z.number().min(0).max(1).optional() })) })) })) }) });

/** Deepgram's measured word timestamps drive captions and speech cuts; Gemini still understands video.
 * `path` is the compressed speech audio of the whole source. */
export async function transcribeWithDeepgram(path: string, duration: number, key: string, signal: AbortSignal): Promise<Transcript> {
  if (!Number.isFinite(duration) || duration <= 0) throw new AnalysisError('The source has no valid transcription duration.', 400);
  for (let attempt = 1; ; attempt++) {
    signal.throwIfAborted();
    try { return await request(path, duration, key, signal); }
    catch (error) {
      if (signal.aborted || !isRetryableAnalysisError(error) || attempt >= ATTEMPTS) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
    }
  }
}

async function request(path: string, duration: number, key: string, signal: AbortSignal): Promise<Transcript> {
  const response = await fetch(LISTEN_URL, { method: 'POST', headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/mpeg' }, body: await openAsBlob(path, { type: 'audio/mpeg' }), signal });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) throw new AnalysisError('Deepgram rejected the transcription API key. Check the media worker’s Deepgram credentials.', 401);
    if (response.status === 402) throw new AnalysisError('Deepgram transcription credits are exhausted. Check the Deepgram project balance.', 429, false);
    if (response.status === 429) throw new AnalysisError('Deepgram transcription is rate limited. Please retry shortly.', 429, true);
    if (response.status === 400 || response.status === 413) throw new AnalysisError('Deepgram could not read this audio. Check the source audio or transcribe a shorter source.', 400);
    throw new AnalysisError(`Deepgram could not transcribe this audio (HTTP ${response.status}).`, 502, true);
  }
  const result = resultSchema.safeParse(await response.json().catch(() => null));
  if (!result.success) throw new AnalysisError('Deepgram returned an unreadable transcription.', 502, true);
  const words = (result.data.results.channels[0]?.alternatives[0]?.words ?? [])
    .map(word => ({ text: (word.punctuated_word ?? word.word).trim(), start: Math.min(duration, Math.max(0, word.start)), end: Math.min(duration, Math.max(0, word.end)), ...(word.speaker !== undefined ? { speaker:word.speaker, speakerConfidence:word.speaker_confidence ?? 0 } : {}) }))
    .filter(word => word.text);
  if (words.length > MAX_TRANSCRIPT_WORDS) throw new AnalysisError('This source exceeds the 100,000-word transcript limit.', 400);
  try { return { ...transcriptFromWords(words, duration), version: TRANSCRIPT_VERSION }; }
  catch (error) { throw new AnalysisError(error instanceof Error ? `Deepgram: ${error.message}` : 'Deepgram returned invalid word timestamps.', 502); }
}
