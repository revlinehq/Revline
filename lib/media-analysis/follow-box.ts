// Follows one box through gray frames by normalized cross-correlation against two templates: the last frame's
// patch, which keeps up with an object that turns or flips (consecutive frames barely differ), and an anchor
// built from the first frame and confident matches, which keeps the box from drifting onto the background.
// The search starts where the motion predicts; a lost object is searched for across the whole frame, and only a
// strong, plausible match there moves the box.

export type GrayFrames = { frames: Uint8Array[]; width: number; height: number };
/** Center, scale and rotation (radians) of the box in frame pixels, and how well it matched (correlation, -1..1). */
export type FollowedPose = { x: number; y: number; s: number; a: number; value: number };

const SIZE = 32, COARSE = 16;
/** A frame counts as lost below this match; the whole frame is searched before accepting it. */
const LOST = .45;
/** Matches at least this good refresh the anchor template, and a whole-frame find must reach it to move the box. */
const CONFIDENT = .6;

/** Normalized cross-correlation of a zero-mean, unit-norm template against the frame, sampled through a scaled and rotated grid. */
function score(frame: Uint8Array, width: number, height: number, template: Float32Array, size: number, cx: number, cy: number, w: number, h: number, angle: number) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  let sum = 0, sumSq = 0, cross = 0;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = (i + .5) / size - .5, v = (j + .5) / size - .5, x = cx + u * w * cos - v * h * sin, y = cy + u * w * sin + v * h * cos;
    if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return -1;
    const value = frame[(y | 0) * width + (x | 0)];
    sum += value; sumSq += value * value; cross += value * template[j * size + i];
  }
  const count = size * size, mean = sum / count, variance = sumSq / count - mean * mean;
  return variance < 1 ? 0 : cross / Math.sqrt(variance * count);
}

/** The box's pixels on a size×size grid, zero-mean and unit-norm. */
function sample(frame: Uint8Array, width: number, height: number, size: number, cx: number, cy: number, w: number, h: number, angle: number) {
  const cos = Math.cos(angle), sin = Math.sin(angle), out = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = (i + .5) / size - .5, v = (j + .5) / size - .5;
    const x = Math.min(width - 1, Math.max(0, Math.round(cx + u * w * cos - v * h * sin))), y = Math.min(height - 1, Math.max(0, Math.round(cy + u * w * sin + v * h * cos)));
    out[j * size + i] = frame[y * width + x];
  }
  return normalized(out);
}

function normalized(values: Float32Array) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let norm = 0;
  for (let index = 0; index < values.length; index++) { values[index] -= mean; norm += values[index] ** 2; }
  norm = Math.sqrt(norm) || 1;
  for (let index = 0; index < values.length; index++) values[index] /= norm;
  return values;
}

const blend = (a: Float32Array, b: Float32Array, weight: number) => normalized(a.map((value, index) => value * (1 - weight) + b[index] * weight));
/** A half-resolution copy of a template, for the cheap whole-frame search. */
function halve(template: Float32Array) {
  const out = new Float32Array(COARSE * COARSE);
  for (let j = 0; j < COARSE; j++) for (let i = 0; i < COARSE; i++) out[j * COARSE + i] = template[2 * j * SIZE + 2 * i] + template[2 * j * SIZE + 2 * i + 1] + template[(2 * j + 1) * SIZE + 2 * i] + template[(2 * j + 1) * SIZE + 2 * i + 1];
  return normalized(out);
}

