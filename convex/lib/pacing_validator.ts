import { v } from 'convex/values';

/** A checkPacing request: the timeline range and how many samples a second to render. */
export const pacingRequestValidator = v.object({ start: v.number(), end: v.number(), fps: v.number() });
/** What the media worker measured (lib/media-analysis/pacing.ts). */
export const pacingResultValidator = v.object({
  start: v.number(), end: v.number(), fps: v.number(), samples: v.number(),
  changePerSecond: v.array(v.number()), cuts: v.array(v.number()), moves: v.number(),
  flags: v.array(v.object({ start: v.number(), end: v.number(), kind: v.union(v.literal('short-hold'), v.literal('busy'), v.literal('scattered'), v.literal('no-ease-in'), v.literal('no-ease-out'), v.literal('zoom-cut'), v.literal('too-fast'), v.literal('jump'), v.literal('flash'), v.literal('long-hold')), reason: v.string() })),
});
