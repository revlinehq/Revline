/** Pacing of a rendered timeline range: how much of the picture changes over time, how long it then holds,
 * how the camera (zoom and pan) speeds up and slows down, and where cuts or flashes land. Measured from small
 * grayscale frames sampled at a steady rate, so motion problems a still frame cannot show become numbers. */

export type PacingFlag = { start: number; end: number; kind: 'short-hold' | 'busy' | 'scattered' | 'no-ease-in' | 'no-ease-out' | 'zoom-cut' | 'too-fast' | 'jump' | 'flash' | 'long-hold'; reason: string };
export type PacingResult = { start: number; end: number; fps: number; samples: number; changePerSecond: number[]; cuts: number[]; moves: number; flags: PacingFlag[] };

// A pixel changed when it moved by more than this (of 255) between two samples.
const PIXEL_CHANGE = 18;
// A step under this share of changed pixels is still: grain, a cursor, a slow drift.
const STILL = .004;
// A change of this much of the frame is something new for the viewer to read: in a product film a new
// headline or a panel filling in is only a few percent of the frame.
const KEY_CHANGE = .025;
// Smaller changes (a cursor, a blinking caret) do not end the time the viewer has to read.
const ENDS_HOLD = .01;
const READABLE_HOLD = 1;
const BUSY_CHANGE = .025, BUSY_COUNT = 3;
// The eye follows one place at a time: changes in this many separate places within the window are too many.
const PLACES = 3, PLACES_WINDOW = 1.5, GRID = { columns: 4, rows: 3 };
const CUT = .45;
const LONG_HOLD = 3;
// Camera speed is in frame fractions per second (zoom as ln(scale), pan as share of the width).
const MOVING = .02, TOO_FAST = 1.2, FULL_SPEED = .65;

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const at = (seconds: number) => `${round(seconds, 1)}s`;

/** Share of pixels that differ by more than PIXEL_CHANGE. */
function changed(a: Uint8Array, b: Uint8Array) {
  let count = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > PIXEL_CHANGE) count++;
  return count / a.length;
}

/** Which cells of a 4x3 grid changed (more than 5% of their pixels) between two frames. */
function places(a: Uint8Array, b: Uint8Array, width: number, height: number) {
  const counts = new Array<number>(GRID.columns * GRID.rows).fill(0), sizes = new Array<number>(GRID.columns * GRID.rows).fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = Math.min(GRID.rows - 1, Math.floor(y * GRID.rows / height)) * GRID.columns + Math.min(GRID.columns - 1, Math.floor(x * GRID.columns / width));
    sizes[cell]++; if (Math.abs(a[y * width + x] - b[y * width + x]) > PIXEL_CHANGE) counts[cell]++;
  }
  return new Set(counts.flatMap((count, cell) => count / sizes[cell] > .05 ? [cell] : []));
}

/** The zoom (scale about the centre) and shift that best map frame a onto frame b, and how well they fit. */
function cameraStep(a: Uint8Array, b: Uint8Array, width: number, height: number) {
  const cx = width / 2, cy = height / 2;
  const sample = (frame: Uint8Array, x: number, y: number) => {
    if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return -1;
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1), fx = x - x0, fy = y - y0;
    const top = frame[y0 * width + x0] * (1 - fx) + frame[y0 * width + x1] * fx, bottom = frame[y1 * width + x0] * (1 - fx) + frame[y1 * width + x1] * fx;
    return top * (1 - fy) + bottom * fy;
  };
  // Mean difference between b and a warped by (scale, dx, dy), on every second pixel inside a margin.
  const error = (scale: number, dx: number, dy: number) => {
    let sum = 0, count = 0;
    for (let y = 4; y < height - 4; y += 2) for (let x = 4; x < width - 4; x += 2) {
      const value = sample(a, cx + (x - cx - dx) / scale, cy + (y - cy - dy) / scale);
      if (value < 0) continue;
      sum += Math.abs(b[y * width + x] - value); count++;
    }
    return count ? sum / count : Infinity;
  };
  const raw = error(1, 0, 0);
  let best = { scale: 1, dx: 0, dy: 0, error: raw };
  const tryAt = (scale: number, dx: number, dy: number) => { const e = error(scale, dx, dy); if (e < best.error) best = { scale, dx, dy, error: e }; };
  // Coarse to fine: zoom alone, then shift, then both refined.
  for (let step = -16; step <= 16; step++) tryAt(Math.exp(step * .01), 0, 0);
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) tryAt(best.scale, dx, dy);
  const coarse = best;
  for (let step = -5; step <= 5; step++) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) tryAt(coarse.scale * Math.exp(step * .002), coarse.dx + dx * .5, coarse.dy + dy * .5);
  return { zoom: Math.log(best.scale), pan: Math.hypot(best.dx, best.dy) / width, raw, fit: best.error };
}

