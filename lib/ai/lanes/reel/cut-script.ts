import type { Timeline } from '../../../editor/types';
import type { Transcript } from '../../../media-analysis/transcript';
import { sourceEndOf, timelineTimeAtSource } from '../../../editor/playback-rate';
import { retakeEvidence, type SpeechCleanup } from '../../../speech-cleanup';
import { FILLERS, STUTTER_WORDS, scriptOutline, token, wordAnchor } from './script';
import { retakeHints } from './retakes';

type SpeechAsset = { _id: string; fileName?: string; audioAssetId?: string; analysis?: { transcript?: Transcript; speechCleanup?: SpeechCleanup } };
/** A word that survives the cut, at its TIMELINE time; `source` and `sourceEnd` are its time in the footage it came from. */
export type CutWord = { text: string; start: number; end: number; source: number; sourceEnd: number; clipId: string; piece: string; assetId: string; speaker?: number };
export type CutFlag = {
  /** Stable across later edits: the kind, the source and the source second. */
  id: string;
  /** retake: a hint that a sentence is said again later in other words, or restarted midway. */
  kind: 'repeat' | 'retake' | 'clipped-word' | 'mid-sentence' | 'pause';
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
  lines: { n: number; start: number; end: number; text: string; file?: string; speaker?: number; from: number; to: number }[];
  /** TIMELINE seconds where one kept piece of speech ends and the next begins. */
  cuts: number[];
  flags: CutFlag[];
};

