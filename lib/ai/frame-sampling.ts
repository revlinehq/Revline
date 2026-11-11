import { renderedFrameTime } from '../editor/types';

/** The most timeline frames one look returns. More than one frame comes back as a single contact sheet. */
export const MAX_SHEET_FRAMES = 16;
/** A close look at one moment: this many consecutive frames at most. */
export const MAX_ZOOM_FRAMES = 7;

export type FrameLook = {
  times?: number[];
  range?: { start: number; end: number; step?: number };
  around?: { time: number; frames?: number };
};

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Evenly spaced picks from a sorted list, always keeping the first and the last. */
export function evenly<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  if (limit <= 1) return items.slice(0, 1);
  return Array.from({ length: limit }, (_, index) => items[Math.round(index * (items.length - 1) / (limit - 1))]);
}

/** Which frames a look draws. Sparse by default: a range is sampled about once a second and never more than
 *  MAX_SHEET_FRAMES per call; a request for more is thinned evenly and the note says so, with the stride used, so
 *  the caller narrows the window instead of asking for everything again. Every time is a real frame of the timeline. */
export function sampleFrameTimes(look: FrameLook, duration: number, fps: number): { times: number[]; note?: string } {
  const given = [look.times, look.range, look.around].filter(value => value !== undefined).length;
  if (given !== 1) throw new Error('Pass exactly one of times, range or around.');
  const snap = (time: number) => renderedFrameTime(time, duration, fps);
  const unique = (times: number[]) => [...new Set(times.map(snap))].sort((a, b) => a - b);
  if (look.around) {
    const count = Math.min(MAX_ZOOM_FRAMES, Math.max(1, Math.round(look.around.frames ?? 5))), center = Math.round(snap(look.around.time) * fps);
    const first = center - Math.floor(count / 2);
    return { times: unique(Array.from({ length: count }, (_, index) => (first + index) / fps)) };
  }
  if (look.range) {
    const start = snap(Math.min(look.range.start, look.range.end)), end = snap(Math.max(look.range.start, look.range.end)), span = end - start;
    if (span <= 0) return { times: [start] };
    // About one frame a second for scanning; a long range is spread over the cap instead.
    const asked = Math.max(1 / fps, look.range.step ?? 1), stride = Math.max(asked, span / (MAX_SHEET_FRAMES - 1));
    const times = unique(Array.from({ length: Math.floor(span / stride + 1e-6) + 1 }, (_, index) => start + index * stride));
    return { times, ...(stride > asked + 1e-6 ? { note: `${round(start)}-${round(end)} s at one frame every ${round(asked)} s is more than ${MAX_SHEET_FRAMES} frames, so this is ${times.length} evenly spaced frames, one every ${round(stride)} s. Narrow the range, or use around:{time} for a few consecutive frames at one moment.` } : {}) };
  }
  const all = unique(look.times!), times = evenly(all, MAX_SHEET_FRAMES);
  return { times, ...(times.length < all.length ? { note: `${all.length} times were asked for; one look returns at most ${MAX_SHEET_FRAMES}, so these are ${times.length} of them, evenly spaced (about one every ${round((all[all.length - 1] - all[0]) / (times.length - 1))} s). Ask again only for a narrower window you still need.` } : {}) };
}
