import { refineTranscriptWithAudioActivity, type AudioActivity } from '../media-analysis/audio-activity';
import type { Transcript, TranscriptWord } from '../media-analysis/transcript';
import { playbackRateOf, sourceEndOf, timelineTimeAtSource } from './playback-rate';
import type { Clip, Timeline } from './types';
import { CLIPPER_CAPTION_HIGHLIGHT, CLIPPER_CAPTION_MAX_WORDS, CLIPPER_CAPTION_STYLE, DEFAULT_CAPTION_STYLE } from './text-style';

/** minimal: static phrases (default everywhere). clipper: the clip lane's 1–3 word karaoke captions. */
export type TranscriptCaptionStyle = 'minimal' | 'clipper';

export type SpeechAnalysis = { transcript?: Transcript; audioActivity?: AudioActivity; speechCleanup?: { edges?: number[] } };

/** What captions and their checks read: the provider words with ends pulled back to measured quiet, and each
 * word's measured sound span (`edges`, flattened in word order) when the source has a cleanup map. */
export function captionSpeech(analysis: SpeechAnalysis | undefined): { transcript: Transcript; edges?: number[] } | undefined {
  const provider = analysis?.transcript;
  if (!provider) return undefined;
  const transcript = analysis.audioActivity ? refineTranscriptWithAudioActivity(provider, analysis.audioActivity) : provider;
  const edges = analysis.speechCleanup?.edges;
  return { transcript, ...(edges?.length === transcript.words.length * 2 && transcript.words.length === provider.words.length ? { edges } : {}) };
}

/** Whether a word is spoken in a clip's retained source. Speech cuts sit on the measured sound of their words,
 * and the provider's word span often reaches a few hundredths of a second past that sound, across the cut.
 * Requiring the whole span inside the clip dropped those audible words from captions. A word belongs to the
 * piece holding the middle of its sound (as the cut itself decides), or of its provider span without a
 * cleanup map: a removed word stays out, and a word split by a cut is captioned once. */
export function wordInSource(word: TranscriptWord, sourceStart: number, sourceEnd: number, sound?: { start: number; end: number }) {
  // Cuts are rounded to milliseconds: compare on that grid, so a word at a join is in exactly one piece.
  const middle = Math.round((sound ? sound.start + sound.end : word.start + word.end) * 500);
  return middle >= Math.round(sourceStart * 1000) && middle < Math.round(sourceEnd * 1000);
}

/** Caption retained speech, never the discarded words of an intersecting segment. `edges` are the
 * measured sound spans of `transcript.words` from `captionSpeech`. */
