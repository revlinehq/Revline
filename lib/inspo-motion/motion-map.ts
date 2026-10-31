// Inspo Motion: reads how a film moves, not what it shows. From small grayscale frames at a steady rate it separates
// three layers: the camera (what the whole frame does: zoom, pan, tilt, rotate), the elements (what moves against the
// background), and content (what changes in place: text swaps, things appearing, transitions, cuts). Camera moves and
// element moves come back as GSAP keyframes with the measured ease; each camera move names the change it answers.
// The same map is read from a reference video and from our own rendered timeline, so the two can be compared.

import { bestEase, fitMotion, type TrackSample } from '../media-analysis/fit-motion';

type Pose = { scale: number; x: number; y: number; rotation: number };
export type CameraMove = { start: number; end: number; duration: number; kind: string; from: Pose; to: Pose; ease: string; fit: number; gsap: string; cause?: string; flag?: string };
export type MotionTransition = { start: number; end: number; duration: number; kind: 'cut' | 'fade' | 'wipe' | 'transition'; direction?: string; ease?: string; area: number };
export type ElementMove = { start: number; end: number; duration: number; region: Box; kind: string; ease: string; fit: number; gsap: string };
export type ContentChange = { start: number; end: number; kind: 'appear' | 'disappear' | 'change'; region: Box; area: number };
export type MotionMap = {
  start: number; end: number; fps: number;
  camera: CameraMove[]; transitions: MotionTransition[]; elements: ElementMove[]; changes: ContentChange[];
  holds: { start: number; end: number }[];
  /** Content changes the camera did not answer with a move (in a reference: held on purpose; in ours: maybe missed). */
  unanswered: { time: number; what: string }[];
  /** The camera's accumulated pose over the window, a few samples a second. */
  track: (Pose & { time: number })[];
};
/** A region as percent of the frame. */
type Box = { left: number; top: number; width: number; height: number };

const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;
const COLUMNS = 16, BLOCK = 16, SEARCH = 4, TEXTURE = 6, CHANGED = 14, MOVED = .6;

type Frame = Uint8Array;
type Similarity = { a: number; b: number; tx: number; ty: number };
const IDENTITY: Similarity = { a: 1, b: 0, tx: 0, ty: 0 };
const apply = (t: Similarity, x: number, y: number) => ({ x: t.a * x - t.b * y + t.tx, y: t.b * x + t.a * y + t.ty });
/** u then v. */
const compose = (u: Similarity, v: Similarity): Similarity => ({ a: v.a * u.a - v.b * u.b, b: v.b * u.a + v.a * u.b, tx: v.a * u.tx - v.b * u.ty + v.tx, ty: v.b * u.tx + v.a * u.ty + v.ty });
const invert = (t: Similarity): Similarity => { const d = t.a * t.a + t.b * t.b, a = t.a / d, b = -t.b / d; return { a, b, tx: -(a * t.tx - b * t.ty), ty: -(b * t.tx + a * t.ty) }; };
const poseOf = (t: Similarity, width: number, height: number): Pose => ({ scale: round(Math.hypot(t.a, t.b), 3), x: round(t.tx / width * 100, 2), y: round(t.ty / height * 100, 2), rotation: round(Math.atan2(t.b, t.a) * 180 / Math.PI, 2) });

/** Least-squares similarity (scale, rotation, shift) mapping points p to q, refit without outliers. */
function fitSimilarity(points: { px: number; py: number; qx: number; qy: number }[]) {
  let use = points, fit: Similarity = IDENTITY, kept = points.map(() => true);
  for (let pass = 0; pass < 4 && use.length >= 3; pass++) {
    let mpx = 0, mpy = 0, mqx = 0, mqy = 0;
    for (const p of use) { mpx += p.px; mpy += p.py; mqx += p.qx; mqy += p.qy; }
    mpx /= use.length; mpy /= use.length; mqx /= use.length; mqy /= use.length;
    let dot = 0, cross = 0, norm = 0;
    for (const p of use) { const x = p.px - mpx, y = p.py - mpy, u = p.qx - mqx, v = p.qy - mqy; dot += x * u + y * v; cross += x * v - y * u; norm += x * x + y * y; }
    const a = norm ? dot / norm : 1, b = norm ? cross / norm : 0;
    fit = { a, b, tx: mqx - (a * mpx - b * mpy), ty: mqy - (b * mpx + a * mpy) };
    const residual = points.map(p => { const q = apply(fit, p.px, p.py); return Math.hypot(q.x - p.qx, q.y - p.qy); });
    const sorted = residual.filter((_, i) => kept[i]).sort((x, y) => x - y), limit = Math.max(.75, 2.5 * (sorted[Math.floor(sorted.length / 2)] ?? 0));
    kept = residual.map(r => r <= limit);
    use = points.filter((_, i) => kept[i]);
  }
  return { fit, kept, inliers: points.length ? use.length / points.length : 0 };
}

