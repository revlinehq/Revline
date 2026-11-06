import type { Clip, Timeline } from './types';
import { declarations, filmSections, filmTimeAt, markerSection, reach, rootName, type FilmSection } from './approvals';
import { sectionMarkersIn } from './timeline-markers';

/**
 * Scoped edits: a change to a film names the part the user asked about (a section marker or a film range), and
 * every section() call outside it is locked for that call. Code a locked section owns (its call and every top-level
 * declaration it reaches) and code outside all sections (building the HTML, a shared camera, global styles) may change
 * only if the picture over the locked sections stays the same, which the visual guard renders to check.
 */

const EPSILON = 1e-4;
const round = (value: number) => Math.round(value * 1000) / 1000;
type Scene = NonNullable<Clip['scene']>;
export type FilmRange = { start: number; end: number; label?: string };
export type ScopeInput = string | { start: number; end: number };
type Section = FilmSection;

const timedSections = (scene: Scene) => filmSections(scene) as Section[];
/** Sections not inside another timed section. */
const outermost = (beats: Section[]) => beats.filter(beat => !beats.some(other => other !== beat && other.from <= beat.from && other.to >= beat.to));
const overlaps = (beat: { start: number; duration: number }, ranges: FilmRange[]) => ranges.some(range => beat.start < range.end - EPSILON && beat.start + beat.duration > range.start + EPSILON);
export const sectionCount = (scene: Scene) => outermost(timedSections(scene)).length;
/** A film's sections as film-second ranges, one per timed section() call, in order. */
export const sectionRanges = (scene: Scene): FilmRange[] => timedSections(scene).map(beat => ({ start: beat.start, end: round(beat.start + beat.duration) }));

/** The film seconds a scope names: a marker (id or label) on this film, or a film-second range. */
export function resolveScope(timeline: Timeline, clip: Clip, scope: ScopeInput | ScopeInput[]): FilmRange[] {
  return (Array.isArray(scope) ? scope : [scope]).map(item => {
    if (typeof item !== 'string') {
      if (!(item.end > item.start)) throw new Error('A scope range needs end after start, in film seconds.');
      return { start: item.start, end: item.end };
    }
    const wanted = item.trim().toLowerCase(), markers = timeline.markers ?? [];
    const named = (list: typeof markers) => list.find(entry => entry.label?.trim().toLowerCase() === wanted);
    const marker = markers.find(entry => entry.id === item) ?? named(sectionMarkersIn(timeline, clip)) ?? named(markers);
    if (!marker) throw new Error(`No section marker "${item}". Markers on this timeline: ${markers.map(entry => `"${entry.label || entry.id}" at ${round(entry.time)}s`).join(', ') || 'none'}. Pass one of them, or a {start, end} film range.`);
    const section = markerSection(timeline, clip, marker.id);
    return { start: round(filmTimeAt(clip, section.start)), end: round(filmTimeAt(clip, section.end)), ...(section.label ? { label: section.label } : {}) };
  });
}

/** Declarations reached only by in-scope sections: the rest of the code may not depend on them, so they change freely. */
function freeNames(scene: Scene, ranges: FilmRange[]) {
  const beats = outermost(timedSections(scene)), root = rootName(scene.code);
  const inside = reach(scene, beats.filter(beat => overlaps(beat, ranges)).map(beat => beat.text)).names;
  const outside = reach(scene, beats.filter(beat => !overlaps(beat, ranges)).map(beat => beat.text)).names;
  // What the default export reaches besides its section() calls, and what the module runs before its first declaration (imports, registrations).
  const skeleton = withoutSections(scene.code, beats), body = root ? declarations(skeleton).get(root) ?? '' : '';
  const first = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class)\s/m.exec(skeleton)?.index ?? skeleton.length;
  const fromRoot = reach(scene, [body, skeleton.slice(0, first)]).names;
  return new Set([...inside].filter(name => !outside.has(name) && !fromRoot.has(name)));
}
const withoutSections = (code: string, beats: Section[]) => [...beats].sort((a, b) => b.from - a.from).reduce((text, beat) => text.slice(0, beat.from) + text.slice(beat.to), code);
const squeeze = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Everything a film renders from besides its timed sections and the declarations only in-scope sections reach. */
function sharedCode(scene: Scene, ranges: FilmRange[]) {
  const free = freeNames(scene, ranges), strip = (code: string) => { let text = code; for (const [name, body] of declarations(code)) if (free.has(name)) text = text.replace(body, ''); return squeeze(text); };
  const { code: _code, codeRef: _ref, title: _title, ...rest } = scene;
  return JSON.stringify({ code: strip(withoutSections(scene.code, outermost(timedSections(scene)))), rest });
}

