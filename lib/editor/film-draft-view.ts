import type { Clip, Timeline } from './types';

type Section = { title: string; start: number; duration: number };
/** A film the editor agent is still writing (convex/filmDrafts.ts). `start` is the timeline second of film time 0. */
export type FilmDraftView = { tool: 'addFilm' | 'patchScene'; title: string; start: number; duration: number; clip?: Clip; sections: Section[]; writing?: Section; planned: Section[] };

/** The preview's timeline with the draft film in it: a new film is added, a patched one replaces its clip. Never saved. */
export function withFilmDraft(timeline: Timeline, draft: FilmDraftView | undefined): Timeline {
  const clip = draft?.clip;
  if (!clip) return timeline;
  const exists = timeline.clips.some(item => item.id === clip.id);
  const clips = exists ? timeline.clips.map(item => item.id === clip.id ? clip : item) : [...timeline.clips, clip];
  return { ...timeline, clips, ...(timeline.tracks ? { tracks: { ...timeline.tracks, visual: Math.max(timeline.tracks.visual, clip.track ?? 1) } } : {}) };
}
