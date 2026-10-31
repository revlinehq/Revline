import { z } from 'zod';
import type { Stereo } from './dsp';
import { GENERATED_SOUND_PEAK } from './wav';

// Sound effects come from ElevenLabs' text-to-sound model. There is no local fallback: a failed call places nothing.
const ENDPOINT = 'https://api.elevenlabs.io/v1/sound-generation';
const MODEL = 'eleven_text_to_sound_v3';
/** WAV carries its own rate and channel count. 44.1 kHz needs a higher ElevenLabs tier; 24 kHz works on every plan. */
const FORMATS = ['wav_44100', 'wav_24000'] as const;

export const SOUND_EFFECT_LIMITS = { prompt: 450, minDuration: .5, maxDuration: 30 } as const;

export const soundEffectInput = z.object({
  prompt: z.string().trim().min(3).max(SOUND_EFFECT_LIMITS.prompt).describe('What the sound is, like a sound designer would brief it: the source, texture, motion and tail. "Soft airy whoosh passing left to right, short tail", "Crisp glass UI tick", "Deep cinematic boom with sub tail". No music, no speech.'),
  duration: z.number().min(SOUND_EFFECT_LIMITS.minDuration).max(SOUND_EFFECT_LIMITS.maxDuration).optional().describe('Seconds. Match the motion it scores (a whoosh as long as the slide). Omit to let the model choose.'),
  loop: z.boolean().optional().describe('A seamless loop, for ambience under a long shot.'),
  promptInfluence: z.number().min(0).max(1).optional().describe('0 to 1, default 0.3. Higher follows the prompt more literally.'),
});
export type SoundEffectRequest = z.infer<typeof soundEffectInput>;

/** Generates one sound effect: stereo samples starting at its first audible sample, peaking with the library. */
export async function generateSoundEffect(request: SoundEffectRequest, signal?: AbortSignal): Promise<{ samples: Stereo; rate: number }> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('Sound generation is not configured (ELEVENLABS_API_KEY is missing).');
  const body = JSON.stringify({ text: request.prompt, model_id: MODEL, loop: request.loop ?? false, prompt_influence: request.promptInfluence ?? .3, ...(request.duration ? { duration_seconds: request.duration } : {}) });
  for (const [index, format] of FORMATS.entries()) {
    const response = await fetch(`${ENDPOINT}?output_format=${format}`, { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' }, body, signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(90_000)]) });
    if (response.ok) return shape(new Uint8Array(await response.arrayBuffer()), request.loop ?? false);
    const detail = (await response.text()).slice(0, 300);
    if (index < FORMATS.length - 1 && (response.status === 401 || response.status === 403 || response.status === 422) && /tier|plan|subscription|output_format/i.test(detail)) continue;
    throw new Error(`ElevenLabs could not generate the sound (${response.status}): ${detail}`);
  }
  throw new Error('ElevenLabs could not generate the sound.');
}

/** A 16-bit WAV to stereo at its own rate, with the silence before the first audible sample cut so the sound lands on its timeline second. */
function shape(bytes: Uint8Array, loop: boolean): { samples: Stereo; rate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('ElevenLabs returned audio that is not a WAV file.');
  let channels = 0, rate = 0, bits = 0, data: Uint8Array | undefined;
  for (let at = 12; at + 8 <= bytes.byteLength;) {
    const size = view.getUint32(at + 4, true), body = at + 8;
    if (tag(at) === 'fmt ') { channels = view.getUint16(body + 2, true); rate = view.getUint32(body + 4, true); bits = view.getUint16(body + 14, true); }
    if (tag(at) === 'data') { data = bytes.subarray(body, Math.min(bytes.byteLength, body + size)); break; }
    at = body + size + (size % 2);
  }
  if (!data || !rate || bits !== 16 || channels < 1 || channels > 2) throw new Error(`ElevenLabs returned an unsupported WAV (${channels} channels, ${bits}-bit, ${rate} Hz).`);
  const pcm = new DataView(data.buffer, data.byteOffset, data.byteLength), frames = Math.floor(data.byteLength / (2 * channels));
  let left = new Float64Array(frames), right = new Float64Array(frames), peak = 0;
  for (let i = 0; i < frames; i++) {
    left[i] = pcm.getInt16(i * 2 * channels, true) / 32768;
    right[i] = channels === 2 ? pcm.getInt16(i * 4 + 2, true) / 32768 : left[i];
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  if (!frames || peak < 1e-4) throw new Error('ElevenLabs returned a silent sound; try a more concrete prompt.');
  if (!loop) {
    const first = left.findIndex((value, i) => Math.max(Math.abs(value), Math.abs(right[i])) > peak * .05), start = Math.max(0, first - Math.round(rate * .004));
    left = left.slice(start); right = right.slice(start);
  }
  const gain = GENERATED_SOUND_PEAK / peak;
  for (let i = 0; i < left.length; i++) { left[i] *= gain; right[i] *= gain; }
  return { samples: [left, right], rate };
}