export function captionClipsFromTranscript(clip: Clip, transcript: Transcript, fps: number, createId: () => string, style: TranscriptCaptionStyle = 'minimal', edges?: number[]): Clip[] {
  const sourceEnd = sourceEndOf(clip), rate = playbackRateOf(clip), frame = 1 / fps;
  // Speech cuts round measured edges to milliseconds; provider floats must not drop boundary words.
  const retained = (word: TranscriptWord) => word.start >= clip.sourceStart - .001 && word.start < sourceEnd - 1e-7 && word.end <= sourceEnd + .001 && word.text.trim();
  const measured = edges?.length === transcript.words.length * 2 ? edges : undefined;
  const span = (group: TranscriptWord[]) => {
    const first = timelineTimeAtSource(clip, group[0].start);
    const last = timelineTimeAtSource(clip, Math.max(...group.map(word => word.end)));
    const end = Math.min(clip.start + clip.duration, Math.max(last, first + frame));
    const start = Math.max(clip.start, Math.min(first, end - frame));
    return { start, end };
  };
  const caption = (group: TranscriptWord[]): Clip => {
    const { start, end } = span(group);
    return {
      id: createId(), kind: 'caption', start, duration: Math.max(frame, end - start), sourceStart: 0,
      text: group.map(word => word.text.trim()).join(' '), ...DEFAULT_CAPTION_STYLE,
    };
  };
  // One phrase becomes consecutive chunks of at most three words that together span the whole phrase, each with
  // per-word timings for the karaoke pop and highlight.
  const clipperCaptions = (phrase: TranscriptWord[]): Clip[] => {
    const { start: phraseStart, end: phraseEnd } = span(phrase);
    // Balanced sizes (4 → 2+2, 5 → 3+2) so no word flashes alone; a chunk too close to its predecessor joins it,
    // so consecutive chunks never overlap.
    const count = Math.ceil(phrase.length / CLIPPER_CAPTION_MAX_WORDS), chunks: TranscriptWord[][] = [], starts: number[] = [];
    for (let i = 0, from = 0; i < count; i++) {
      const to = Math.round((i + 1) * phrase.length / count), chunk = phrase.slice(from, to);
      from = to;
      const at = timelineTimeAtSource(clip, chunk[0].start);
      if (i && (at < starts.at(-1)! + frame || at > phraseEnd - frame)) chunks.at(-1)!.push(...chunk);
      else { chunks.push(chunk); starts.push(i ? at : phraseStart); }
    }
    return chunks.map((chunk, i) => {
      const start = starts[i], end = i + 1 < chunks.length ? starts[i + 1] : phraseEnd, duration = Math.max(frame, end - start);
      const tokens = chunk.flatMap(word => word.text.trim().split(/\s+/).map(token => ({ token, word })));
      let previous = 0;
      const wordTimings = tokens.map(({ word }) => {
        const from = Math.min(duration, Math.max(previous, timelineTimeAtSource(clip, word.start) - start));
        const to = Math.min(duration, Math.max(from, timelineTimeAtSource(clip, word.end) - start));
        previous = to;
        return { start: from, end: to };
      });
      return {
        id: createId(), kind: 'caption', start, duration, sourceStart: 0,
        text: tokens.map(({ token }) => token).join(' ').toLocaleUpperCase('en-US'), ...CLIPPER_CAPTION_STYLE,
        textTemplate: { preset: 'karaoke', highlightColor: CLIPPER_CAPTION_HIGHLIGHT, karaokeStyle: 'pop', duration, offset: 0, wordTimings },
      };
    });
  };
  if (!transcript.words.length) {
    // Segment text cannot be safely divided when individual words are absent.
    return transcript.segments.filter(retained).map(segment => caption([segment]));
  }
  const words = transcript.words.filter((word, index) => word.text.trim() && wordInSource(word, clip.sourceStart, sourceEnd, measured && { start: measured[index * 2], end: measured[index * 2 + 1] })).sort((a, b) => a.start - b.start);
  const result: Clip[] = [];
  let group: TranscriptWord[] = [];
  const flush = () => { if (group.length) result.push(...(style === 'clipper' ? clipperCaptions(group) : [caption(group)])); group = []; };
  for (const word of words) {
    if (group.length && (group.length >= 6 || (word.end - group[0].start) / rate > 2.5 || (word.start - group.at(-1)!.end) / rate > .45 || group.map(entry => entry.text.trim()).join(' ').length + word.text.trim().length > 42)) flush();
    group.push(word);
    if (/[.!?]["'”’)]*$/.test(word.text.trim())) flush();
  }
  flush();
  return result;
}


/** A caption shorter than this cannot be read; it joins the phrase next to it. */
const BRIEF_CAPTION_SECONDS = .35, JOINED_CAPTION_MAX_WORDS = 8, JOINED_CAPTION_MAX_CHARACTERS = 48;

/** Captions for every piece of one source. Phrases are built per piece, so a cut inside a sentence leaves one
 * or two words alone on screen for a tenth of a second. Such a static caption joins a phrase it touches: the
 * one before it when it ends a sentence, the one after it when it starts one, otherwise the one in its own
 * piece. A joined phrase holds at most eight words and 48 characters. Karaoke chunks keep their own timing. */
export function sourceCaptions(clips: Clip[], speech: { transcript: Transcript; edges?: number[] }, fps: number, createId: () => string, style: TranscriptCaptionStyle = 'minimal'): Clip[] {
  type Placed = { caption: Clip; piece: number };
  const captions: Placed[] = clips.flatMap((clip, piece) => captionClipsFromTranscript(clip, speech.transcript, fps, createId, style, speech.edges).map(caption => ({ caption, piece }))).sort((a, b) => a.caption.start - b.caption.start);
  const frame = 1 / fps, endOf = (clip: Clip) => clip.start + clip.duration, endsSentence = (clip: Clip) => /[.!?]["'”’)]*$/.test(clip.text ?? '');
  const joinable = (a: Placed | undefined, b: Placed | undefined): a is Placed => {
    if (!a || !b || a.caption.textTemplate || b.caption.textTemplate || Math.abs(b.caption.start - endOf(a.caption)) > frame + 1e-6) return false;
    const text = `${a.caption.text} ${b.caption.text}`;
    return text.split(/\s+/).filter(Boolean).length <= JOINED_CAPTION_MAX_WORDS && text.length <= JOINED_CAPTION_MAX_CHARACTERS;
  };
  const join = (a: Placed, b: Placed, piece: number): Placed => ({ piece, caption: { ...a.caption, duration: endOf(b.caption) - a.caption.start, text: `${a.caption.text} ${b.caption.text}` } });
  const result: Placed[] = [];
  for (let index = 0; index < captions.length; index++) {
    const current = captions[index], previous = result.at(-1), next = captions[index + 1];
    if (current.caption.duration >= BRIEF_CAPTION_SECONDS) { result.push(current); continue; }
    const back = endsSentence(current.caption) ? true : !previous || endsSentence(previous.caption) ? false : previous.piece === current.piece || next?.piece !== current.piece;
    // Joining back must not strand the brief word that ends this sentence: the two then pair up instead.
    const strands = joinable(previous, current) && !!next && next.caption.duration < BRIEF_CAPTION_SECONDS && endsSentence(next.caption) && joinable(current, next) && !joinable(join(previous, current, previous.piece), next);
    if (back && !strands && joinable(previous, current)) result[result.length - 1] = join(previous, current, previous.piece);
    else if (joinable(current, next)) { result.push(join(current, next!, next!.piece)); index++; }
    else if (joinable(previous, current)) result[result.length - 1] = join(previous, current, previous.piece);
    else result.push(current);
  }
  return result.map(placed => placed.caption);
}

/** A manual fallback must cover every retained speech phrase before it can
 * resolve an automatic-caption failure. This checks timing, not wording or
 * visual quality; frame rounding at phrase boundaries is allowed. */
export function captionsCoverTranscript(timeline: Timeline, assetId: string, transcript: Transcript, edges?: number[]): boolean {
  const expected=timeline.clips.filter(clip=>clip.assetId===assetId).flatMap(clip=>captionClipsFromTranscript(clip,transcript,timeline.fps,()=>'','minimal',edges));
  const captions=timeline.clips.filter(clip=>clip.kind==='caption'&&clip.text?.trim()).sort((a,b)=>a.start-b.start);
  const tolerance=1/timeline.fps+1e-7;
  return expected.length>0&&expected.every(phrase=>{
    let covered=phrase.start;
    for(const caption of captions){
      if(caption.start>covered+tolerance)break;
      if(caption.start+caption.duration>=covered-tolerance)covered=Math.max(covered,caption.start+caption.duration);
      if(covered>=phrase.start+phrase.duration-tolerance)return true;
    }
    return false;
  });
}
