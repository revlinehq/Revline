import type { Timeline } from '../../../editor/types';
import type { Transcript } from '../../../media-analysis/transcript';
import { sourceEndOf, timelineTimeAtSource } from '../../../editor/playback-rate';
import { retakeEvidence, type SpeechCleanup } from '../../../speech-cleanup';
import { FILLERS, STUTTER_WORDS, scriptOutline, token, wordAnchor } from './script';

type SpeechAsset = { _id: string; fileName?: string; audioAssetId?: string; analysis?: { transcript?: Transcript; speechCleanup?: SpeechCleanup } };
/** A word that survives the cut, at its TIMELINE time; `source` and `sourceEnd` are its time in the footage it came from. */
export type CutWord = { text: string; start: number; end: number; source: number; sourceEnd: number; clipId: string; piece: string; assetId: string; speaker?: number };
export type CutFlag = {
  /** Stable across later edits: the kind, the source and the source second. */
  id: string;
  kind: 'repeat' | 'clipped-word' | 'mid-sentence' | 'pause';
  /** TIMELINE seconds. */
  at: number;
  end: number;
  clipId: string;
  /** At a join the cut made, as opposed to inside one untouched piece of footage. */
  atCut: boolean;
  detail: string;
  fix: string;
  /** SOURCE ranges whose removal fixes the flag: the earlier copy of a repeat, an abandoned line. */
  remove?: { clipId: string; start: number; end: number }[];
};
export type CutScript = {
  words: CutWord[];
  /** The surviving speech as sentences in timeline order; "‖" marks a cut between two words. */
  lines: { n: number; start: number; end: number; text: string; file?: string; speaker?: number }[];
  /** TIMELINE seconds where one kept piece of speech ends and the next begins. */
  cuts: number[];
  flags: CutFlag[];
};

const seconds = (value: number) => value.toFixed(2);
const quote = (text: string) => JSON.stringify(text.length > 70 ? `${text.slice(0, 67)}…` : text);
// A sentence may lose a leading connective without becoming a half sentence.
const LEAD_INS = new Set(['like', 'so', 'and', 'but', 'well', 'okay', 'ok', 'now', 'yeah', 'right', 'actually', 'basically', 'look', 'listen', 'anyway']);
/** Kinds finish holds a speech cut to, where they sit at a cut; a long pause can be a deliberate beat and is only reported. */
export const CUT_FAILING_KINDS: readonly CutFlag['kind'][] = ['repeat', 'clipped-word', 'mid-sentence'];

/** The script as cut: what the edited timeline now says, read from each clip's source range and the saved word
 * timings, with the problems a listener would hear at the cuts. No audio is read and nothing is transcribed again. */
