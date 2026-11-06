// Music beat markers in a scene's own seconds, and section/shot timing written as beat(n), downbeat(n) or accent(n).
// The engine (approvals, scopes, drafts, finish) reads section timing as number literals from the source text, so
// beat timing is resolved to literals once: on the streamed draft before it is cut, and when the film is saved.
import { skipText } from './approvals';
import type { Clip, SceneBeats, TimelineMarker } from './types';

export const BEAT_KINDS = ['beats', 'downbeats', 'accents'] as const;
const CALLS = { beat: 'beats', downbeat: 'downbeats', accent: 'accents' } as const;
type Shown = { start: number; duration: number; sourceStart: number; playbackRate?: number };

/**
 * markMusicBeats markers (ids `beats:…`, `downbeats:…`, `accents:…`) in scene seconds, exact (on the frame grid):
 * each maps through the clip of the scene that shows it, or the nearest one, so splitting or trimming a film's clips
 * keeps the numbering. Undefined when none falls inside [0, length).
 */
export function markerBeats(markers: TimelineMarker[], shown: Shown[], length: number): SceneBeats | undefined {
  if (!markers.length || !shown.length) return undefined;
  const beats: SceneBeats = { beats: [], downbeats: [], accents: [] };
  const gap = (item: Shown, time: number) => Math.max(0, item.start - time, time - (item.start + item.duration));
  for (const marker of markers) {
    const kind = BEAT_KINDS.find(name => marker.id.startsWith(`${name}:`));
    if (!kind) continue;
    const on = shown.reduce((best, item) => gap(item, marker.time) < gap(best, marker.time) ? item : best, shown[0]);
    const time = on.sourceStart + (marker.time - on.start) * (on.playbackRate ?? 1);
    if (time >= -1e-6 && time < length - 1e-6) beats[kind].push(Math.max(0, time));
  }
  for (const kind of BEAT_KINDS) beats[kind].sort((a, b) => a - b);
  return BEAT_KINDS.some(kind => beats[kind].length) ? beats : undefined;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
// A timing slot: a number, kind(n), or kind(n) - kind(m) / kind(n) - number.
const TERM = String.raw`(?:\d+(?:\.\d+)?|(?:beat|downbeat|accent)\s*\(\s*\d+\s*\))`;
const SLOT = String.raw`${TERM}(?:\s*-\s*${TERM})?`;
const HEADER = new RegExp(String.raw`(?<![\w$.])(section|shot)(\s*\(\s*)((['"\`])(?:(?!\4)[^\\]|\\.)*\4)(\s*,\s*)(${SLOT})(\s*,\s*)(${SLOT})(?=\s*,)`, 'g');
const hasBeat = /(?:beat|downbeat|accent)\s*\(/;

/** `code` with strings and comments blanked (same length), so a header inside text is never resolved. */
function masked(code: string) {
  let out = '';
  for (let at = 0; at < code.length;) { const skipped = skipText(code, at); if (skipped === at) { out += code[at]; at++; } else { out += code.slice(at, skipped).replace(/[^\n]/g, ' '); at = skipped; } }
  return out;
}
/** Seconds as the saved literals write them: floored to the millisecond, so a section never starts after its marker's frame. */
export const floorMs = (seconds: number) => Math.floor(seconds * 1000 + 1e-6) / 1000;

/**
 * Code with every section()/shot() start and duration given as beat(n), downbeat(n) or accent(n) (or a difference of
 * two) replaced by number literals, with a comment after the duration saying what they were written as. A start is floored to the millisecond, so it never lands after its marker's frame;
 * a duration ends where its expression ends, floored the same way, so back-to-back sections stay contiguous. strict throws when a marker is missing (saving);
 * otherwise that call is left as it is (a streaming draft).
 */
export type ResolvedTiming = { title: string; start: number; duration: number; written: string };
export function resolveBeatTiming(code: string, beats: SceneBeats | undefined, strict: boolean): { code: string; resolved: ResolvedTiming[] } {
  if (!hasBeat.test(code)) return { code, resolved: [] };
  const resolved: ResolvedTiming[] = [];
  const value = (slot: string, name: string) => slot.split(/\s*-\s*/).map(term => {
    const call = /^(beat|downbeat|accent)\s*\(\s*(\d+)\s*\)$/.exec(term.trim());
    if (!call) return Number(term);
    const kind = CALLS[call[1] as keyof typeof CALLS], list = beats?.[kind] ?? [], n = Number(call[2]);
    if (!list.length) throw new Error(`${name} is timed with ${call[1]}(${n}), but no ${call[1]} markers reach this film. Run markMusicBeats on the song's audio clip with kind '${kind}' first, or give the time in seconds.`);
    if (n < 1 || n > list.length) throw new Error(`${name}: ${call[1]}(${n}) does not exist; this film has ${list.length} ${call[1]} markers (${call[1]}(1) = ${floorMs(list[0])}s, ${call[1]}(${list.length}) = ${floorMs(list.at(-1)!)}s).`);
    return list[n - 1];
  }).reduce((total, item, index) => index ? total - item : item, 0);
  const text = masked(code);
  const out = code.replace(HEADER, (whole, fn: string, open: string, title: string, _quote: string, gap1: string, start: string, gap2: string, duration: string, offset: number) => {
    if (!hasBeat.test(start) && !hasBeat.test(duration)) return whole;
    if (text.slice(offset, offset + fn.length) !== fn) return whole;
    const name = `${fn === 'shot' ? 'Shot' : 'Section'} "${title.slice(1, -1)}"`;
    try {
      const from = value(start, name), length = value(duration, name), timedStart = hasBeat.test(start);
      if (!(from >= 0)) throw new Error(`${name}: its start ${start} is ${round(from)}s; it must be 0 or later.`);
      if (!(length > 0)) throw new Error(`${name}: its duration ${duration} is ${round(length)}s; it must be positive (later marker minus earlier one).`);
      const literal = timedStart ? floorMs(from) : from, end = floorMs(from + length);
      const note = `${timedStart ? start : literal}, ${hasBeat.test(duration) ? duration : round(end - literal)}`;
      resolved.push({ title: title.slice(1, -1), start: literal, duration: round(end - literal), written: note });
      return `${fn}${open}${title}${gap1}${literal}${gap2}${round(end - literal)} /* ${note} */`;
    } catch (error) {
      if (strict) throw error;
      return whole;
    }
  });
  return { code: out, resolved };
}

/** The markers an existing scene clip reads (a film through all its clips of the same code). */
export function clipBeats(timeline: { markers?: TimelineMarker[]; clips: Clip[] }, clip: Clip) {
  return markerBeats(timeline.markers ?? [], shownClips(timeline.clips, clip), clip.scene?.film?.duration ?? clip.sourceStart + clip.duration * (clip.playbackRate ?? 1));
}
/** The clips that show a scene's clock: every clip of a film with its code, or a plain scene's own clip. */
export const shownClips = (clips: Clip[], clip: Clip) => clip.scene?.film ? clips.filter(other => other.kind === 'scene' && other.scene?.film && other.scene.code === clip.scene!.code) : [clip];
/** The markers a film about to be placed at timeline second `start` reads. */
export const newFilmBeats = (timeline: { markers?: TimelineMarker[] }, start: number, duration: number) => markerBeats(timeline.markers ?? [], [{ start, duration, sourceStart: 0 }], duration);
