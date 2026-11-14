import type { LaneCheckContext, LaneEvidence } from '../types';
import type { Timeline } from '../../../editor/types';
import { sourceEndOf, timelineTimeAtSource } from '../../../editor/playback-rate';
import { trackOf } from '../../../editor/types';
import { captionSpeech, wordInSource, type SpeechAnalysis } from '../../../editor/transcript-captions';
export function check(_context: LaneCheckContext): string[] {
  return [];
}

/** A retained spoken word on the timeline. `heldEnd` is the provider's unshortened end, which may run on through trailing silence. */
export type SpokenWord = { text: string; start: number; end: number; heldEnd?: number };

/** Retained words as addSubtitlesFromTranscript captions them: the same timing copy (provider words whose ends are
 * pulled back to measured quiet) and the same rule for which piece a word at a cut belongs to. Measuring captions
 * against the provider's longer ends failed the tool's own captions. */
export function retainedSpeechWords(timeline: Timeline, assets: { _id: string; kind?: string; duration?: number; audioAssetId?: string; analysis?: SpeechAnalysis }[]): SpokenWord[] {
  // One timing copy per source, however many pieces a cut left of it.
  const copies = new Map<SpeechAnalysis, ReturnType<typeof captionSpeech>>();
  const speechOf = (analysis: SpeechAnalysis) => { if (!copies.has(analysis)) copies.set(analysis, captionSpeech(analysis)); return copies.get(analysis); };
  const speech = timeline.clips.flatMap(clip => {
    if (clip.volume === 0 || !(clip.kind === 'audio' || clip.kind === 'video' && !clip.audioSeparated)) return [];
    const analysis = assets.find(asset => asset._id === clip.assetId)?.analysis?.transcript ? assets.find(asset => asset._id === clip.assetId)?.analysis
      : assets.find(asset => asset.audioAssetId === clip.assetId)?.analysis;
    const provider = analysis?.transcript, measured = analysis && speechOf(analysis);
    if (!provider || !measured) return [];
    const { transcript, edges } = measured, aligned = transcript.words.length === provider.words.length, sourceEnd = sourceEndOf(clip);
    return transcript.words.flatMap((word, index) => {
      if (!wordInSource(word, clip.sourceStart, sourceEnd, edges && { start: edges[index * 2], end: edges[index * 2 + 1] })) return [];
      // A word reaching past the cut is shown only while its clip plays.
      const start = Math.max(word.start, clip.sourceStart), end = Math.max(start, Math.min(word.end, sourceEnd));
      const held = aligned ? Math.min(provider.words[index].end, sourceEnd) : end;
      return [{ text: word.text, start: timelineTimeAtSource(clip, start), end: timelineTimeAtSource(clip, end), ...(held > end ? { heldEnd: timelineTimeAtSource(clip, held) } : {}) }];
    });
  });
  return [...new Map(speech.map(word => [`${word.start.toFixed(3)}:${word.end.toFixed(3)}:${word.text}`, word])).values()]
    .sort((a, b) => a.start - b.start);
}

export function reelCaptionFailures(timeline: Timeline, assets: Parameters<typeof retainedSpeechWords>[1]) {
  if (!timeline.clips.some(clip => clip.kind === 'caption')) return [];
  const words = retainedSpeechWords(timeline, assets);
  return words.length ? captionSyncFailures(timeline, words) : ['No retained speech transcript is available to verify caption synchronization.'];
}

/** Failed finish work is reusable only while the actual timeline, revision and evidence stay identical. */
export async function reelFinishKey(input: {
  fingerprint: string;
  revision: number;
  evidence: LaneEvidence[];
  timelines: { timelineId: string; fingerprint: string | null }[];
  assets: Parameters<typeof retainedSpeechWords>[1];
}) {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...input, assets: input.assets.map(asset => ({
    id: asset._id, kind: asset.kind, duration: asset.duration, audioAssetId: asset.audioAssetId, transcript: asset.analysis?.transcript, edges: asset.analysis?.speechCleanup?.edges,
  })) }));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

const seconds = (time: number) => time.toFixed(2);
const spokenRange = (words: SpokenWord[]) => `${seconds(words[0].start)}–${seconds(words.at(-1)!.end)} s`;
const MAX_LISTED_WORDS = 12;

/** Match caption text and phrase edges to retained measured words, including retiming. Each failure names the caption,
 * what is spoken, and the exact range to set, so one repair step fixes it. Case and punctuation never fail a match. */
