import type { Clip, Timeline, TimelineMarker } from './types';
import { placeOnFreeLayer } from './operations';
import { filmSections } from './approvals';
import { addTimelineMarker, isSectionMarker, moveTimelineMarker, removeTimelineMarkers, sectionMarkersIn } from './timeline-markers';

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
  // A section on another section marker's frame renames nothing: addTimelineMarker keeps the one that is there. Cues and beats on that frame stay beside it.
  for (const section of [...sections].sort((a, b) => a.at - b.at)) next = addTimelineMarker(next, start + section.at, crypto.randomUUID(), section.title, 'section');
  return { timeline: next, clip: { id, title, start, duration }, markers: sectionMarkersIn(next, { start, duration }).map(({ time, label }) => ({ time, label, filmTime: Math.round((time - start) * 1000) / 1000 })) };
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

/** Every scene clip holding this code (a film's beats, or the halves of a split scene) gets the new code, and a film's section markers follow it. */
export function withPatchedScene(timeline: Timeline, before: string, after: string) {
  const updated: string[] = [];
  const clips = timeline.clips.map(clip => {
    if (clip.kind !== 'scene' || clip.scene?.code !== before) return clip;
    updated.push(clip.id);
    return { ...clip, scene: { ...clip.scene, code: after } };
  });
  const synced = syncFilmSectionMarkers({ ...timeline, clips }, before, after);
  return { timeline: synced.timeline, updated, sectionMarkers: synced.changes };
}

const EPSILON = 1e-4;
const MEASURED_CUE = /^(?:beats|downbeats|accents|dropCandidates):/;
const nameKey = (name?: string) => name?.trim().toLowerCase() ?? '';
/** `kinded`: older section markers that gained `kind: 'section'`, after which other markers inside the film no longer split it. */
export type SectionMarkerChanges = { moved: number; added: number; removed: number; renamed: number; kinded: number };

/**
 * A film's section markers follow its section() calls after the code changes (patchScene, editScene, restoreSection):
 * a section that moved takes its marker along, a new section gets one, a deleted section loses its own, and a section
 * renamed in place keeps its marker under the new name. `after` is the code the film's clips hold now.
 *
 * A marker belongs to this film when it lies inside one of the film's clips and carries the title of a section the old
 * or new code names. Measured beats and cues with other labels, other films' markers, and markers of sections written
 * later (builtThrough) are never touched. Older section markers without a kind gain `kind: 'section'` here.
 */
export function syncFilmSectionMarkers(timeline: Timeline, before: string, after: string): { timeline: Timeline; changes?: SectionMarkerChanges } {
  const film = timeline.clips.filter(clip => clip.kind === 'scene' && clip.scene?.film && clip.scene.code === after);
  if (!film.length || before === after) return { timeline };
  const was = filmSections({ code: before }), now = filmSections({ code: after });
  // The timeline seconds where the film's clips show a film second, in timeline order.
  const shownAt = (filmTime: number) => film.flatMap(clip => {
    const rate = clip.playbackRate ?? 1, time = clip.start + (filmTime - clip.sourceStart) / rate;
    return time >= clip.start - EPSILON && time < clip.start + clip.duration - EPSILON ? [time] : [];
  }).sort((a, b) => a - b);
  const inFilm = (marker: TimelineMarker) => film.some(clip => marker.time >= clip.start - EPSILON && marker.time < clip.start + clip.duration - EPSILON);
  const titles = new Set([...was, ...now].map(call => nameKey(call.name)));
  const owned = (timeline.markers ?? []).filter(marker => inFilm(marker) && !MEASURED_CUE.test(marker.id) && titles.has(nameKey(marker.label)));
  const claimed = new Set<string>();
  // A film placed since markers carried a kind owns only its section-kind markers; an older film's are unkinded.
  const legacy = !owned.some(isSectionMarker);
  const markersOf = (title: string) => owned.filter(marker => !claimed.has(marker.id) && nameKey(marker.label) === nameKey(title) && (legacy || isSectionMarker(marker))).sort((a, b) => a.time - b.time);

  // Pair each new section with its old one by title; a section renamed without moving pairs by start.
  const left = [...was], pairs = now.map(call => {
    let index = left.findIndex(old => nameKey(old.name) === nameKey(call.name));
    if (index < 0) index = left.findIndex(old => Math.abs(old.start - call.start) < EPSILON && !now.some(other => nameKey(other.name) === nameKey(old.name)));
    return { call, old: index < 0 ? undefined : left.splice(index, 1)[0] };
  });

  const changes: SectionMarkerChanges = { moved: 0, added: 0, removed: 0, renamed: 0, kinded: 0 }, remove: string[] = [], add: { time: number; title: string }[] = [];
  let next = timeline;
  const relabel = (id: string, patch: Partial<TimelineMarker>) => { next = { ...next, markers: next.markers?.map(marker => marker.id === id ? { ...marker, ...patch } : marker) }; };
  for (const { call, old } of pairs) {
    const title = call.name ?? '', times = shownAt(call.start);
    // A section renamed in place keeps its own marker first, ahead of any marker already carrying the new title.
    const mine = [...(old && nameKey(old.name) !== nameKey(title) ? markersOf(old.name ?? '') : []), ...markersOf(title)];
    mine.forEach(marker => claimed.add(marker.id));
    times.forEach((time, index) => {
      const marker = mine[index];
      if (!marker) { add.push({ time, title }); return; }
      const moved = moveTimelineMarker(next, marker.id, time);
      if (moved !== next) { next = moved; changes.moved++; }
      if (marker.label !== title) { relabel(marker.id, { label: title }); changes.renamed++; }
      if (!isSectionMarker(marker)) { relabel(marker.id, { kind: 'section' }); changes.kinded++; }
    });
    // Extra markers of this section: a duplicate, or a start now trimmed out of every clip.
    remove.push(...mine.slice(times.length).map(marker => marker.id));
  }
  // Sections the new code deleted lose their markers.
  for (const old of left) remove.push(...markersOf(old.name ?? '').map(marker => marker.id));
  if (remove.length) { const removed = removeTimelineMarkers(next, remove); changes.removed = (next.markers?.length ?? 0) - (removed.markers?.length ?? 0); next = removed; }
  // New markers go in last, so a frame another section's marker just left is free.
  for (const { time, title } of add) { const added = addTimelineMarker(next, time, crypto.randomUUID(), title, 'section'); if (added !== next) { next = added; changes.added++; } }
  return { timeline: next, ...(Object.values(changes).some(Boolean) ? { changes } : {}) };
}
