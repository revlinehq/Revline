import type { Transcript, TranscriptWord } from '../media-analysis/transcript';
import { playbackRateOf, sourceEndOf, timelineTimeAtSource } from './playback-rate';
import type { Clip } from './types';

/** Caption retained speech, never the discarded words of an intersecting segment. */
export function captionClipsFromTranscript(clip: Clip, transcript: Transcript, fps: number, createId: () => string): Clip[] {
  const sourceEnd = sourceEndOf(clip), rate = playbackRateOf(clip), frame = 1 / fps;
  const retained = (word: TranscriptWord) => word.start >= clip.sourceStart - 1e-7 && word.start < sourceEnd - 1e-7 && word.end <= sourceEnd + 1e-7 && word.text.trim();
  const caption = (group: TranscriptWord[], measured: boolean): Clip => {
    const first = timelineTimeAtSource(clip, group[0].start);
    const last = timelineTimeAtSource(clip, Math.max(...group.map(word => word.end)));
    const end = Math.min(clip.start + clip.duration, Math.max(last, first + frame));
    const start = Math.max(clip.start, Math.min(first, end - frame)), duration = end - start;
    // Legacy alignments can contain several tokens or overlapping words. Keep
    // their caption text, but do not invent separate measured karaoke timings.
    const timed = measured && group.every((word, index) => word.text.trim().split(/\s+/).length === 1 && (!index || word.start >= group[index - 1].end - 1e-7));
    const relative = (time: number) => Math.max(0, Math.min(duration, timelineTimeAtSource(clip, time) - start));
    return {
      id: createId(), kind: 'caption', start, duration, sourceStart: 0,
      text: group.map(word => word.text.trim()).join(' '), fontSize: 52, color: '#F4F4F0', background: '#0B0C0E', x: .5, y: .82, animation: 'none',
      ...(timed ? { textTemplate: { preset: 'karaoke', wordTimings: group.map(word => ({ start: relative(word.start), end: relative(word.end) })) } } : {}),
    };
  };
  if (!transcript.words.length) {
    // Segment text cannot be safely divided when individual words are absent.
    return transcript.segments.filter(retained).map(segment => caption([segment], false));
  }
  const words = transcript.words.filter(retained).sort((a, b) => a.start - b.start);
  const result: Clip[] = [];
  let group: TranscriptWord[] = [];
  const flush = () => { if (group.length) result.push(caption(group, true)); group = []; };
  for (const word of words) {
    if (group.length && (group.length >= 6 || (word.end - group[0].start) / rate > 2.5 || (word.start - group.at(-1)!.end) / rate > .45 || group.map(entry => entry.text.trim()).join(' ').length + word.text.trim().length > 42)) flush();
    group.push(word);
    if (/[.!?]["'”’)]*$/.test(word.text.trim())) flush();
  }
  flush();
  return result;
}
