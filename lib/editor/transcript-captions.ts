import type { Transcript, TranscriptWord } from '../media-analysis/transcript';
import { playbackRateOf, sourceEndOf, timelineTimeAtSource } from './playback-rate';
import type { Clip, Timeline } from './types';
import { DEFAULT_CAPTION_STYLE } from './text-style';

/** Caption retained speech, never the discarded words of an intersecting segment. */
export function captionClipsFromTranscript(clip: Clip, transcript: Transcript, fps: number, createId: () => string): Clip[] {
  const sourceEnd = sourceEndOf(clip), rate = playbackRateOf(clip), frame = 1 / fps;
  // Speech cuts round measured edges to milliseconds; provider floats must not drop boundary words.
  const retained = (word: TranscriptWord) => word.start >= clip.sourceStart - .001 && word.start < sourceEnd - 1e-7 && word.end <= sourceEnd + .001 && word.text.trim();
  const caption = (group: TranscriptWord[]): Clip => {
    const first = timelineTimeAtSource(clip, group[0].start);
    const last = timelineTimeAtSource(clip, Math.max(...group.map(word => word.end)));
    const end = Math.min(clip.start + clip.duration, Math.max(last, first + frame));
    const start = Math.max(clip.start, Math.min(first, end - frame)), duration = Math.max(frame, end - start);
    return {
      id: createId(), kind: 'caption', start, duration, sourceStart: 0,
      text: group.map(word => word.text.trim()).join(' '), ...DEFAULT_CAPTION_STYLE,
    };
  };
  if (!transcript.words.length) {
    // Segment text cannot be safely divided when individual words are absent.
    return transcript.segments.filter(retained).map(segment => caption([segment]));
  }
  const words = transcript.words.filter(retained).sort((a, b) => a.start - b.start);
  const result: Clip[] = [];
  let group: TranscriptWord[] = [];
  const flush = () => { if (group.length) result.push(caption(group)); group = []; };
  for (const word of words) {
    if (group.length && (group.length >= 6 || (word.end - group[0].start) / rate > 2.5 || (word.start - group.at(-1)!.end) / rate > .45 || group.map(entry => entry.text.trim()).join(' ').length + word.text.trim().length > 42)) flush();
    group.push(word);
    if (/[.!?]["'”’)]*$/.test(word.text.trim())) flush();
  }
  flush();
  return result;
}


/** A manual fallback must cover every retained speech phrase before it can
 * resolve an automatic-caption failure. This checks timing, not wording or
 * visual quality; frame rounding at phrase boundaries is allowed. */
export function captionsCoverTranscript(timeline: Timeline, assetId: string, transcript: Transcript): boolean {
  const expected=timeline.clips.filter(clip=>clip.assetId===assetId).flatMap(clip=>captionClipsFromTranscript(clip,transcript,timeline.fps,()=>''));
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
