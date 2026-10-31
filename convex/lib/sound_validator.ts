import { v } from 'convex/values';

/** A getSound (check false) or checkSound (check true) request: the timeline range, and for a check how many frames a second to sample. */
export const soundRequestValidator = v.object({ start: v.number(), end: v.number(), check: v.boolean(), fps: v.optional(v.number()) });
const timed = { start: v.number(), end: v.number() };
/** What the media worker heard (lib/media-analysis/sound.ts). */
export const soundResultValidator = v.object({
  ...timed,
  loudness: v.object({ integrated: v.union(v.number(), v.null()), peak: v.number() }),
  levels: v.array(v.number()), peaks: v.array(v.number()),
  events: v.array(v.object({ clipId: v.string(), name: v.string(), kind: v.union(v.literal('sfx'), v.literal('voice'), v.literal('music'), v.literal('footage')), ...timed, gain: v.number() })),
  onsets: v.array(v.object({ time: v.number(), level: v.number(), sources: v.array(v.string()) })),
  words: v.array(v.object({ text: v.string(), ...timed })),
  silences: v.array(v.object(timed)),
  check: v.optional(v.object({
    fps: v.number(),
    visualHits: v.array(v.object({ time: v.number(), size: v.number() })),
    effectOnsets: v.array(v.object({ time: v.number(), clipId: v.string(), name: v.string() })),
    flags: v.array(v.object({ ...timed, kind: v.union(v.literal('no-sound'), v.literal('no-visual'), v.literal('offset'), v.literal('over-word'), v.literal('clipping'), v.literal('count')), reason: v.string() })),
  })),
});
