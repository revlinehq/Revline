import { z } from 'zod';

export type TranscriptWord = { start: number; end: number; text: string };
export type Transcript = { words: TranscriptWord[]; segments: TranscriptWord[] };
export const MAX_TRANSCRIPT_WORDS = 5000;

const annotationSchema = z.object({ type: z.literal('word_info'), text: z.string(), start_offset: z.union([z.string(), z.number()]), end_offset: z.union([z.string(), z.number()]) });
const contentSchema = z.object({ text: z.string().optional(), annotations: z.array(z.unknown()).optional() });
const interactionSchema = z.object({ output_text: z.string().optional(), outputs: z.array(contentSchema).optional(), steps: z.array(z.object({ type: z.string().optional(), content: z.array(contentSchema).optional() })).optional() });

export function timestampSeconds(value: string | number) {
  if (typeof value === 'number') return value;
  const numeric = /^\d+(?:\.\d+)?s?$/.exec(value.trim());
  if (numeric) return Number(value.replace(/s$/, ''));
  const time = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/.exec(value.trim());
  return time ? Number(time[1] ?? 0) * 3600 + Number(time[2]) * 60 + Number(time[3]) : NaN;
}

export function interactionText(raw: unknown) {
  const interaction = interactionSchema.parse(raw);
  const output = (interaction.steps ?? []).filter(step => step.type === 'model_output').flatMap(step => step.content ?? []);
  return interaction.output_text ?? (output.length ? output : interaction.outputs ?? []).map(content => content.text ?? '').join('');
}

/** Parse real provider word annotations; never infer timestamps from plain text. */
export function parseTranscript(raw: unknown, duration: number): Transcript {
  const interaction = interactionSchema.parse(raw);
  const contents = [...(interaction.steps ?? []).flatMap(step => step.content ?? []), ...(interaction.outputs ?? [])];
  const words: TranscriptWord[] = [];
  const seen = new Set<string>();
  for (const content of contents) for (const rawAnnotation of content.annotations ?? []) {
    const parsed = annotationSchema.safeParse(rawAnnotation);
    if (!parsed.success) continue;
    const start = timestampSeconds(parsed.data.start_offset);
    const end = timestampSeconds(parsed.data.end_offset);
    const text = parsed.data.text.trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= duration || end <= start || end > duration + 0.5 || !text) throw new Error('Gemini returned invalid word timestamps.');
    const key = `${start}|${end}|${text}`;
    if (!seen.has(key)) { words.push({ start, end: Math.min(end, duration), text }); seen.add(key); }
  }
  if (!words.length && interactionText(raw).trim()) throw new Error('Gemini returned text without word timestamps. Please retry transcription.');
  return transcriptFromWords(words, duration);
}

/** Preserve measured word times; compact only the overview segments for storage. */
export function transcriptFromWords(input: TranscriptWord[], duration: number): Transcript {
  if (input.length > MAX_TRANSCRIPT_WORDS) throw new Error('The transcription exceeds the word limit.');
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The source has no valid transcription duration.');
  for (const word of input) if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < 0 || word.start > duration || word.end < word.start || word.end > duration + 0.5 || !word.text.trim() || word.text.length > 2000) throw new Error('The transcription returned invalid word timestamps or text.');
  // Container/audio padding can extend the final alignment slightly. Never
  // stretch instantaneous provider alignments to invent a spoken duration.
  const words = input.map(word => ({ ...word, text: word.text.trim(), end: Math.min(word.end, duration) })).sort((a, b) => a.start - b.start);
  const segments: TranscriptWord[] = [];
  let group: TranscriptWord[] = [];
  const flush = () => {
    if (!group.length) return;
    const start = group[0].start, end = Math.max(...group.map(word => word.end));
    if (end <= start) return;
    segments.push({ start, end, text: group.map(word => word.text).join(' ').replace(/\s+([.,!?;:])/g, '$1') });
    group = [];
  };
  for (const word of words) {
    if (group.length && (group.length >= 6 || word.end - group[0].start > 2.5 || word.start - group[group.length - 1].end > 0.45 || group.map(entry => entry.text).join(' ').length + word.text.length > 42)) flush();
    group.push(word);
    if (/[.!?]$/.test(word.text)) flush();
  }
  flush();
  if (group.length && segments.length) {
    const last = segments[segments.length - 1];
    last.end = Math.max(last.end, ...group.map(word => word.end));
    last.text += ` ${group.map(word => word.text).join(' ')}`;
  }
  if (segments.some(segment => segment.text.length > 2000)) throw new Error('The transcription overview exceeds the text limit.');
  if (segments.length <= 500) return { words, segments };
  const stride = Math.ceil(segments.length / 500);
  const compact: TranscriptWord[] = [];
  for (let index = 0; index < segments.length; index += stride) {
    const group = segments.slice(index, index + stride);
    compact.push({ start: group[0].start, end: Math.max(...group.map(segment => segment.end)), text: group.map(segment => segment.text).join(' ') });
  }
  if (compact.some(segment => segment.text.length > 2000)) throw new Error('The transcription overview exceeds the text limit.');
  return { words, segments: compact };
}