/** The grid every frame is read on: block centers (relative to the frame center) of BLOCK x BLOCK patches. */
function grid(width: number, height: number) {
  const rows = Math.max(3, Math.round(COLUMNS * height / width)), blocks: { col: number; row: number; x: number; y: number }[] = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < COLUMNS; col++) blocks.push({ col, row, x: (col + .5) * width / COLUMNS, y: (row + .5) * height / rows });
  return { rows, blocks };
}

/** Where a block of frame a went in frame b, searched around a predicted position; subpixel by a parabola through the best cost. */
function matchBlock(a: Frame, b: Frame, width: number, height: number, x: number, y: number, guessX: number, guessY: number) {
  const half = BLOCK / 2, ax = Math.round(x - half), ay = Math.round(y - half);
  if (ax < 0 || ay < 0 || ax + BLOCK > width || ay + BLOCK > height) return null;
  const cost = (dx: number, dy: number) => {
    const bx = ax + dx, by = ay + dy;
    if (bx < 0 || by < 0 || bx + BLOCK > width || by + BLOCK > height) return Infinity;
    let sum = 0;
    for (let j = 0; j < BLOCK; j++) { const ra = (ay + j) * width + ax, rb = (by + j) * width + bx; for (let i = 0; i < BLOCK; i++) sum += Math.abs(a[ra + i] - b[rb + i]); }
    return sum / (BLOCK * BLOCK);
  };
  const cx = Math.round(guessX), cy = Math.round(guessY);
  let best = { dx: cx, dy: cy, cost: Infinity };
  for (let dy = cy - SEARCH; dy <= cy + SEARCH; dy++) for (let dx = cx - SEARCH; dx <= cx + SEARCH; dx++) { const c = cost(dx, dy); if (c < best.cost) best = { dx, dy, cost: c }; }
  if (!Number.isFinite(best.cost)) return null;
  const sub = (minus: number, mid: number, plus: number) => { const d = minus - 2 * mid + plus; return Number.isFinite(d) && d > 0 ? Math.max(-.5, Math.min(.5, (minus - plus) / (2 * d))) : 0; };
  return { dx: best.dx + sub(cost(best.dx - 1, best.dy), best.cost, cost(best.dx + 1, best.dy)), dy: best.dy + sub(cost(best.dx, best.dy - 1), best.cost, cost(best.dx, best.dy + 1)), cost: best.cost };
}

/** How much texture a block has (mean absolute deviation): flat blocks say nothing about the camera. */
function texture(frame: Frame, width: number, x: number, y: number) {
  const ax = Math.round(x - BLOCK / 2), ay = Math.round(y - BLOCK / 2);
  let sum = 0;
  for (let j = 0; j < BLOCK; j++) for (let i = 0; i < BLOCK; i++) sum += frame[(ay + j) * width + ax + i];
  const mean = sum / (BLOCK * BLOCK);
  let dev = 0;
  for (let j = 0; j < BLOCK; j++) for (let i = 0; i < BLOCK; i++) dev += Math.abs(frame[(ay + j) * width + ax + i] - mean);
  return dev / (BLOCK * BLOCK);
}