/** The locked part of a film a change touched: each out-of-scope section whose code changed, and whether shared code changed. */
function scopeLeaks(before: Scene, after: Scene, ranges: FilmRange[]) {
  const owned = (scene: Scene, beat: Section) => reach(scene, [beat.text]).parts.join('\n\u0000\n');
  const was = outermost(timedSections(before)).filter(beat => !overlaps(beat, ranges)), now = outermost(timedSections(after)).filter(beat => !overlaps(beat, ranges));
  const left = [...now], changed: FilmRange[] = [];
  for (const beat of was) {
    const index = left.findIndex(other => other.start === beat.start && other.duration === beat.duration);
    if (index < 0) { changed.push({ start: beat.start, end: round(beat.start + beat.duration) }); continue; }
    const [other] = left.splice(index, 1);
    if (owned(before, beat) !== owned(after, other)) changed.push({ start: beat.start, end: round(beat.start + beat.duration) });
  }
  // A section moved or added outside the scope shows something new there.
  for (const beat of left) changed.push({ start: beat.start, end: round(beat.start + beat.duration) });
  return { beats: changed, shared: sharedCode(before, ranges) !== sharedCode(after, ranges) };
}

/** The locked sections a guard must render: those the change touched, or every out-of-scope section when shared code changed. */
export function guardedSections(before: Scene, after: Scene, ranges: FilmRange[]) {
  const leaks = scopeLeaks(before, after, ranges);
  if (!leaks.shared) return leaks.beats;
  const all = outermost(timedSections(before)).filter(beat => !overlaps(beat, ranges)).map(beat => ({ start: beat.start, end: round(beat.start + beat.duration) }));
  return [...all, ...leaks.beats.filter(range => !all.some(other => other.start === range.start && other.end === range.end))];
}

/** Timeline seconds to render inside each locked section: up to three, where a clip of the film shows it. */
export function guardTimes(clips: Clip[], ranges: FilmRange[], fps: number, limit = 24) {
  const perSection = ranges.length * 3 <= limit ? 3 : 2, times: { time: number; range: FilmRange }[] = [];
  for (const range of ranges) for (const fraction of perSection === 3 ? [.2, .55, .9] : [.3, .8]) {
    const film = range.start + (range.end - range.start) * fraction;
    const clip = clips.find(item => film >= item.sourceStart - EPSILON && film < item.sourceStart + item.duration * (item.playbackRate ?? 1) - EPSILON);
    if (clip) times.push({ time: Math.round((clip.start + (film - clip.sourceStart) / (clip.playbackRate ?? 1)) * fps) / fps, range });
  }
  return times.slice(0, limit);
}

/**
 * One section of a film put back from an older version of its code: the section() calls over it and the
 * declarations only they reach come from `old`, everything else stays as it is in `current`. Shared declarations
 * that differ are named in `shared`; restoring them too (withShared) is left to the visual guard.
 */
export function restoreSectionCode(current: Scene, old: Scene, ranges: FilmRange[], withShared = false) {
  const now = outermost(timedSections(current)).filter(beat => overlaps(beat, ranges)), then = outermost(timedSections(old)).filter(beat => overlaps(beat, ranges));
  if (!then.length) throw new Error('The older version has no section() call with literal start and duration over that section, so it cannot be restored on its own. Use restoreClip for the whole film.');
  if (!now.length) throw new Error('The current film has no section() call with literal start and duration over that section to replace. Use restoreClip for the whole film.');
  const oldDeclarations = declarations(old.code), currentDeclarations = declarations(current.code);
  const wanted = reach(old, then.map(beat => beat.text)).names, free = freeNames(old, ranges);
  const shared = [...wanted].filter(name => !free.has(name) && oldDeclarations.has(name) && oldDeclarations.get(name) !== currentDeclarations.get(name));
  if (shared.length && !withShared) throw new Error(`Nothing was changed. The section's code uses ${shared.join(', ')}, which other parts of the film share and which changed since then. Restoring them could change other sections too. Call again with includeShared: true to put them back as well (the visual guard then refuses it if any other section would look different), or restore only after patching those by hand.`);
  // Section calls in their old text, between the first and last current call over the section.
  const from = Math.min(...now.map(beat => beat.from)), to = Math.max(...now.map(beat => beat.to));
  let code = current.code.slice(0, from) + old.code.slice(Math.min(...then.map(beat => beat.from)), Math.max(...then.map(beat => beat.to))) + current.code.slice(to);
  const restored: string[] = [];
  for (const name of [...wanted].filter(item => oldDeclarations.has(item) && (free.has(item) || withShared))) {
    const body = oldDeclarations.get(name)!, present = declarations(code).get(name);
    if (present === body) continue;
    if (present !== undefined) code = code.replace(present, body);
    else { const root = rootName(code), at = root ? code.search(new RegExp(`^export\\s+default\\s+function\\s+${root}\\b`, 'm')) : -1; code = at < 0 ? `${code.trimEnd()}\n\n${body}` : `${code.slice(0, at)}${body.trimEnd()}\n\n${code.slice(at)}`; }
    restored.push(name);
  }
  return { code, restored, shared };
}