/** Pose of the box in every frame; box is the first frame's box (center and size, frame pixels). A rigid box follows position only. */
export function followBox({ frames, width, height }: GrayFrames, box: { x: number; y: number; w: number; h: number }, rigid: boolean, onFrame?: (index: number) => void): FollowedPose[] {
  const { w: w0, h: h0 } = box;
  const first = sample(frames[0], width, height, SIZE, box.x, box.y, w0, h0, 0);
  let adapted = first, anchor = first, previous = first;
  let cx = box.x, cy = box.y, scale = 1, angle = 0, vx = 0, vy = 0;
  const poses: FollowedPose[] = [{ x: cx, y: cy, s: 1, a: 0, value: 1 }];
  const scales = rigid ? [1] : [.94, .97, 1, 1.03, 1.06], turns = rigid ? [0] : [-6, -3, 0, 3, 6];
  for (let index = 1; index < frames.length; index++) {
    const frame = frames[index], at = (x: number, y: number, s: number, a: number) => Math.max(score(frame, width, height, previous, SIZE, x, y, w0 * s, h0 * s, a), score(frame, width, height, anchor, SIZE, x, y, w0 * s, h0 * s, a));
    // A scale or rotation change must earn its keep: without this, a tiny better match each frame shrinks and spins the box off the object.
    const cost = (s: number, a: number) => .5 * Math.abs(Math.log(s / scale)) + .2 * Math.abs(a - angle);
    const refine = (start: FollowedPose, reach: number, stride: number) => {
      let best = start;
      for (let dy = -reach; dy <= reach; dy += stride) for (let dx = -reach; dx <= reach; dx += stride) { const value = at(start.x + dx, start.y + dy, best.s, best.a); if (value > best.value) best = { ...best, x: start.x + dx, y: start.y + dy, value }; }
      for (const ds of scales) for (const da of turns) for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const s = Math.min(2, Math.max(.5, best.s * ds)), a = best.a + da * Math.PI / 180, value = at(best.x + dx, best.y + dy, s, a);
        if (value - cost(s, a) > best.value - cost(best.s, best.a)) best = { x: best.x + dx, y: best.y + dy, s, a, value };
      }
      return best;
    };
    // Search around where the motion so far says the object went, wider than its own size.
    const px = cx + vx, py = cy + vy, reach = Math.max(10, Math.round(Math.max(w0, h0) * scale * .8));
    let best = refine({ x: px, y: py, s: scale, a: angle, value: at(px, py, scale, angle) }, reach, 2);
    if (best.value < LOST) {
      // Lost: look across the whole frame at a few sizes and turns with a half-resolution anchor, then refine the best
      // spot. Distance from the prediction costs, so a look-alike patch across the frame does not win on a close score.
      const coarse = halve(anchor), diagonal = Math.hypot(width, height);
      let found: FollowedPose | null = null, foundRank = -Infinity;
      for (const s of rigid ? [scale] : [scale * .8, scale, scale * 1.25].map(value => Math.min(2, Math.max(.5, value))))
        for (const a of rigid ? [angle] : [angle - Math.PI / 9, angle, angle + Math.PI / 9])
          for (let y = 0; y < height; y += 4) for (let x = 0; x < width; x += 4) {
            const value = score(frame, width, height, coarse, COARSE, x, y, w0 * s, h0 * s, a), rank = value - .3 * Math.hypot(x - px, y - py) / diagonal;
            if (rank > foundRank) { found = { x, y, s, a, value }; foundRank = rank; }
          }
      if (found) {
        const refined = refine({ ...found, value: at(found.x, found.y, found.s, found.a) }, 4, 1);
        if (refined.value >= CONFIDENT && refined.value > best.value + .08) { best = refined; vx = 0; vy = 0; }
      }
    }
    // A lost frame holds the box where it was instead of letting it wander; its low value says so in the track.
    if (best.value < LOST) best = { x: cx, y: cy, s: scale, a: angle, value: best.value };
    else { vx = .8 * (best.x - cx); vy = .8 * (best.y - cy); }
    ({ x: cx, y: cy, s: scale, a: angle } = best);
    if (best.value >= LOST) {
      const patch = sample(frame, width, height, SIZE, cx, cy, w0 * scale, h0 * scale, angle);
      previous = patch;
      // Confident matches teach the anchor the object's changing look; the first frame stays in the mix so it cannot drift.
      if (best.value >= CONFIDENT) { adapted = blend(adapted, patch, .25); anchor = blend(first, adapted, .65); }
    }
    poses.push(best);
    onFrame?.(index);
  }
  return poses;
}