const seconds = (value: number) => value.toFixed(2);
const quote = (text: string) => JSON.stringify(text.length > 70 ? `${text.slice(0, 67)}…` : text);
// A sentence may lose a leading connective without becoming a half sentence.
const LEAD_INS = new Set(['like', 'so', 'and', 'but', 'well', 'okay', 'ok', 'now', 'yeah', 'right', 'actually', 'basically', 'look', 'listen', 'anyway']);
/** SOURCE ranges that cut these words out: per clip, from its first of them to the next kept word of that clip, or the clip's end. */
function removalRanges(cut: CutWord[], next: CutWord | undefined) {
  return [...new Set(cut.map(word => word.clipId))].map(clipId => ({ clipId, start: cut.find(word => word.clipId === clipId)!.source, end: next && next.clipId === clipId ? next.source : Infinity }));
}
/** Kinds finish holds a speech cut to, where they sit at a cut; a long pause can be a deliberate beat and is only reported. */
export const CUT_FAILING_KINDS: readonly CutFlag['kind'][] = ['repeat', 'retake', 'clipped-word', 'mid-sentence'];

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

  const lines: CutScript['lines'] = [];
  let from = 0;
  words.forEach((word, index) => {
    const next = words[index + 1];
    if (next && next.assetId === word.assetId && next.speaker === word.speaker && !/[.!?…]["')\]]?$/.test(word.text) && next.start - word.end <= .9) return;
    const part = words.slice(from, index + 1);
    lines.push({ n: lines.length + 1, start: part[0].start, end: word.end, text: part.map((item, at) => `${at && part[at - 1].piece !== item.piece ? '‖ ' : ''}${item.text}`).join(' '), ...(fileOf(word.assetId) ? { file: fileOf(word.assetId) } : {}), ...(word.speaker === undefined ? {} : { speaker: word.speaker }), from, to: index });
    from = index + 1;
  });
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
      const remove = removalRanges(earlier, next);
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
          const remove = removalRanges(said, follows);
          flags.push({ id: `mid-sentence:${asset._id.slice(-6)}:${seconds(line.start)}`, kind: 'mid-sentence', at: start.start, end: said.at(-1)!.end, clipId: start.clipId, atCut: false, detail: `${quote(line.text)} trails off unfinished: a false start`, fix: 'Drop it: readCutScript {remove:[id]}.', remove });
        }
        continue;
      }
      const edge = has(head ? present[0] : present.at(-1)!)!;
      flags.push({ id: `mid-sentence:${asset._id.slice(-6)}:${seconds(line.start)}`, kind: 'mid-sentence', at: head ? edge.start : edge.end, end: head ? edge.start : edge.end, clipId: edge.clipId, atCut: true, detail: head ? `the cut starts mid-sentence at ${quote(present.slice(0, 5).map(word => word.text).join(' '))}, without the start of ${quote(line.text)}` : `${quote(line.text)} stops mid-sentence after ${quote(present.slice(-4).map(word => word.text).join(' '))}`, fix: head ? `Keep the line from source ${seconds(needed[0].start)} s, or drop the rest of it through source ${seconds(line.end)} s.` : `Keep the line through source ${seconds(needed.at(-1)!.end)} s, or drop it from source ${seconds(line.start)} s.` });
    }
    // Reworded retakes and restarts inside a sentence: hints from word overlap and shared numbers and names, so the
    // model's own reading of the prose has the likely spots marked. Spots another flag already names are left to it.
    const taken = flags.filter(flag => flag.kind === 'repeat' || flag.kind === 'mid-sentence');
    for (const speaker of new Set(own.map(word => word.speaker))) {
      const sentences = lines.filter(line => words[line.from].assetId === asset._id && words[line.from].speaker === speaker);
      for (const hint of retakeHints(sentences.map(line => ({ words: words.slice(line.from, line.to + 1), start: line.start, end: line.end })))) {
        const line = sentences[hint.sentence], again = sentences[hint.again], earlier = words.slice(line.from + hint.from, line.from + hint.to + 1);
        if (!earlier.length || taken.some(flag => flag.at < earlier.at(-1)!.end && flag.end > earlier[0].start)) continue;
        // A hook said again as the closing line is a callback, not a retake.
        if (hint.kind === 'reworded' && hint.sentence === 0 && hint.again >= sentences.length - 2) continue;
        const next = own.find(word => word.start > earlier.at(-1)!.start + 1e-6);
        const atCut = !!next && (earlier.some(word => word.piece !== earlier[0].piece) || next.piece !== earlier.at(-1)!.piece);
        const remove = removalRanges(earlier, next);
        const said = quote(earlier.map(word => word.text).join(' '));
        flags.push({ id: `retake:${asset._id.slice(-6)}:${seconds(earlier[0].source)}`, kind: 'retake', at: earlier[0].start, end: next?.start ?? earlier.at(-1)!.end, clipId: earlier[0].clipId, atCut, detail: hint.kind === 'restart' ? `S${line.n} restarts midway: ${said} is said, then begun again` : `S${line.n} ${said} looks like an earlier take of S${again.n} ${quote(again.text.replace(/‖ /g, ''))}: the same point in other words`, fix: 'If the prose says this point twice, remove the earlier copy: readCutScript {remove:[id]}. If they are two different points, accept it with the reason.', remove });
      }
    }
  }

  // Dead air left between two surviving words.
  let heardUntil = 0;
  words.forEach((word, index) => {
    const next = words[index + 1];
    heardUntil = Math.max(heardUntil, word.end);
    if (next && next.start - heardUntil > maxPause) flags.push({ id: `pause:${word.assetId.slice(-6)}:${seconds(word.source)}`, kind: 'pause', at: heardUntil, end: next.start, clipId: word.clipId, atCut: word.piece !== next.piece, detail: `${(next.start - heardUntil).toFixed(1)} s without words after ${quote(word.text)}`, fix: 'Tighten it (cleanSpeech with kinds ["pause"] on that clip, or trim the edge) unless it is a deliberate beat or covered by b-roll.' });
  });

  const unique = [...new Map(flags.map(flag => [flag.id, flag])).values()].sort((a, b) => a.at - b.at);
  return { words, lines, cuts, flags: unique };
}

/** A flag finish fails on: a repeat, clipped word or half sentence that sits at a cut and was not kept on purpose. A reel
 * (everywhere) is a clean script: a repeat, retake or false start fails wherever it sits, untouched footage included. */
export const cutFlagFails = (flag: CutFlag, accepted: readonly string[] = [], everywhere = false) => (flag.atCut || everywhere && flag.kind !== 'clipped-word') && CUT_FAILING_KINDS.includes(flag.kind) && !accepted.includes(flag.id);

