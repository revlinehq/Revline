import type { LaneCheckContext, LaneEvidence } from '../types';
import type { Timeline } from '../../../editor/types';
import { sourceEndOf, timelineTimeAtSource } from '../../../editor/playback-rate';
import { trackOf } from '../../../editor/types';
import { footageGaps } from '../../../editor/frame-grid';
import { updateCaptionTiming, type CaptionNeighbourChange } from '../../../editor/caption-editing';
import { captionSpeech, wordInSource, type SpeechAnalysis } from '../../../editor/transcript-captions';
export function check(_context: LaneCheckContext): string[] {
  return [];
}

/** A retained spoken word on the timeline. `heldEnd` is the provider's unshortened end, which may run on through trailing silence. */
export type SpokenWord = { text: string; start: number; end: number; heldEnd?: number; /** The source word: asset and transcript index. */ word?: string };

/** Retained words as addSubtitlesFromTranscript captions them: the same timing copy (provider words whose ends are
 * pulled back to measured quiet) and the same rule for which piece a word at a cut belongs to. Measuring captions
 * against the provider's longer ends failed the tool's own captions. */
export function retainedSpeechWords(timeline: Timeline, assets: { _id: string; kind?: string; duration?: number; audioAssetId?: string; analysis?: SpeechAnalysis }[]): SpokenWord[] {
  // One timing copy per source, however many pieces a cut left of it.
  const copies = new Map<SpeechAnalysis, ReturnType<typeof captionSpeech>>();
  const speechOf = (analysis: SpeechAnalysis) => { if (!copies.has(analysis)) copies.set(analysis, captionSpeech(analysis)); return copies.get(analysis); };
  const speech = timeline.clips.flatMap(clip => {
    if (clip.volume === 0 || !(clip.kind === 'audio' || clip.kind === 'video' && !clip.audioSeparated)) return [];
    const owner = assets.find(asset => asset._id === clip.assetId)?.analysis?.transcript ? assets.find(asset => asset._id === clip.assetId) : assets.find(asset => asset.audioAssetId === clip.assetId);
    const analysis = owner?.analysis;
    const provider = analysis?.transcript, measured = analysis && speechOf(analysis);
    if (!provider || !measured) return [];
    const { transcript, edges } = measured, aligned = transcript.words.length === provider.words.length, sourceEnd = sourceEndOf(clip);
    return transcript.words.flatMap((word, index) => {
      if (!wordInSource(word, clip.sourceStart, sourceEnd, edges && { start: edges[index * 2], end: edges[index * 2 + 1] })) return [];
      // A word reaching past the cut is shown only while its clip plays.
      const start = Math.max(word.start, clip.sourceStart), end = Math.max(start, Math.min(word.end, sourceEnd));
      const held = aligned ? Math.min(provider.words[index].end, sourceEnd) : end;
      return [{ text: word.text, start: timelineTimeAtSource(clip, start), end: timelineTimeAtSource(clip, end), ...(held > end ? { heldEnd: timelineTimeAtSource(clip, held) } : {}), word: `${owner!._id}:${index}` }];
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
/** Spoken words as caption text: the transcript's own words and punctuation, the first letter capitalized. */
const spokenPhrase = (words: SpokenWord[]) => words.map(word => word.text).join(' ').replace(/^\P{L}*\p{L}/u, match => match.toLocaleUpperCase());

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
        : `${label} does not match the words spoken there: ${JSON.stringify(inside.map(word => word.text).join(' '))} (${spokenRange(inside)}).${inside.length > 8 ? ' A caption holds at most 8 words; split it.' : ''} ${inside.length > 8 ? ' Use editText with that phrase (case and punctuation may differ), or setCaptionTiming to the range where its own words are spoken.' : ` To caption what is said, in one call: editText ${JSON.stringify({ clipId: caption.id, text: spokenPhrase(inside), start: Number(seconds(inside[0].start)), end: Number(seconds(inside.at(-1)!.end)) })}. Or setCaptionTiming to the range where its own words are spoken.`}`);
      return false;
    }
    const spoken = run.map(index => words[index]), last = spoken.at(-1)!, next = words[run.at(-1)! + 1];
    // A caption may hold through the trailing silence the provider attached to its last word, or until the next word starts.
    const latestEnd = Math.max(last.heldEnd ?? last.end, next && next.start - last.end <= .5 ? next.start : last.end);
    // An end that stops at the next caption on its track is right even when the last word sounds on a little past it
    // (up to 0.4 s): the next caption has to start somewhere, and two captions never overlap.
    const meetsNext = captions.some(other => other !== caption && trackOf(other) === trackOf(caption) && Math.abs(other.start - end) <= frame + 1e-6) && end >= last.end - .4;
    if (options.checkTiming === false ? spoken[0].start >= end || last.end <= caption.start : Math.abs(caption.start - spoken[0].start) > tolerance || end < last.end - tolerance && !meetsNext || end > latestEnd + tolerance) {
      // Neighbouring captions make room on their own, except one the range would sit inside or cover whole.
      const target = { start: Math.round(spoken[0].start * timeline.fps) / timeline.fps, end: Math.round(last.end * timeline.fps) / timeline.fps };
      const walls = (other: typeof caption) => other.kind !== 'caption' || other.start <= target.start + 1e-7 && other.start + other.duration >= target.end - 1e-7 || other.start >= target.start - 1e-7 && other.start + other.duration <= target.end + 1e-7;
      const blocker = timeline.clips.find(other => other.id !== caption.id && other.kind !== 'audio' && other.kind !== 'effect' && walls(other) && trackOf(other) === trackOf(caption) && other.start < Math.round(last.end * timeline.fps) / timeline.fps - 1e-7 && Math.round(spoken[0].start * timeline.fps) / timeline.fps < other.start + other.duration - 1e-7);
      sink.push(`${label} has the right words at the wrong time: they are spoken at ${spokenRange(spoken)}. Call setCaptionTiming {clipId: ${JSON.stringify(caption.id)}, start: ${seconds(spoken[0].start)}, end: ${seconds(last.end)}}.${blocker ? ` ${blocker.kind === 'caption' ? 'Caption' : 'Clip'} ${blocker.id}${blocker.text ? ` ${JSON.stringify(blocker.text)}` : ''} (${seconds(blocker.start)}–${seconds(blocker.start + blocker.duration)} s) is on the same track inside that range: ${blocker.kind === 'caption' ? 'retime it to its own words, or put its words into this caption with editText, first' : 'move it first'} (other neighbouring captions make room on their own).` : ''}`);
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

/** Captions follow their speech through an edit that moved footage (trim, move, join, closing gaps): each caption that
 *  said the words under it, with all of them still playing, is shifted by how far its first and last word moved, through
 *  setCaptionTiming's rules, so neighbouring captions stay in order. A caption that was out of step with the speech
 *  snaps onto its own words (spoken within 1.5 s of it) when those words moved in this edit. A caption left over footage that was deleted, sitting over a
 *  gap this edit closed and over none of its words now, is removed and reported: it would otherwise caption other words. */
export function followSpeechCaptions(before: Timeline, after: Timeline, assets: Parameters<typeof retainedSpeechWords>[1]): { timeline: Timeline; followed: string[]; stranded: { clipId: string; text: string }[]; trimmed: CaptionNeighbourChange[] } {
  if (!after.clips.some(clip => clip.kind === 'caption')) return { timeline: after, followed: [], stranded: [], trimmed: [] };
  const was = retainedSpeechWords(before, assets), now = retainedSpeechWords(after, assets);
  const plain = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const frame = 1 / after.fps, within = (words: SpokenWord[], start: number, end: number) => words.filter(word => { const middle = (word.start + word.end) / 2; return middle >= start - frame && middle < end + frame; });
  const says = (text: string, words: SpokenWord[]) => !!plain(text) && words.length > 0 && plain(words.map(word => word.text).join(' ')).includes(plain(text));
  // A word played twice (footage reused) has no single new time: it never moves a caption.
  const count = new Map<string, number>(), at = new Map<string, SpokenWord>();
  for (const word of now) if (word.word) { count.set(word.word, (count.get(word.word) ?? 0) + 1); at.set(word.word, word); }
  const moves: { id: string; start: number; end: number; delta: number }[] = [], stranded: { clipId: string; text: string }[] = [];
  const gapsBefore = footageGaps(before), gapsAfter = footageGaps(after);
  const closedGap = (start: number, end: number) => gapsBefore.some(gap => start >= gap.start - frame && end <= gap.end + frame) && !gapsAfter.some(gap => start >= gap.start - frame && end <= gap.end + frame);
  // Fallback for a caption whose words cannot place it (a word cut at a piece edge): it moves with the footage under it.
  const withFootage = (old: { id: string; start: number; duration: number }) => {
    const under = before.clips.find(clip => (clip.kind === 'video' || clip.kind === 'image') && clip.start <= old.start + 1e-6 && old.start < clip.start + clip.duration - 1e-6);
    if (!under) return;
    // Where the source moment under the caption's start now plays: the same clip, or the clip a join or cut made of it.
    const rate = under.playbackRate ?? 1, moment = under.sourceStart + (old.start - under.start) * rate;
    const moved = after.clips.find(clip => clip.id === under.id && clip.sourceStart <= moment + 1e-6 && moment < sourceEndOf(clip) - 1e-6)
      ?? after.clips.find(clip => clip.kind === under.kind && clip.assetId === under.assetId && trackOf(clip) === trackOf(under) && clip.sourceStart <= moment + 1e-6 && moment < sourceEndOf(clip) - 1e-6);
    const delta = moved ? moved.start + (moment - moved.sourceStart) / (moved.playbackRate ?? 1) - old.start : 0;
    if (Math.abs(delta) >= frame / 2) moves.push({ id: old.id, start: Math.max(0, old.start + delta), end: Math.max(0, old.start + old.duration + delta), delta });
  };
  for (const caption of after.clips) {
    if (caption.kind !== 'caption') continue;
    const old = before.clips.find(clip => clip.id === caption.id);
    // Only captions this edit did not already place.
    if (!old || Math.abs(old.start - caption.start) > 1e-6 || Math.abs(old.duration - caption.duration) > 1e-6) continue;
    const end = old.start + old.duration, inside = within(was, old.start, end);
    if (!inside.length) {
      if (closedGap(old.start, end) && !says(caption.text ?? '', within(now, caption.start, caption.start + caption.duration))) stranded.push({ clipId: caption.id, text: caption.text ?? '' });
      // Without saved speech (or over none of it), a caption moves with the footage under it.
      else if (!closedGap(old.start, end)) withFootage(old);
      continue;
    }
    if (!says(caption.text ?? '', inside)) {
      // Out of step with the speech (say, the picture was nudged under it): when its own words, spoken within 1.5 s of it,
      // moved in this edit, it snaps onto them where they now play.
      const target = plain(caption.text ?? ''), run: SpokenWord[] = [];
      for (let from = 0; target && from < was.length && !run.length; from++) {
        if (Math.abs(was[from].start - old.start) > 1.5) continue;
        let text = '';
        for (let to = from; to < was.length && to - from < 8; to++) {
          text = `${text} ${plain(was[to].text)}`.trim();
          if (text === target) { run.push(...was.slice(from, to + 1)); break; }
          if (!target.startsWith(text)) break;
        }
      }
      if (!run.length || run.some(word => !word.word || count.get(word.word) !== 1)) { withFootage(old); continue; }
      const first = at.get(run[0].word!)!, last = at.get(run.at(-1)!.word!)!;
      if (Math.abs(first.start - run[0].start) < frame / 2) continue;
      moves.push({ id: caption.id, start: first.start, end: Math.max(first.start + frame, last.end), delta: first.start - old.start });
      continue;
    }
    if (inside.some(word => !word.word || count.get(word.word) !== 1)) { withFootage(old); continue; }
    const first = at.get(inside[0].word!)!, last = at.get(inside.at(-1)!.word!)!;
    const startDelta = first.start - inside[0].start, endDelta = last.end - inside.at(-1)!.end;
    if (Math.abs(startDelta) < frame / 2 && Math.abs(endDelta) < frame / 2) continue;
    moves.push({ id: caption.id, start: Math.max(0, old.start + startDelta), end: Math.max(0, end + endDelta), delta: startDelta });
  }
  let timeline = stranded.length ? { ...after, clips: after.clips.filter(clip => !stranded.some(item => item.clipId === clip.id)) } : after;
  // Captions moving earlier go first from the left, later ones first from the right, so none runs into one still to move.
  moves.sort((a, b) => (a.delta < 0 ? 0 : 1) - (b.delta < 0 ? 0 : 1) || (a.delta < 0 ? a.start - b.start : b.start - a.start));
  const followed: string[] = [], trimmed: CaptionNeighbourChange[] = [], pending = new Set(moves.map(move => move.id));
  for (const move of moves) {
    pending.delete(move.id);
    if (move.end - move.start < frame) continue;
    // A caption out of step with its words (say, half over deleted footage) is trimmed to make room; one is never removed,
    // and a caption still to follow is never trimmed.
    try {
      const retimed = updateCaptionTiming(timeline, move.id, { start: move.start, end: move.end });
      if (retimed.neighbours.some(item => item.action === 'removed' || pending.has(item.clipId))) continue;
      timeline = retimed.timeline; followed.push(move.id); trimmed.push(...retimed.neighbours);
    } catch { /* a caption that cannot follow stays; finish names it */ }
  }
  return { timeline, followed, stranded, trimmed };
}