export function captionSyncFailures(
  timeline: Timeline,
  words: SpokenWord[],
  options: { checkCoverage?: boolean; checkTiming?: boolean } = {},
): string[] {
  const normalized = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const spokenText = words.map(word => normalized(word.text));
  const captions = timeline.clips.filter(clip => clip.kind === 'caption').sort((a, b) => a.start - b.start);
  const matched = new Set<number>(), mistimed = new Set<number>(), failures: string[] = [], tolerance = Math.max(0.12, 2 / timeline.fps), frame = 1 / timeline.fps;
  // Captions already on their words claim them first, so a mistimed duplicate is never sent onto an occupied range.
  const place = (caption: typeof captions[number], report: boolean): boolean => {
    const sink = report ? failures : [];
    const end = caption.start + caption.duration, target = normalized(caption.text ?? ''), label = `Caption ${caption.id} ${JSON.stringify(caption.text ?? '')} (${seconds(caption.start)}–${seconds(end)} s)`;
    // Its own words, wherever they are spoken near it: the run of retained words that spells the caption.
    const runs: number[][] = [];
    for (let first = 0; target && first < words.length; first++) {
      if (words[first].start < caption.start - 3 || words[first].start > end + 3) continue;
      let text = '';
      for (let last = first; last < words.length && last - first < 8; last++) {
        text = `${text} ${spokenText[last]}`.trim();
        if (text === target) { runs.push(Array.from({ length: last - first + 1 }, (_, offset) => first + offset)); break; }
        if (!target.startsWith(text)) break;
      }
    }
    const run = runs.filter(indices => !indices.some(index => matched.has(index) || mistimed.has(index))).sort((a, b) => Math.abs(words[a[0]].start - caption.start) - Math.abs(words[b[0]].start - caption.start))[0];
    if (!run) {
      // Words whose middle falls inside the caption; a neighbour's word that only touches its edge is not its text.
      const inside = words.filter(word => { const middle = (word.start + word.end) / 2; return middle >= caption.start - frame && middle < end + frame; });
      sink.push(!inside.length
        ? `${label} covers no retained speech. Delete it, or move it with setCaptionTiming to where its words are spoken.`
        : `${label} does not match the words spoken there: ${JSON.stringify(inside.map(word => word.text).join(' '))} (${spokenRange(inside)}).${inside.length > 8 ? ' A caption holds at most 8 words; split it.' : ''} Use editText with that phrase (case and punctuation may differ), or setCaptionTiming to the range where its own words are spoken.`);
      return false;
    }
    const spoken = run.map(index => words[index]), last = spoken.at(-1)!, next = words[run.at(-1)! + 1];
    // A caption may hold through the trailing silence the provider attached to its last word, or until the next word starts.
    const latestEnd = Math.max(last.heldEnd ?? last.end, next && next.start - last.end <= .5 ? next.start : last.end);
    if (options.checkTiming === false ? spoken[0].start >= end || last.end <= caption.start : Math.abs(caption.start - spoken[0].start) > tolerance || end < last.end - tolerance || end > latestEnd + tolerance) {
      const blocker = timeline.clips.find(other => other.id !== caption.id && other.kind !== 'audio' && other.kind !== 'effect' && other.kind !== 'caption' && trackOf(other) === trackOf(caption) && other.start < Math.round(last.end * timeline.fps) / timeline.fps - 1e-7 && Math.round(spoken[0].start * timeline.fps) / timeline.fps < other.start + other.duration - 1e-7);
      sink.push(`${label} has the right words at the wrong time: they are spoken at ${spokenRange(spoken)}. Call setCaptionTiming {clipId: ${JSON.stringify(caption.id)}, start: ${seconds(spoken[0].start)}, end: ${seconds(last.end)}}.${blocker ? ` Clip ${blocker.id}${blocker.text ? ` ${JSON.stringify(blocker.text)}` : ''} (${seconds(blocker.start)}–${seconds(blocker.start + blocker.duration)} s) is on the same track inside that range: move it first (neighbouring captions make room on their own).` : ''}`);
      // Already reported with its caption; not also listed as a word without one.
      if (report) run.forEach(index => mistimed.add(index));
      return false;
    }
    run.forEach(index => matched.add(index));
    return true;
  };
  for (const caption of captions.filter(caption => !place(caption, false))) place(caption, true);
  const missing = options.checkCoverage === false ? [] : words.filter((_, index) => !matched.has(index) && !mistimed.has(index));
  if (missing.length) {
    failures.push(`${missing.length} spoken ${missing.length === 1 ? 'word has' : 'words have'} no synchronized caption: ${missing.slice(0, MAX_LISTED_WORDS).map(word => `${JSON.stringify(word.text)} ${seconds(word.start)}–${seconds(word.end)} s`).join('; ')}${missing.length > MAX_LISTED_WORDS ? `; and ${missing.length - MAX_LISTED_WORDS} more` : ''}. Add each to the caption beside it (setCaptionTiming to include its time, then editText), or add a caption at those times.`);
  }
  return failures;
}