/** Read how a window moves. frames are grayscale (width x height), sampled at fps from `start` seconds. */
export function mapMotion(frames: Frame[], width: number, height: number, start: number, fps: number): MotionMap {
  const { rows, blocks } = grid(width, height), cx = width / 2, cy = height / 2, n = frames.length;
  const at = (index: number) => round(start + index / fps, 2);
  const textures = frames.map(frame => blocks.map(block => texture(frame, width, block.x, block.y)));

  // 1. Camera: register every frame against an anchor frame, so slow drifts add up to measurable shifts.
  //    The anchor moves on when too little of it is still matched (things changed, or it left the frame).
  const cumulative: Similarity[] = [IDENTITY];
  let anchor = 0, fromAnchor = IDENTITY, velocity = IDENTITY;
  for (let t = 1; t < n; t++) {
    const predicted = compose(fromAnchor, velocity), points: { px: number; py: number; qx: number; qy: number }[] = [];
    blocks.forEach((block, i) => {
      if (textures[anchor][i] < TEXTURE) return;
      const px = block.x - cx, py = block.y - cy, guess = apply(predicted, px, py);
      const match = matchBlock(frames[anchor], frames[t], width, height, block.x, block.y, guess.x - px, guess.y - py);
      if (match && match.cost < CHANGED * 1.5) points.push({ px, py, qx: px + match.dx, qy: py + match.dy });
    });
    const solved = points.length >= 6 ? fitSimilarity(points) : null;
    // The camera moves the whole view: agreeing blocks bunched in one region are an element (a growing pill, typing text), not the camera.
    const agreeing = solved ? points.filter((_, i) => solved.kept[i]) : [];
    const spread = (pick: (p: typeof points[number]) => number, span: number) => agreeing.length ? (Math.max(...agreeing.map(pick)) - Math.min(...agreeing.map(pick))) / span : 0;
    const wide = agreeing.length >= 8 && (spread(p => p.px, width) >= .5 || spread(p => p.py, height) >= .5);
    let step = solved && solved.inliers >= .35 && wide ? solved.fit : null;
    // A real camera does not jump: one frame of more than 1.5 degrees, 6% zoom or 8% shift is a misread (dither, pixel reveals).
    if (step) {
      const jump = compose(invert(cumulative[t - 1]), compose(cumulative[anchor], step));
      if (Math.abs(Math.atan2(jump.b, jump.a)) > 1.5 * Math.PI / 180 || Math.abs(Math.log(Math.hypot(jump.a, jump.b))) > .06 || Math.hypot(jump.tx / width, jump.ty / height) > .08) step = null;
    }
    const next = step ? compose(cumulative[anchor], step) : cumulative[t - 1];
    velocity = step ? compose(invert(fromAnchor), step) : IDENTITY;
    if (step) fromAnchor = step;
    cumulative.push(next);
    // A new anchor once the match thins out or the view has moved a lot (blocks would leave the search range).
    if (!step || solved!.inliers < .6 || Math.abs(Math.hypot(step.a, step.b) - 1) > .12 || Math.hypot(step.tx, step.ty) > width * .15) { anchor = t; fromAnchor = IDENTITY; }
  }

  // 2. Each step: blocks that moved against the camera (elements) and blocks that changed in place (content).
  type Step = { moved: { i: number; dx: number; dy: number }[]; changed: number[]; changedShare: number; meanCost: number };
  const steps: Step[] = [];
  for (let t = 0; t < n - 1; t++) {
    const camera = compose(invert(cumulative[t]), cumulative[t + 1]), moved: Step['moved'] = [], changed: number[] = [];
    let total = 0, counted = 0;
    blocks.forEach((block, i) => {
      const px = block.x - cx, py = block.y - cy, q = apply(camera, px, py);
      const match = matchBlock(frames[t], frames[t + 1], width, height, block.x, block.y, q.x - px, q.y - py);
      if (!match) return;
      total += match.cost; counted++;
      const rx = match.dx - (q.x - px), ry = match.dy - (q.y - py);
      if (match.cost > CHANGED) changed.push(i);
      else if (Math.hypot(rx, ry) > MOVED && Math.max(textures[t][i], textures[t + 1][i]) >= TEXTURE) moved.push({ i, dx: rx, dy: ry });
    });
    steps.push({ moved, changed, changedShare: changed.length / blocks.length, meanCost: counted ? total / counted : 0 });
  }

  const boxOf = (indices: number[]): Box => {
    const cols = indices.map(i => blocks[i].col), rws = indices.map(i => blocks[i].row);
    const left = Math.min(...cols) / COLUMNS, top = Math.min(...rws) / rows, right = (Math.max(...cols) + 1) / COLUMNS, bottom = (Math.max(...rws) + 1) / rows;
    return { left: round(left * 100, 1), top: round(top * 100, 1), width: round((right - left) * 100, 1), height: round((bottom - top) * 100, 1) };
  };
  const where = (box: Box) => `${box.top + box.height / 2 < 34 ? 'top' : box.top + box.height / 2 > 66 ? 'bottom' : 'middle'}${box.left + box.width / 2 < 34 ? ' left' : box.left + box.width / 2 > 66 ? ' right' : ''}`;

  // 3. Transitions: most of the frame changes in place. One step is a cut; a run is a fade, a wipe or another transition.
  const transitions: MotionTransition[] = [];
  for (let t = 0; t < steps.length; t++) {
    if (steps[t].changedShare < .45) continue;
    let last = t; while (last + 1 < steps.length && steps[last + 1].changedShare >= .2) last++;
    const run = steps.slice(t, last + 1), area = round(Math.max(...run.map(s => s.changedShare)) * 100, 0);
    if (run.length === 1) transitions.push({ start: at(t), end: at(t + 1), duration: round(1 / fps, 3), kind: 'cut', area });
    else {
      // A wipe's changing band travels across the frame; a fade changes everything a little at once.
      const centers = run.map(s => { const cols = s.changed.map(i => blocks[i].col), rws = s.changed.map(i => blocks[i].row); return { x: cols.reduce((a, b) => a + b, 0) / Math.max(1, cols.length) / COLUMNS, y: rws.reduce((a, b) => a + b, 0) / Math.max(1, rws.length) / rows }; });
      const travelX = centers[centers.length - 1].x - centers[0].x, travelY = centers[centers.length - 1].y - centers[0].y;
      const spread = run.reduce((sum, s) => sum + s.changedShare, 0) / run.length;
      const kind = Math.max(Math.abs(travelX), Math.abs(travelY)) > .3 ? 'wipe' : spread > .7 ? 'fade' : 'transition';
      const direction = kind === 'wipe' ? (Math.abs(travelX) > Math.abs(travelY) ? (travelX > 0 ? 'left to right' : 'right to left') : (travelY > 0 ? 'top to bottom' : 'bottom to top')) : undefined;
      // Progress through the transition as the share of its total in-place change done so far.
      const total = run.reduce((sum, s) => sum + s.meanCost, 0);
      let done = 0;
      const points = run.map((s, k) => { done += s.meanCost; return { u: (k + 1) / run.length, p: total ? done / total : (k + 1) / run.length }; });
      transitions.push({ start: at(t), end: at(last + 1), duration: round((last + 1 - t) / fps, 2), kind, ...(direction ? { direction } : {}), ease: bestEase([{ u: 0, p: 0 }, ...points]).name, area });
    }
    t = last;
  }
  const inTransition = (t: number) => transitions.some(tr => at(t) >= tr.start - .01 && at(t) < tr.end + .01);

  // 4. Content changes: connected regions that change in place outside transitions, merged while they overlap.
  const changes: (ContentChange & { first: number; last: number; cells: Set<number> })[] = [];
  const neighbours = (i: number) => { const { col, row } = blocks[i]; return [col > 0 ? i - 1 : -1, col < COLUMNS - 1 ? i + 1 : -1, row > 0 ? i - COLUMNS : -1, row < rows - 1 ? i + COLUMNS : -1, col > 0 && row > 0 ? i - COLUMNS - 1 : -1, col < COLUMNS - 1 && row < rows - 1 ? i + COLUMNS + 1 : -1].filter(j => j >= 0); };
  const components = (cells: number[]) => {
    const left = new Set(cells), groups: number[][] = [];
    for (const cell of cells) {
      if (!left.has(cell)) continue;
      const group: number[] = [], queue = [cell]; left.delete(cell);
      while (queue.length) { const c = queue.pop()!; group.push(c); for (const j of neighbours(c)) if (left.has(j)) { left.delete(j); queue.push(j); } }
      groups.push(group);
    }
    return groups;
  };
  for (let t = 0; t < steps.length; t++) {
    if (inTransition(t)) continue;
    for (const group of components(steps[t].changed)) {
      if (group.length < 1) continue;
      const open = changes.find(change => change.last >= t - 2 && group.some(cell => change.cells.has(cell) || neighbours(cell).some(j => change.cells.has(j))));
      if (open) { group.forEach(cell => open.cells.add(cell)); open.last = t; }
      else changes.push({ start: 0, end: 0, kind: 'change', region: boxOf(group), area: 0, first: t, last: t, cells: new Set(group) });
    }
  }
  const contentChanges: ContentChange[] = changes.map(change => {
    const cells = [...change.cells], before = cells.reduce((s, i) => s + textures[change.first][i], 0) / cells.length, after = cells.reduce((s, i) => s + textures[Math.min(n - 1, change.last + 1)][i], 0) / cells.length;
    const kind: ContentChange['kind'] = before < TEXTURE && after >= TEXTURE * 1.5 ? 'appear' : after < TEXTURE && before >= TEXTURE * 1.5 ? 'disappear' : 'change';
    return { start: at(change.first), end: at(change.last + 1), kind, region: boxOf(cells), area: round(cells.length / blocks.length * 100, 1) };
  }).filter(change => change.area >= 1 || change.end - change.start >= .2);

  // 5. Elements: regions that move against the background, followed step to step and fitted as GSAP tweens.
  type Track = { cells: Set<number>; samples: TrackSample[]; x: number; y: number; last: number; region: number[] };
  const tracks: Track[] = [];
  for (let t = 0; t < steps.length; t++) {
    const byCell = new Map(steps[t].moved.map(m => [m.i, m]));
    for (const group of components([...byCell.keys()])) {
      if (group.length < 2) continue;
      const dx = group.reduce((s, i) => s + byCell.get(i)!.dx, 0) / group.length, dy = group.reduce((s, i) => s + byCell.get(i)!.dy, 0) / group.length;
      // Scale of the group: how its blocks spread apart or together around their center.
      const mx = group.reduce((s, i) => s + blocks[i].x, 0) / group.length, my = group.reduce((s, i) => s + blocks[i].y, 0) / group.length;
      const spread = group.length >= 4 ? fitSimilarity(group.map(i => ({ px: blocks[i].x - mx, py: blocks[i].y - my, qx: blocks[i].x - mx + byCell.get(i)!.dx, qy: blocks[i].y - my + byCell.get(i)!.dy }))).fit : IDENTITY;
      const track = tracks.find(tr => tr.last === t - 1 && group.some(cell => tr.cells.has(cell) || neighbours(cell).some(j => tr.cells.has(j))));
      const target = track ?? { cells: new Set<number>(), samples: [], x: 0, y: 0, last: t, region: group };
      if (!track) { tracks.push(target); target.samples.push({ time: at(t), x: 0, y: 0, w: 0, h: 0, scale: 1, rotation: 0, confidence: 1 }); }
      const previous = target.samples[target.samples.length - 1];
      target.x += dx / width * 100; target.y += dy / height * 100;
      target.samples.push({ time: at(t + 1), x: round(target.x, 2), y: round(target.y, 2), w: 0, h: 0, scale: round(previous.scale * Math.hypot(spread.a, spread.b), 3), rotation: round(previous.rotation + Math.atan2(spread.b, spread.a) * 180 / Math.PI, 1), confidence: 1 });
      target.cells = new Set(group); target.last = t; target.region = [...new Set([...target.region, ...group])];
    }
  }
  const elements: ElementMove[] = tracks.flatMap(track => fitMotion(track.samples, { width: 100, height: 100 }).filter(move => move.duration >= .1).map(move => {
    const dx = move.to.x - move.from.x, dy = move.to.y - move.from.y, ds = move.to.scale - move.from.scale;
    const kind = Math.abs(ds) > .08 && Math.abs(ds) * 50 > Math.hypot(dx, dy) ? (ds > 0 ? 'scales up' : 'scales down') : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'slides right' : 'slides left') : (dy > 0 ? 'slides down' : 'slides up');
    const fields = (p: { x: number; y: number; scale: number }) => `xPercent: ${round(p.x, 1)}, yPercent: ${round(p.y, 1)}${ds ? `, scale: ${p.scale}` : ''}`;
    return { start: move.start, end: move.end, duration: move.duration, region: boxOf(track.region), kind: `${kind} (${round(Math.hypot(dx, dy), 1)}% of the frame)`, ease: move.ease, fit: move.fit, gsap: `tl.fromTo(el, { ${fields({ ...move.from, x: 0, y: 0 })} }, { ${fields({ ...move.to, x: dx, y: dy })}, duration: ${move.duration}, ease: '${move.ease}' }, ${move.start})` };
  })).sort((a, b) => a.start - b.start);

  // 6. Camera moves: where the accumulated pose changes, split where its speed jumps (a slow drift that bursts at a change).
  const poses = cumulative.map(t => ({ ls: Math.log(Math.hypot(t.a, t.b)), x: t.tx / width, y: t.ty / height, r: Math.atan2(t.b, t.a) }));
  const smooth = poses.map((_, i) => { const window = poses.slice(Math.max(0, i - 2), i + 3); return { ls: window.reduce((s, p) => s + p.ls, 0) / window.length, x: window.reduce((s, p) => s + p.x, 0) / window.length, y: window.reduce((s, p) => s + p.y, 0) / window.length, r: window.reduce((s, p) => s + p.r, 0) / window.length }; });
  const distance = (a: typeof smooth[number], b: typeof smooth[number]) => Math.abs(b.ls - a.ls) + Math.hypot(b.x - a.x, b.y - a.y) + Math.abs(b.r - a.r) / (Math.PI / 2);
  const speed = smooth.slice(1).map((pose, i) => distance(smooth[i], pose) * fps);
  // Cuts reset the camera: never one move across a cut.
  const cutAt = new Set(transitions.filter(tr => tr.kind === 'cut').map(tr => Math.round((tr.start - start) * fps)));
  const FLOOR = .008;
  const runs: [number, number][] = [];
  for (let i = 0; i < speed.length; i++) {
    if (speed[i] < FLOOR || cutAt.has(i)) continue;
    let last = i; while (last + 1 < speed.length && !cutAt.has(last + 1) && (speed[last + 1] >= FLOOR || (last + 3 < speed.length && speed[last + 2] >= FLOOR))) last++;
    // Split a run where it bursts to several times its own resting speed (and where it falls back).
    const inside = speed.slice(i, last + 1), median = [...inside].sort((a, b) => a - b)[Math.floor(inside.length / 2)];
    let from = i;
    for (let k = i + 1; k <= last; k++) {
      const fast = (j: number) => speed[j] > median * 3 && speed[j] > .05;
      if (fast(k) !== fast(k - 1) && k - from >= Math.max(3, fps * .1)) { runs.push([from, k]); from = k; }
    }
    runs.push([from, last + 1]);
    i = last;
  }
  const camera: CameraMove[] = [];
  for (const [a, b] of runs) {
    const total = distance(smooth[a], smooth[b]);
    if (total < .005 || (b - a) / fps < .1) continue;
    const points = Array.from({ length: b - a + 1 }, (_, k) => ({ u: k / (b - a), p: Math.max(-.2, Math.min(1.2, 1 - distance(smooth[a + k], smooth[b]) / total)) }));
    const named = bestEase(points), custom = named.error > .08 ? customCurve(points) : null;
    const from = poseOf(cumulative[a], width, height), to = poseOf(cumulative[b], width, height), duration = round((b - a) / fps, 2);
    const dz = Math.log(to.scale / from.scale), dx = to.x - from.x, dy = to.y - from.y, dr = to.rotation - from.rotation;
    // Named the way the camera turns: the picture slides the other way (picture moving down = the camera tilting up).
    const parts = [Math.abs(dz) > .01 ? (dz > 0 ? `zoom in ${Math.round((Math.exp(dz) - 1) * 100)}%` : `zoom out ${Math.round((1 - Math.exp(dz)) * 100)}%`) : '', Math.abs(dx) > .8 ? `pan ${dx > 0 ? 'left' : 'right'} ${Math.abs(round(dx, 1))}%` : '', Math.abs(dy) > .8 ? `tilt ${dy > 0 ? 'up' : 'down'} ${Math.abs(round(dy, 1))}%` : '', Math.abs(dr) > .5 ? `rotate ${round(dr, 1)}°` : ''].filter(Boolean);
    const ease = custom ? `CustomEase.create("measured", "M0,0 C${custom[0]},${custom[1]} ${custom[2]},${custom[3]} 1,1")` : named.name;
    const pose = (p: Pose) => `scale: ${p.scale}, xPercent: ${p.x}, yPercent: ${p.y}${from.rotation !== to.rotation ? `, rotation: ${p.rotation}` : ''}`;
    camera.push({ start: at(a), end: at(b), duration, kind: parts.join(' + ') || 'drift', from, to, ease: custom ? `custom (closest named: ${named.name})` : named.name, fit: round(Math.max(0, 1 - Math.min(named.error, custom?.[4] ?? 1)), 2), gsap: `tl.fromTo(camera, { ${pose(from)} }, { ${pose(to)}, duration: ${duration}, ease: ${custom ? ease : `'${ease}'`} }, ${at(a)})` });
  }

  // 7. Causes: what each camera move answers. A move starts with a change, or lands on one.
  const events = [
    ...contentChanges.filter(c => c.area >= 2).map(c => ({ time: c.start, what: `${c.kind === 'appear' ? 'something appears' : c.kind === 'disappear' ? 'something disappears' : 'content changes'} (${where(c.region)}, ${c.area}% of the frame)` })),
    ...transitions.map(t => ({ time: t.start, what: t.kind === 'cut' ? 'a cut' : `a ${t.kind}${t.direction ? ` ${t.direction}` : ''}` })),
    ...elements.filter(e => e.duration >= .15).map(e => ({ time: e.start, what: `an element ${e.kind.split(' (')[0]} (${where(e.region)})` })),
  ].sort((a, b) => a.time - b.time);
  for (const move of camera) {
    const starts = events.filter(e => e.time >= move.start - .5 && e.time <= move.start + .25).sort((a, b) => Math.abs(a.time - move.start) - Math.abs(b.time - move.start))[0];
    const lands = events.filter(e => e.time >= move.end - .35 && e.time <= move.end + .15)[0];
    if (starts) move.cause = `starts with ${starts.what} at ${starts.time}s`;
    else if (lands) move.cause = `lands on ${lands.what} at ${lands.time}s`;
    else if (move.duration < 1.2) move.flag = 'no cause: nothing changes in the frame when this move starts or ends';
  }
  const unanswered = events.filter(e => e.what.startsWith('something') || e.what.startsWith('content') || e.what.startsWith('a cut') ? !camera.some(m => e.time >= m.start - .5 && e.time <= m.end + .3) : false).slice(0, 20);

  // 8. Holds: a second or more where neither the camera nor anything in the frame moves.
  const holds: { start: number; end: number }[] = [];
  for (let i = 0; i < steps.length; i++) {
    const still = (k: number) => speed[k] < FLOOR && !steps[k].changed.length && !steps[k].moved.length;
    if (!still(i)) continue;
    let last = i; while (last + 1 < steps.length && still(last + 1)) last++;
    if ((last + 1 - i) / fps >= 1) holds.push({ start: at(i), end: at(last + 1) });
    i = last;
  }

  const every = Math.max(1, Math.round(fps / 4));
  return {
    start: round(start, 2), end: at(n - 1), fps,
    camera, transitions, elements: elements.slice(0, 40), changes: contentChanges.slice(0, 40), holds, unanswered,
    track: cumulative.flatMap((t, i) => i % every === 0 || i === n - 1 ? [{ time: at(i), ...poseOf(t, width, height) }] : []),
  };
}

