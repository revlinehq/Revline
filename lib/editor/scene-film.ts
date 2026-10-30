import { trackOf, type Clip, type Timeline } from './types';
import { placeOnFreeLayer } from './operations';

type Scene = NonNullable<Clip['scene']>;
export type FilmBeat = { title: string; at: number };
export type SceneEdit = { find: string; replace: string; all?: boolean };

/**
 * A film's beat clips: one scene module cut into windows. Each clip starts `at` seconds into the film
 * (its sourceStart) and runs to the next cut, so the film's one timeline plays straight across the cuts.
 */
export function placeFilm(timeline: Timeline, { start, duration, beats, track, scene, ids = beats.map(() => crypto.randomUUID()) }: { start: number; duration: number; beats: FilmBeat[]; track?: number; scene: Omit<Scene, 'title' | 'film'>; ids?: string[] }) {
  const cuts = [...beats].sort((a, b) => a.at - b.at);
  if (Math.abs(cuts[0].at) > 1e-6) throw new Error('The first beat starts the film: give it at 0.');
  cuts.forEach((beat, index) => { const end = cuts[index + 1]?.at ?? duration; if (end - beat.at < 1 / timeline.fps) throw new Error(`Beat "${beat.title}" at ${beat.at}s needs to end after it starts (the next cut, or the film's duration ${duration}s).`); });
  // One layer for the whole film, free across its whole span, so its beats sit side by side.
  const probe = placeOnFreeLayer(timeline, { id: ids[0], kind: 'scene', start, duration, sourceStart: 0, ...(track !== undefined ? { track } : {}), scene: { ...scene, title: cuts[0].title } });
  const layer = trackOf(probe.clips.find(clip => clip.id === ids[0])!);
  let next = timeline;
  const clips = cuts.map((beat, index) => {
    const end = cuts[index + 1]?.at ?? duration, id = ids[index];
    next = placeOnFreeLayer(next, { id, kind: 'scene', track: layer, start: start + beat.at, duration: end - beat.at, sourceStart: beat.at, scene: { ...scene, title: beat.title, film: { duration } } });
    return { id, title: beat.title, start: start + beat.at, duration: end - beat.at, filmTime: beat.at };
  });
  return { timeline: next, clips };
}

/** Apply exact find/replace edits in order. A snippet that is missing, or appears more than once without `all`, fails the whole call. */
export function patchCode(code: string, edits: SceneEdit[]) {
  return edits.reduce((text, { find, replace, all }, index) => {
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
