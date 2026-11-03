import { z } from 'zod';
import type { Stereo } from './dsp';

// Narration comes from ElevenLabs' text-to-speech. The timestamps endpoint returns each character's start and end,
// which become word timings a film is timed to. There is no local fallback: a failed call places nothing.
const ENDPOINT = 'https://api.elevenlabs.io/v1/text-to-speech';
const MODEL = 'eleven_multilingual_v2';
/** Raw 16-bit mono PCM. 44.1 kHz needs a higher ElevenLabs tier; 24 kHz works on every plan. */
const FORMATS = [['pcm_44100', 44100], ['pcm_24000', 24000]] as const;

export const VOICE_LIMITS = { script: 5000, sample: 300 } as const;

/** A short set of ElevenLabs' default voices that narrate well, each with what it sounds like. */
export const NARRATION_VOICES = [
  { voiceId: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', description: 'Warm, captivating British storyteller, middle-aged male.' },
  { voiceId: 'nPczCjzI2devNBz1zQrb', name: 'Brian', description: 'Deep, resonant and comforting American male; classic narrator and ad read.' },
  { voiceId: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Steady, formal British broadcaster, male.' },
  { voiceId: 'cjVigY5qzO86Huf0OWal', name: 'Eric', description: 'Smooth, trustworthy American tenor, male in his 40s.' },
  { voiceId: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', description: 'Energetic young American male, social media creator.' },
  { voiceId: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', description: 'Wise, mature, balanced older American male.' },
  { voiceId: 'hpp4J3VqNfWAUOO0d1Us', name: 'Bella', description: 'Professional, bright and warm American female educator.' },
  { voiceId: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', description: 'Clear, engaging British female educator.' },
  { voiceId: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', description: 'Knowledgeable, upbeat American female, pleasing alto.' },
  { voiceId: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Velvety, confident British female; warm narration.' },
  { voiceId: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Mature, reassuring, confident young American female.' },
  { voiceId: 'SAz9YHcvj6GT2YYXdXww', name: 'River', description: 'Relaxed, neutral, informative American voice, gender neutral.' },
] as const;

const voiceSettings = {
  speed: z.number().min(.7).max(1.2).optional().describe('Speaking rate, 0.7 to 1.2 (default 1). Slightly slower (0.95) reads calmer for explainers.'),
  stability: z.number().min(0).max(1).optional().describe('0 to 1, default 0.5. Lower is more expressive, higher more even.'),
};
export const voiceInput = z.object({
  voiceId: z.string().trim().min(10).max(40).describe('An ElevenLabs voice ID from listVoices.'),
  script: z.string().trim().min(1).max(VOICE_LIMITS.script).describe('The exact words to speak, punctuated as they should be read: a period is a pause, a comma a short one.'),
  ...voiceSettings,
});
export type VoiceRequest = z.infer<typeof voiceInput>;
export type SpokenWord = { start: number; end: number; text: string };

const apiKey = () => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('Voice generation is not configured (ELEVENLABS_API_KEY is missing).');
  return key;
};
const body = (text: string, settings: { speed?: number; stability?: number }) => JSON.stringify({ text, model_id: MODEL, ...(settings.speed !== undefined || settings.stability !== undefined ? { voice_settings: { ...(settings.speed !== undefined ? { speed: settings.speed } : {}), ...(settings.stability !== undefined ? { stability: settings.stability } : {}) } } : {}) });
const signalOf = (signal?: AbortSignal) => AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120_000)]);
/** The account allows a few concurrent ElevenLabs requests across every session; a busy moment waits and retries instead of failing. */
async function speak(url: string, init: RequestInit, reserve: () => Promise<void>) {
  for (let attempt = 0; ; attempt++) {
    await reserve();
    init.signal?.throwIfAborted();
    const response = await fetch(url, init);
    if (response.status !== 429 || attempt >= 4) return response;
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
  }
}
const failure = async (response: Response) => `ElevenLabs could not generate the voice (${response.status}): ${(await response.text()).slice(0, 300)}`;

/** Speaks a script: mono samples (duplicated to stereo) at their own rate, and when each word starts and ends. */
export async function generateNarration(request: VoiceRequest, signal: AbortSignal | undefined, reserve: () => Promise<void>): Promise<{ samples: Stereo; rate: number; words: SpokenWord[] }> {
  const key = apiKey(), payload = body(request.script, request);
  for (const [index, [format, rate]] of FORMATS.entries()) {
    const response = await speak(`${ENDPOINT}/${encodeURIComponent(request.voiceId)}/with-timestamps?output_format=${format}`, { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' }, body: payload, signal: signalOf(signal) }, reserve);
    if (!response.ok) {
      const detail = await failure(response);
      if (index < FORMATS.length - 1 && (response.status === 401 || response.status === 403 || response.status === 422) && /tier|plan|subscription|output_format/i.test(detail)) continue;
      throw new Error(detail);
    }
    const result = await response.json() as { audio_base64?: string; alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } | null };
    if (!result.audio_base64) throw new Error('ElevenLabs returned no audio.');
    const bytes = Uint8Array.from(atob(result.audio_base64), char => char.charCodeAt(0)), view = new DataView(bytes.buffer), frames = Math.floor(bytes.byteLength / 2);
    const mono = new Float64Array(frames);
    for (let i = 0; i < frames; i++) mono[i] = view.getInt16(i * 2, true) / 32768;
    if (!frames) throw new Error('ElevenLabs returned silent audio.');
    return { samples: [mono, Float64Array.from(mono)], rate, words: wordsOf(result.alignment, frames / rate) };
  }
  throw new Error('ElevenLabs could not generate the voice.');
}

/** A short spoken sample of one voice as MP3, for the user to listen to before choosing. */
export async function generateVoiceSample(voiceId: string, text: string, settings: { speed?: number; stability?: number } = {}, signal: AbortSignal | undefined, reserve: () => Promise<void>): Promise<Uint8Array<ArrayBuffer>> {
  const response = await speak(`${ENDPOINT}/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, { method: 'POST', headers: { 'xi-api-key': apiKey(), 'content-type': 'application/json' }, body: body(text, settings), signal: signalOf(signal) }, reserve);
  if (!response.ok) throw new Error(await failure(response));
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error('ElevenLabs returned an empty sample.');
  return bytes;
}

/** Character timings collapsed to words: a word runs from its first character's start to its last character's end. */
function wordsOf(alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } | null | undefined, duration: number): SpokenWord[] {
  if (!alignment?.characters?.length) throw new Error('ElevenLabs returned no word timings.');
  const words: SpokenWord[] = [];
  let text = '', start = 0, end = 0;
  const flush = () => { if (text.trim()) words.push({ start: round(start), end: round(Math.min(Math.max(end, start), duration)), text: text.trim() }); text = ''; };
  alignment.characters.forEach((char, i) => {
    if (/\s/.test(char)) { flush(); return; }
    if (!text) start = alignment.character_start_times_seconds[i] ?? end;
    text += char; end = alignment.character_end_times_seconds[i] ?? start;
  });
  flush();
  return words;
}
const round = (value: number) => Math.round(value * 1000) / 1000;
