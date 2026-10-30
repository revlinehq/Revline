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

/** Apply exact find/replace edits in order. A snippet that is missing, or appears more than once without `all`, fails the whole call. */
export function patchCode(code: string, edits: SceneEdit[]) {
  return edits.reduce((text, { find, replace: given, all, insert }, index) => {
    const replace = insert === 'before' ? given + find : insert === 'after' ? find + given : given;
    const label = edits.length > 1 ? `Edit ${index + 1}: ` : '';
    const count = find ? text.split(find).length - 1 : 0;
    if (!count) throw new Error(`${label}the snippet was not found. Copy it exactly from the current code (inspectClip), whitespace and quotes included${closest(text, find)}. Nothing was changed.`);
    if (count > 1 && !all) throw new Error(`${label}the snippet appears ${count} times. Add surrounding code so it is unique, or set all: true to replace every one. Nothing was changed.`);
    return all ? text.split(find).join(replace) : text.replace(find, () => replace);
  }, code);
}

/** The line of the code most like the snippet's first line, so a near miss can be copied right. */
function closest(code: string, snippet: string) {
  const first = snippet.split('\n').find(line => line.trim())?.trim();
  if (!first) return '';
  const words = new Set(first.split(/\W+/).filter(word => word.length > 2));
  let best = '', score = 0;
  for (const line of code.split('\n')) { const found = line.split(/\W+/).filter(word => words.has(word)).length; if (found > score) { best = line.trim(); score = found; } }
  return score >= Math.min(2, words.size) && best ? `. The closest line is: ${best.length > 160 ? `${best.slice(0, 160)}…` : best}` : '';
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