export function cutScript(timeline: Timeline, assets: SpeechAsset[], options: { maxPause?: number } = {}): CutScript {
  const maxPause = options.maxPause ?? 1.5, flags: CutFlag[] = [], spoken = new Map<string, CutWord>(), bySource = new Map<string, CutWord>();
  const sources = new Map<string, SpeechAsset>();
  const clips = timeline.clips.filter(clip => clip.volume !== 0 && (clip.kind === 'audio' || clip.kind === 'video' && !clip.audioSeparated))
    .sort((a, b) => a.start - b.start);
  // A plain split leaves two clips that play the same source straight through: one piece, no cut between them.
  const joins = (a: (typeof clips)[number], b: (typeof clips)[number]) => a.assetId === b.assetId && a.kind === b.kind && Math.abs(a.start + a.duration - b.start) < .02 && Math.abs(sourceEndOf(a) - b.sourceStart) < .02;
  const piece = new Map<string, string>();
  for (const clip of clips) { const before = clips.find(other => other !== clip && joins(other, clip)); piece.set(clip.id, before ? piece.get(before.id) ?? before.id : clip.id); }
  for (const clip of clips) {
    const own = assets.find(asset => asset._id === clip.assetId);
    // Upload preparation stores speech evidence on the video source of an extracted audio clip.
    const asset = own?.analysis?.transcript ? own : assets.find(item => item.audioAssetId === clip.assetId), transcript = asset?.analysis?.transcript;
    if (!asset || !transcript?.words.length) continue;
    const from = clip.sourceStart, to = sourceEndOf(clip), edges = asset.analysis?.speechCleanup?.edges;
    const measured = edges?.length === transcript.words.length * 2;
    // An edge shared with the next piece of a plain split cuts nothing.
    const openStart = clips.some(other => other !== clip && joins(other, clip)), openEnd = clips.some(other => other !== clip && joins(clip, other));
    sources.set(asset._id, asset);
    // Words are in source order: start just before this clip's range and stop just after it.
    let low = 0, high = transcript.words.length;
    while (low < high) { const middle = low + high >> 1; if (transcript.words[middle].end < from - 1) low = middle + 1; else high = middle; }
    for (let index = low; index < transcript.words.length && transcript.words[index].start <= to + 1; index++) {
      const word = transcript.words[index];
      // Measured sound when the cleanup map has it; a transcriber's end can run on through trailing silence.
      const onset = measured ? edges[index * 2] : word.start, decay = measured ? edges[index * 2 + 1] : word.end;
      // A bite is counted only where the measured sound and the transcript agree the word is.
      const sure = { start: Math.max(onset, word.start), end: Math.max(Math.max(onset, word.start), Math.min(decay, word.end)) };
      const inside = measured ? (onset + decay) / 2 > from && (onset + decay) / 2 < to : wordAnchor(word) >= from && wordAnchor(word) < to;
      const id = (kind: string) => `${kind}:${asset._id.slice(-6)}:${seconds(word.start)}`;
      if (!inside) {
        const heard = Math.min(sure.end, to) - Math.max(sure.start, from), atStart = onset < from;
        // Part of a removed word still sounds at this clip's edge.
        if (measured && token(word.text) && heard > .12 && !(atStart ? openStart : openEnd)) flags.push({ id: id('clipped-word'), kind: 'clipped-word', at: timelineTimeAtSource(clip, Math.max(onset, from)), end: timelineTimeAtSource(clip, Math.min(decay, to)), clipId: clip.id, atCut: true, detail: `${Math.round(heard * 1000)} ms of the removed word ${quote(word.text)} is still heard at this clip's ${atStart ? 'start' : 'end'}`, fix: `Move that edge of clip ${clip.id} to source ${seconds(atStart ? decay : onset)} s so the word is fully out, or to source ${seconds(atStart ? onset : decay)} s to keep it whole.` });
        continue;
      }
      // A linked picture and sound clip carry the same word at the same moment; footage used twice is read at both places.
      const said: CutWord = { text: word.text, start: timelineTimeAtSource(clip, Math.max(word.start, from)), end: timelineTimeAtSource(clip, Math.min(Math.max(decay, word.start), to)), source: word.start, sourceEnd: Math.max(decay, word.start), clipId: clip.id, piece: piece.get(clip.id)!, assetId: asset._id, ...(word.speaker === undefined ? {} : { speaker: word.speaker }) };
      const key = `${asset._id}:${word.start.toFixed(3)}:${said.start.toFixed(2)}`;
      if (spoken.has(key)) continue;
      spoken.set(key, said);
      if (!bySource.has(`${asset._id}:${word.start.toFixed(3)}`)) bySource.set(`${asset._id}:${word.start.toFixed(3)}`, said);
      // Only measured sound can say a word is bitten into; the cleanup's own joins sit a few tens of milliseconds inside run-together words.
      const early = openStart ? 0 : from - sure.start, late = openEnd ? 0 : sure.end - to;
      if (measured && token(word.text) && (early > .1 || late > .1)) flags.push({ id: id('clipped-word'), kind: 'clipped-word', at: timelineTimeAtSource(clip, early > .1 ? from : to), end: timelineTimeAtSource(clip, early > .1 ? from : to), clipId: clip.id, atCut: true, detail: `${quote(word.text)} is cut ${Math.round(Math.max(early, late) * 1000)} ms into its ${early > .1 ? 'start' : 'end'}`, fix: `Move that edge of clip ${clip.id} to source ${seconds(early > .1 ? onset : decay)} s to keep the whole word.` });
    }
  }
  const words = [...spoken.values()].sort((a, b) => a.start - b.start);
  const cuts = words.flatMap((word, index) => index && words[index - 1].piece !== word.piece ? [word.start] : []);
  const fileOf = (assetId: string) => assets.find(asset => asset._id === assetId)?.fileName;

  for (const asset of sources.values()) {
    // Repeats: a word or phrase said, then said again; a sentence said twice. The cleanup's own evidence, on what is
    // left of one source, so layered or simultaneous speech from another source never reads as a doubled word.
    const own = words.filter(word => word.assetId === asset._id);
    const { restarts, retakes } = retakeEvidence(own.map(word => ({ text: word.text, start: word.start, end: word.end })));
    for (const cut of [...restarts, ...retakes]) {
      const earlier = own.filter(word => word.start >= cut.start - 1e-6 && word.start < cut.end - 1e-6);
      if (!earlier.length) continue;
      const next = own.find(word => word.start >= cut.end - 1e-6);
      const tokens = earlier.map(word => token(word.text)).filter(Boolean);
      const atCut = !!next && (earlier.some(word => word.piece !== earlier[0].piece) || next.piece !== earlier.at(-1)!.piece);
      // A doubled content word set off by a comma inside one piece ("very, very") can be meant; "one one" or one across a cut is a leftover.
      if (!atCut && tokens.length < 2 && !STUTTER_WORDS.has(tokens[0] ?? '') && /[,;:]$/.test(earlier.at(-1)!.text)) continue;
      // The earlier copy goes, up to the next kept word of its clip or to that clip's end.
      const remove = [...new Set(earlier.map(word => word.clipId))].map(clipId => { const part = earlier.filter(word => word.clipId === clipId); return { clipId, start: part[0].source, end: next && next.clipId === clipId ? next.source : Infinity }; });
      flags.push({ id: `repeat:${asset._id.slice(-6)}:${seconds(earlier[0].source)}`, kind: 'repeat', at: earlier[0].start, end: next?.start ?? earlier.at(-1)!.end, clipId: earlier[0].clipId, atCut, detail: `${quote(earlier.map(word => word.text).join(' '))} is said again right after${atCut ? ', across a cut' : ''}`, fix: 'Remove the earlier copy and keep the later one: readCutScript {remove:[id]}.', remove });
    }

    // Half sentences: a line of the source that the cut keeps only part of.
    const outline = scriptOutline(asset.analysis!.transcript!), has = (word: { start: number }) => bySource.get(`${asset._id}:${word.start.toFixed(3)}`);
    const removed = (word: { text: string; start: number; end: number }) => { const middle = (word.start + word.end) / 2; return FILLERS.has(token(word.text)) || !token(word.text) || outline.removable.some(cut => middle >= cut.start && middle < cut.end); };
    for (const line of outline.lines) {
      const all = outline.words.slice(line.from, line.to + 1), present = all.filter(word => has(word)), needed = all.filter(word => !removed(word));
      if (!present.length || !needed.length || line.note) continue;
      const first = needed.findIndex(word => has(word)), last = needed.reduce((found, word, index) => has(word) ? index : found, -1);
      if (first < 0) continue;
      const tokens = (list: typeof needed) => list.map(word => token(word.text)).join(' ');
      const lost = needed.slice(0, first), after = needed.slice(last + 1);
      // A dropped beginning that only says the kept beginning first ("There there we are") is a removed repeat.
      const head = lost.length > 0 && !lost.every(word => LEAD_INS.has(token(word.text))) && tokens(lost) !== tokens(present.slice(0, lost.length));
      // A dropped ending that only says the kept ending again is a removed repeat, not a half sentence.
      const tail = !head && after.length > 0 && tokens(after) !== tokens(present.slice(-after.length));
      if (!head && !tail) {
        // A kept line the speaker abandoned: a false start still in the footage.
        if (/(\.\.\.|…)["')\]]?$/.test(line.text)) {
          const said = present.map(word => has(word)!), start = said[0], follows = own.find(word => word.start > said.at(-1)!.start + 1e-6);
          const remove = [...new Set(said.map(word => word.clipId))].map(clipId => ({ clipId, start: said.find(word => word.clipId === clipId)!.source, end: follows && follows.clipId === clipId ? follows.source : Infinity }));
          flags.push({ id: `mid-sentence:${asset._id.slice(-6)}:${seconds(line.start)}`, kind: 'mid-sentence', at: start.start, end: said.at(-1)!.end, clipId: start.clipId, atCut: false, detail: `${quote(line.text)} trails off unfinished: a false start`, fix: 'Drop it: readCutScript {remove:[id]}.', remove });
        }
        continue;
      }
      const edge = has(head ? present[0] : present.at(-1)!)!;
      flags.push({ id: `mid-sentence:${asset._id.slice(-6)}:${seconds(line.start)}`, kind: 'mid-sentence', at: head ? edge.start : edge.end, end: head ? edge.start : edge.end, clipId: edge.clipId, atCut: true, detail: head ? `the cut starts mid-sentence at ${quote(present.slice(0, 5).map(word => word.text).join(' '))}, without the start of ${quote(line.text)}` : `${quote(line.text)} stops mid-sentence after ${quote(present.slice(-4).map(word => word.text).join(' '))}`, fix: head ? `Keep the line from source ${seconds(needed[0].start)} s, or drop the rest of it through source ${seconds(line.end)} s.` : `Keep the line through source ${seconds(needed.at(-1)!.end)} s, or drop it from source ${seconds(line.start)} s.` });
    }
  }

  // Dead air left between two surviving words.
  let heardUntil = 0;
  words.forEach((word, index) => {
    const next = words[index + 1];
    heardUntil = Math.max(heardUntil, word.end);
    if (next && next.start - heardUntil > maxPause) flags.push({ id: `pause:${word.assetId.slice(-6)}:${seconds(word.source)}`, kind: 'pause', at: heardUntil, end: next.start, clipId: word.clipId, atCut: word.piece !== next.piece, detail: `${(next.start - heardUntil).toFixed(1)} s without words after ${quote(word.text)}`, fix: 'Tighten it (cleanSpeech with kinds ["pause"] on that clip, or trim the edge) unless it is a deliberate beat or covered by b-roll.' });
  });

  const lines: CutScript['lines'] = [];
  let from = 0;
  words.forEach((word, index) => {
    const next = words[index + 1];
    if (next && next.assetId === word.assetId && next.speaker === word.speaker && !/[.!?…]["')\]]?$/.test(word.text) && next.start - word.end <= .9) return;
    const part = words.slice(from, index + 1);
    lines.push({ n: lines.length + 1, start: part[0].start, end: word.end, text: part.map((item, at) => `${at && part[at - 1].piece !== item.piece ? '‖ ' : ''}${item.text}`).join(' '), ...(fileOf(word.assetId) ? { file: fileOf(word.assetId) } : {}), ...(word.speaker === undefined ? {} : { speaker: word.speaker }) });
    from = index + 1;
  });
  const unique = [...new Map(flags.map(flag => [flag.id, flag])).values()].sort((a, b) => a.at - b.at);
  return { words, lines, cuts, flags: unique };
}

/** A flag finish fails on: a repeat, clipped word or half sentence that sits at a cut and was not kept on purpose. */
export const cutFlagFails = (flag: CutFlag, accepted: readonly string[] = []) => flag.atCut && CUT_FAILING_KINDS.includes(flag.kind) && !accepted.includes(flag.id);

/** finish, for a task that read its cut back: every failing spot of the cut in one result, each with its time and fix. */
export function cutScriptFailures(timeline: Timeline, assets: SpeechAsset[], accepted: readonly string[] = [], planChecked = false): string[] {
  // With a saved script plan the reel check already holds each line whole.
  const failing = cutScript(timeline, assets).flags.filter(flag => cutFlagFails(flag, accepted) && !(planChecked && flag.kind === 'mid-sentence'));
  if (!failing.length) return [];
  return [...failing.slice(0, 30).map(flag => `${flag.kind} at ${seconds(flag.at)} s [${flag.id}]: ${flag.detail}. ${flag.fix}`),
    `${failing.length} spot${failing.length === 1 ? '' : 's'} in the cut's speech. Fix each one, or keep one the request did not ask to change with readCutScript {accept:[{id, reason}]}.`];
}