/** The cubic bezier (x1, y1, x2, y2) closest to measured progress, when no named ease fits; the fifth value is its error. */
function customCurve(points: { u: number; p: number }[]) {
  const bezier = (x1: number, y1: number, x2: number, y2: number) => (x: number) => {
    let t = x;
    for (let k = 0; k < 6; k++) { const xt = 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3 - x, d = 3 * (1 - t) ** 2 * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2); if (Math.abs(d) < 1e-6) break; t = Math.max(0, Math.min(1, t - xt / d)); }
    return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3;
  };
  let best = [0, 0, 1, 1, Infinity];
  for (let x1 = 0; x1 <= 1; x1 += .1) for (let x2 = 0; x2 <= 1; x2 += .1) for (let y1 = -.4; y1 <= 1.6; y1 += .2) for (let y2 = -.4; y2 <= 1.6; y2 += .2) {
    const f = bezier(x1, y1, x2, y2), error = Math.sqrt(points.reduce((s, p) => s + (f(p.u) - p.p) ** 2, 0) / points.length);
    if (error < best[4]) best = [x1, y1, x2, y2, error];
  }
  return best.map((v, i) => i < 4 ? round(v, 2) : v);
}


export type MotionDifference = { time: number; issue: string; fix?: string };
const easeParts = (ease: string) => { const name = ease.replace(/^custom \(closest named: (.*)\)$/, '$1'), [family, way = 'none'] = name.split('.'); return { family: family.replace(/\(.*$/, ''), way: way.replace(/\(.*$/, '') }; };
const zoomOf = (move: CameraMove) => Math.log(move.to.scale / move.from.scale);
const panOf = (move: CameraMove) => ({ x: move.to.x - move.from.x, y: move.to.y - move.from.y });
const size = (move: CameraMove) => Math.abs(zoomOf(move)) + Math.hypot(panOf(move).x, panOf(move).y) / 100;
/** What a move mostly does, so a zoom is only compared with a zoom and a pan with a pan the same way. */
const gist = (move: CameraMove) => { const zoom = zoomOf(move), { x, y } = panOf(move); return Math.abs(zoom) * 100 >= Math.hypot(x, y) ? (zoom > 0 ? 'in' : 'out') : Math.abs(x) >= Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up'); };

/** Where our film moves differently from the reference over the same stretch: missing or extra camera moves, a different
 *  ease, timing or amount, a missing or different transition, and moves where the reference holds still. ours.start lines up
 *  with reference.start. */
export function compareMotion(reference: MotionMap, ours: MotionMap): MotionDifference[] {
  const offset = ours.start - reference.start, shift = (time: number) => round(time + offset, 2), found: MotionDifference[] = [];
  const shifted = (move: CameraMove) => move.gsap.replace(/, ([\d.]+)\)$/, (_, time) => `, ${shift(Number(time))})`);
  const used = new Set<CameraMove>();
  for (const move of reference.camera.filter(m => size(m) >= .015)) {
    const start = shift(move.start), end = shift(move.end);
    const match = ours.camera.filter(o => !used.has(o) && o.end >= start - .3 && o.start <= end + .3 && gist(o) === gist(move) && size(o) >= .005).sort((a, b) => Math.abs(a.start - start) - Math.abs(b.start - start))[0];
    const why = move.cause ? `, it ${move.cause}` : '';
    if (!match) { found.push({ time: start, issue: `The reference camera moves here (${move.kind}, ${move.duration}s, ${move.ease}${why}); yours does not.`, fix: shifted(move) }); continue; }
    used.add(match);
    const r = easeParts(move.ease), o = easeParts(match.ease), notes: string[] = [];
    if (r.way !== o.way || r.family !== o.family) notes.push(`ease ${match.ease} where the reference uses ${move.ease}`);
    if (Math.abs(match.start - start) > .15) notes.push(`starts ${round(match.start - start, 2) > 0 ? `${round(match.start - start, 2)}s late` : `${round(start - match.start, 2)}s early`}`);
    const ratio = size(match) / size(move);
    if (ratio < .6 || ratio > 1.6) notes.push(`${ratio < 1 ? 'smaller' : 'bigger'} (${match.kind} vs ${move.kind})`);
    if (match.duration / move.duration < .65 || match.duration / move.duration > 1.5) notes.push(`${match.duration}s long vs ${move.duration}s`);
    if (notes.length) found.push({ time: match.start, issue: `Camera move differs from the reference: ${notes.join('; ')}.`, fix: shifted(move) });
  }
  for (const move of ours.camera.filter(m => !used.has(m) && size(m) >= .02)) {
    const held = reference.holds.some(h => shift(h.start) <= move.start + .2 && shift(h.end) >= move.end - .2);
    if (held || move.flag) found.push({ time: move.start, issue: `Your camera moves (${move.kind}, ${move.duration}s) ${held ? 'where the reference holds still' : 'where the reference does not move'}${move.flag ? `; ${move.flag}` : ''}.` });
  }
  for (const transition of reference.transitions) {
    const start = shift(transition.start), match = ours.transitions.find(o => Math.abs(o.start - start) <= .3);
    if (!match) found.push({ time: start, issue: `The reference has a ${transition.kind}${transition.direction ? ` ${transition.direction}` : ''} here (${transition.duration}s${transition.ease ? `, ${transition.ease}` : ''}); yours has none.` });
    else if (match.kind !== transition.kind || Math.abs(match.duration - transition.duration) > Math.max(.1, transition.duration * .5)) found.push({ time: match.start, issue: `Transition differs: yours is a ${match.kind} of ${match.duration}s, the reference a ${transition.kind}${transition.direction ? ` ${transition.direction}` : ''} of ${transition.duration}s.` });
  }
  for (const transition of ours.transitions) if (!reference.transitions.some(r => Math.abs(shift(r.start) - transition.start) <= .3)) found.push({ time: transition.start, issue: `Your film has a ${transition.kind} here that the reference does not.` });
  return found.sort((a, b) => a.time - b.time).slice(0, 30);
}