/** finish, for a task that read its cut back: every failing spot of the cut in one result, each with its time and fix. */
export function cutScriptFailures(timeline: Timeline, assets: SpeechAsset[], accepted: readonly string[] = [], planChecked = false, everywhere = false): string[] {
  // With a saved script plan the reel check already holds each line whole; a false start it kept is still one.
  const failing = cutScript(timeline, assets).flags.filter(flag => cutFlagFails(flag, accepted, everywhere) && !(planChecked && flag.kind === 'mid-sentence' && flag.atCut));
  if (!failing.length) return [];
  return [...failing.slice(0, 30).map(flag => `${flag.kind} at ${seconds(flag.at)} s [${flag.id}]: ${flag.detail}. ${flag.fix}`),
    `${failing.length} spot${failing.length === 1 ? '' : 's'} in the cut's speech. Fix each one, or keep one the request did not ask to change with readCutScript {accept:[{id, reason}]}.`];
}

/** The cut as one paragraph a listener would hear: no caption breaks or cut marks, each sentence tagged with its number and
 * TIMELINE range, and a speaker or file named only where it changes. */
export function cutProse(script: Pick<CutScript, 'lines'>) {
  let voice = '';
  return script.lines.map(line => {
    const who = [line.file, line.speaker === undefined ? undefined : `speaker ${line.speaker}`].filter(Boolean).join(', ');
    const label = who && who !== voice && script.lines.some(other => other.file !== line.file || other.speaker !== line.speaker) ? ` ${who}` : '';
    voice = who;
    return `[S${line.n} ${line.start.toFixed(2)}–${line.end.toFixed(2)}${label}] ${line.text.replace(/‖ /g, '')}`;
  }).join(' ');
}

/** Rounds of cutting one read cut before the loop stops: finish then holds hints only at the cuts, and the agent reports what is left. */
export const CUT_READ_ROUNDS = 4;
/** How the model reads the prose: as the viewer hears it, deciding itself what is said twice. */
export const CUT_READING = 'Read the prose as the viewer will hear it. Does any point get said more than once, any sentence start and get abandoned, or any line not make sense? A reworded retake is a repeat, the same as an exact one: the same claim, numbers or names said again in other words. Keep the last complete version of each point and cut the rest (drop:[{sentence, text?}] or remove:[flag ids]), then read again. The flags are hints from word overlap; your reading decides.';

/** SOURCE ranges that cut one sentence of the read, or the exact words quoted from it, up to the next kept word. */
export function cutWordsRemoval(script: Pick<CutScript, 'words' | 'lines'>, sentence: number, text?: string) {
  const line = script.lines.find(item => item.n === sentence);
  if (!line) throw new Error(`There is no sentence S${sentence}. The read has S1 to S${script.lines.length}.`);
  // Punctuation-only words ("-") are matched around, never against.
  const all = script.words.slice(line.from, line.to + 1).filter(word => token(word.text));
  let chosen = all;
  if (!all.length) throw new Error(`S${sentence} has no words to cut.`);
  if (text) {
    const wanted = text.split(/\s+/).map(token).filter(Boolean), have = all.map(word => token(word.text));
    const at = have.flatMap((_, index) => wanted.length && wanted.every((value, offset) => have[index + offset] === value) ? [index] : []);
    if (!at.length) throw new Error(`S${sentence} does not contain the words ${JSON.stringify(text)}. Copy them exactly from: ${JSON.stringify(line.text.replace(/‖ /g, ''))}`);
    if (at.length > 1) throw new Error(`${JSON.stringify(text)} appears ${at.length} times in S${sentence}. Quote more of the words around the copy to cut.`);
    chosen = all.slice(at[0], at[0] + wanted.length);
  }
  const index = script.words.indexOf(chosen.at(-1)!), next = script.words.slice(index + 1).find(word => word.assetId === chosen[0].assetId);
  return removalRanges(chosen, next);
}
