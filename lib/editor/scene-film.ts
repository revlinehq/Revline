import type { Clip, Timeline } from './types';
import { placeOnFreeLayer } from './operations';
import { addTimelineMarker } from './timeline-markers';

type Scene = NonNullable<Clip['scene']>;
/** A named section of a film, `at` film seconds from its start. */
export type FilmBeat = { title: string; at: number };
/** `insert` keeps the found snippet and puts `replace` before or after it: how a film grows part by part at a marker. */
export type SceneEdit = { find: string; replace: string; all?: boolean; insert?: 'before' | 'after' };

/**
 * A film is one scene clip for its whole length. Its sections are named timeline markers at their film
 * seconds, so the user and the agent can find and talk about them without splitting the clip. The clip
 * keeps `film`, so a later split of it makes windows onto the same film that play straight across the cut.
 */
export function placeFilm(timeline: Timeline, { title, start, duration, sections = [], track, scene, id = crypto.randomUUID() }: { title: string; start: number; duration: number; sections?: FilmBeat[]; track?: number; scene: Omit<Scene, 'title' | 'film'>; id?: string }) {
  for (const section of sections) if (section.at < 0 || section.at >= duration) throw new Error(`Section "${section.title}" at ${section.at}s needs to start inside the film (0 to ${duration}s).`);
  let next = placeOnFreeLayer(timeline, { id, kind: 'scene', start, duration, sourceStart: 0, ...(track !== undefined ? { track } : {}), scene: { ...scene, title, film: { duration } } });
  // A section on an existing marker's frame renames nothing: addTimelineMarker keeps the marker that is there.
  for (const section of [...sections].sort((a, b) => a.at - b.at)) next = addTimelineMarker(next, start + section.at, crypto.randomUUID(), section.title);
  return { timeline: next, clip: { id, title, start, duration }, markers: (next.markers ?? []).filter(marker => marker.time >= start - 1e-6 && marker.time < start + duration).map(({ time, label }) => ({ time, label, filmTime: Math.round((time - start) * 1000) / 1000 })) };
}

/** Prefer exact matches; tolerate line indentation and CRLF only when exact matching fails. */
export function sceneSnippetMatches(code: string, find: string, ranges = [{ from: 0, to: code.length }]) {
  const matches: { from: number; to: number }[] = [];
  if (!find) return matches;
  const keep = (from: number, to: number) => {
    if (ranges.some(range => range.from <= from && range.to >= to)) matches.push({ from, to });
  };
  for (let at = 0; at <= code.length - find.length;) {
    const from = code.indexOf(find, at);
    if (from < 0) break;
    keep(from, from + find.length);
    at = from + 1;
  }
  if (matches.length) return matches;
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = find.replace(/\r\n/g, '\n').split('\n');
  if (!lines.some(line => line.trim())) return matches;
  const pattern = lines.map(line => escape(line.replace(/^[\t ]+|[\t ]+$/g, ''))).join('[\\t ]*\\r?\\n[\\t ]*');
  const regex = new RegExp(`${/^[\t ]/.test(find) ? '^[\\t ]*' : ''}${pattern}${/[\t ]$/.test(find) ? '[\\t ]*' : ''}`, 'gm');
  for (let match; (match = regex.exec(code));) {
    keep(match.index, match.index + match[0].length);
    regex.lastIndex = match.index + 1;
  }
  return matches;
}

/** Nearby exact source, including indentation, so a failed match can be retried directly. */
export function closestCodeLines(code: string, snippet: string, startLine = 1, ranges?: { start: number; end: number }[]) {
  const lines = code.split('\n'), wanted = snippet.split('\n').filter(line => line.trim());
  const tokens = (line: string) => new Set(line.match(/[\w$]+|[^\s\w]/g) ?? []);
  // Anchor on the most informative line, rather than a common closing brace in a multiline find.
  const anchor = [...wanted].sort((a, b) => (b.match(/[\w$]+/g)?.join('').length ?? 0) - (a.match(/[\w$]+/g)?.join('').length ?? 0))[0];
  if (anchor === undefined) return '';
  const needle = tokens(anchor);
  const ranked = lines.map((line, index) => {
    const words = tokens(line);
    const score = 2 * [...needle].filter(word => words.has(word)).length / Math.max(1, words.size + needle.size);
    return { index, score };
  }).filter(item => !ranges || ranges.some(range => item.index + startLine >= range.start && item.index + startLine <= range.end)).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: number[] = [], windows: string[] = [];
  for (const { index } of ranked) {
    if (selected.some(other => Math.abs(other - index) < Math.min(12, wanted.length + 3))) continue;
    selected.push(index);
    const range = ranges?.find(range => index + startLine >= range.start && index + startLine <= range.end);
    const from = Math.max(range ? range.start - startLine : 0, index - 1), to = Math.min(range ? range.end - startLine + 1 : lines.length, index + Math.min(10, wanted.length) + 2);
    windows.push(lines.slice(from, to).map((line, offset) => `${startLine + from + offset}: ${line}`).join('\n'));
    if (windows.length === 3) break;
  }
  return windows.length ? `\nClosest matching lines (copy code without the line-number prefixes):\n${windows.join('\n\n')}` : '';
}

/** Every scene clip holding this code (a film's beats, or the halves of a split scene) gets the new code. */
export function withPatchedScene(timeline: Timeline, before: string, after: string) {
  const updated: string[] = [];
  const clips = timeline.clips.map(clip => {
    if (clip.kind !== 'scene' || clip.scene?.code !== before) return clip;
    updated.push(clip.id);
    return { ...clip, scene: { ...clip.scene, code: after } };
  });
  return { timeline: { ...timeline, clips }, updated };
}
