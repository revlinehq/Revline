import { z } from 'zod';

export type TranscriptWord = { start: number; end: number; text: string; speaker?: number; speakerConfidence?: number };
export type Transcript = { words: TranscriptWord[]; segments: TranscriptWord[]; version?: number; chunkCount?: number; wordCount?: number; wordChunks?: TranscriptWord[][] };
export const MAX_TRANSCRIPT_WORDS = 100000;
/** Convex limits each transported array to 8192 entries. Storage chunks alone
 * do not protect worker completion or hydrated query responses. */
export function transportTranscript(transcript: Transcript): Transcript {
  const full=readTranscript(transcript);
  if(full.words.length<=4000)return full;
  return {...full,words:[],wordCount:full.words.length,wordChunks:Array.from({length:Math.ceil(full.words.length/2000)},(_,i)=>full.words.slice(i*2000,(i+1)*2000))};
}
export function readTranscript(transcript: Transcript): Transcript {
  if(!transcript.wordChunks)return transcript;
  const {wordChunks,...rest}=transcript;
  const count=wordChunks.reduce((sum,chunk)=>sum+chunk.length,0);
  if(count>MAX_TRANSCRIPT_WORDS||transcript.wordCount!==undefined&&count!==transcript.wordCount||transcript.words.length)throw new Error('Timed transcript transport is incomplete.');
  return {...rest,words:wordChunks.flat()};
}
export function materializeTranscript<T extends {analysis?:{transcript?:Transcript}}>(asset:T):T {
  return asset.analysis?.transcript?{...asset,analysis:{...asset.analysis,transcript:readTranscript(asset.analysis.transcript)}}:asset;
}
/** 3: Deepgram Nova-3 on the whole file, with tight word times and filler words.
 * Whisper transcripts (1, 2) stretched word times over fillers and pauses, so cuts
 * landed mid-word; those transcripts are redone. */
export const TRANSCRIPT_VERSION = 3;
export const currentTranscript = (transcript?: { version?: number } | null) => transcript?.version === TRANSCRIPT_VERSION;
const contentSchema = z.object({ text: z.string().optional(), annotations: z.array(z.unknown()).optional() });
const interactionSchema = z.object({ output_text: z.string().optional(), outputs: z.array(contentSchema).optional(), steps: z.array(z.object({ type: z.string().optional(), content: z.array(contentSchema).optional() })).optional() });

export function interactionText(raw: unknown) {
  const interaction = interactionSchema.parse(raw);
  const output = (interaction.steps ?? []).filter(step => step.type === 'model_output').flatMap(step => step.content ?? []);
  return interaction.output_text ?? (output.length ? output : interaction.outputs ?? []).map(content => content.text ?? '').join('');
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