export function measurePacing(frames: Uint8Array[], width: number, height: number, start: number, fps: number): PacingResult {
  const dt = 1 / fps, steps = frames.length - 1, end = start + steps * dt, time = (index: number) => start + index * dt;
  const change = Array.from({ length: steps }, (_, i) => changed(frames[i], frames[i + 1]));
  const flags: PacingFlag[] = [];

  // Camera motion on the steps that move: a zoom or pan explains the change when it removes most of the difference.
  const camera = change.map((share, i) => {
    if (share < STILL) return null;
    const step = cameraStep(frames[i], frames[i + 1], width, height);
    if (step.fit > step.raw * .6 || step.raw < 1) return null;
    const speed = Math.max(Math.abs(step.zoom), step.pan) * fps;
    return speed >= MOVING ? { ...step, speed } : null;
  });
  const cuts = change.flatMap((share, i) => share >= CUT && !camera[i] ? [i] : []);

  // A flash: one sample far from both neighbours while they match each other.
  for (let i = 1; i < frames.length - 1; i++) if (change[i - 1] >= .3 && change[i] >= .3 && changed(frames[i - 1], frames[i + 1]) <= .1)
    flags.push({ start: round(time(i)), end: round(time(i + 1)), kind: 'flash', reason: `A single-frame flash at ${at(time(i))}: one sample differs from both neighbours by ${Math.round(Math.min(change[i - 1], change[i]) * 100)}%. Remove it or hold it long enough to read.` });

  // Changes: runs of moving steps, each measured by how much of the frame differs from before it to after it.
  const changes: { from: number; to: number; size: number; cells: Set<number> }[] = [];
  for (let i = 0; i < steps;) {
    if (change[i] < STILL) { i++; continue; }
    let j = i; while (j + 1 < steps && change[j + 1] >= STILL) j++;
    changes.push({ from: i, to: j + 1, size: changed(frames[i], frames[j + 1]), cells: places(frames[i], frames[j + 1], width, height) });
    i = j + 1;
  }
  for (const [index, item] of changes.entries()) {
    if (item.size < KEY_CHANGE) continue;
    const next = changes.slice(index + 1).find(other => other.size >= ENDS_HOLD);
    if (!next) continue;
    const hold = (next.from - item.to) * dt;
    if (hold < READABLE_HOLD) flags.push({ start: round(time(item.from)), end: round(time(next.from)), kind: 'short-hold', reason: `${Math.round(item.size * 100)}% of the frame changes by ${at(time(item.to))}, then it holds only ${round(hold, 1)} s before the next change: give each new picture about 1 s to be read.` });
  }
  for (let first = 0; first < changes.length; first++) {
    const big = changes.slice(first).filter(item => item.size >= BUSY_CHANGE && (item.from - changes[first].from) * dt < 1);
    if (changes[first].size >= BUSY_CHANGE && big.length >= BUSY_COUNT) flags.push({ start: round(time(changes[first].from)), end: round(time(big[big.length - 1].to)), kind: 'busy', reason: `${big.length} big changes within 1 s from ${at(time(changes[first].from))}: too many for the eye to follow. Spread them out or combine them into one move.` });
  }

  // Changes in separate places close together: each lands where the last one did not, so the eye has to jump.
  for (let first = 0; first < changes.length; first++) {
    const seen = new Set<number>(), apart: typeof changes = [];
    for (const item of changes.slice(first)) {
      if ((item.from - changes[first].from) * dt >= PLACES_WINDOW) break;
      // A change over most of the frame (a cut, a whole-frame move) is one place, not many.
      if (item.size < ENDS_HOLD || item.cells.size > GRID.columns * GRID.rows / 2 || !item.cells.size) continue;
      if ([...item.cells].every(cell => seen.has(cell))) continue;
      apart.push(item); for (const cell of item.cells) seen.add(cell);
    }
    if (apart.length >= PLACES && apart[0] === changes[first]) flags.push({ start: round(time(changes[first].from)), end: round(time(apart[apart.length - 1].to)), kind: 'scattered', reason: `${apart.length} changes land in different parts of the frame within ${round((apart[apart.length - 1].from - changes[first].from) * dt, 1)} s from ${at(time(changes[first].from))}: the eye follows one place at a time. Stage them one after another, each with time to read.` });
  }

  // Camera moves: their speed should rise from rest and settle back, and stay slow enough to follow.
  let moves = 0;
  for (let i = 0; i < steps;) {
    if (!camera[i]) { i++; continue; }
    let j = i; while (j + 1 < steps && camera[j + 1]) j++;
    const run = camera.slice(i, j + 1).map(step => step!.speed), peak = Math.max(...run), length = j - i + 1;
    const total = camera.slice(i, j + 1).reduce((sum, step) => sum + Math.max(Math.abs(step!.zoom), step!.pan), 0);
    const kind = camera.slice(i, j + 1).some(step => Math.abs(step!.zoom) >= step!.pan) ? 'zoom' : 'pan';
    const span = { start: round(time(i)), end: round(time(j + 1)) };
    moves++;
    if (peak > TOO_FAST) flags.push({ ...span, kind: 'too-fast', reason: `A ${kind} ${kind === 'zoom' ? `of ${Math.round((Math.exp(total) - 1) * 100)}%` : `across ${Math.round(total * 100)}% of the frame`} in ${round(length * dt, 1)} s, peaking at ${Math.round(peak * 100)}% of the frame per second: too fast to follow. Make it longer.` });
    if (length >= 3 && i > 0 && run[0] >= peak * FULL_SPEED) flags.push({ ...span, kind: 'no-ease-in', reason: `The ${kind} at ${at(time(i))} starts at full speed: ease it in (power2.inOut or similar).` });
    const cutAfter = cuts.includes(j + 1);
    if (cutAfter && run[length - 1] >= peak * FULL_SPEED) flags.push({ ...span, kind: 'zoom-cut', reason: `The ${kind} is cut off at full speed by a cut at ${at(time(j + 1))}: let it settle before the cut, or start the next shot on the same motion.` });
    else if (length >= 3 && j + 1 < steps && run[length - 1] >= peak * FULL_SPEED) flags.push({ ...span, kind: 'no-ease-out', reason: `The ${kind} ending at ${at(time(j + 1))} stops dead: ease it out.` });
    for (let k = i; k <= j; k++) {
      const neighbours = [camera[k - 1]?.speed ?? 0, camera[k + 1]?.speed ?? 0];
      if (Math.abs(camera[k]!.zoom) > .15 && Math.max(...neighbours) < camera[k]!.speed * .3) flags.push({ start: round(time(k)), end: round(time(k + 1)), kind: 'jump', reason: `The camera jumps ${Math.round((Math.exp(Math.abs(camera[k]!.zoom)) - 1) * 100)}% in one sample at ${at(time(k))}: animate it over at least 0.4 s.` });
    }
    i = j + 1;
  }

  // Holds where nothing moves at all.
  for (let i = 0; i < steps;) {
    if (change[i] >= STILL) { i++; continue; }
    let j = i; while (j + 1 < steps && change[j + 1] < STILL) j++;
    const length = (j - i + 1) * dt;
    if (length >= LONG_HOLD && i > 0 && j + 1 < steps) flags.push({ start: round(time(i)), end: round(time(j + 1)), kind: 'long-hold', reason: `Nothing moves for ${round(length, 1)} s: right for a line the viewer must read, otherwise trim it or keep a slow move going.` });
    i = j + 1;
  }

  const changePerSecond = Array.from({ length: Math.ceil(steps * dt - 1e-6) }, (_, second) => Math.round(change.slice(Math.round(second * fps), Math.round((second + 1) * fps)).reduce((sum, share) => sum + share, 0) * 100));
  return { start: round(start), end: round(end), fps, samples: frames.length, changePerSecond, cuts: cuts.map(i => round(time(i + 1))), moves, flags: mergeFlags(flags) };
}

/** One flag per kind for overlapping moments, in time order. */
function mergeFlags(flags: PacingFlag[]) {
  const sorted = [...flags].sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind)), merged: PacingFlag[] = [];
  for (const flag of sorted) {
    const same = merged.find(item => item.kind === flag.kind && flag.start <= item.end);
    if (same) same.end = Math.max(same.end, flag.end);
    else merged.push({ ...flag });
  }
  return merged.sort((a, b) => a.start - b.start);
}
