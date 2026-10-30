import sharp from 'sharp';
// ImageTracer.js (Unlicense, public domain): bitmap to SVG paths. No types ship with it.
// @ts-expect-error untyped CommonJS module
import imageTracer from 'imagetracerjs';

const ImageTracer = imageTracer as { imagedataToTracedata(image: { width: number; height: number; data: Uint8ClampedArray }, options: Record<string, unknown>): unknown; getsvgstring(trace: unknown, options: Record<string, unknown>): string };

type Rgb = [number, number, number];
export type ShapeTrace = { svg: string; paths: { d: string; fill: string }[]; color: string; background: string; coverage: number; centerline?: { d: string; width: number; length: number } };

/** The longest side traced; a bigger crop is scaled down and its paths scaled back to crop pixels. */
const TRACE_SIDE = 1200, SKELETON_SIDE = 360, MAX_PATH_TEXT = 60_000;
const hex = (rgb: Rgb) => `#${rgb.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (value: string): Rgb => [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16)) as Rgb;
const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; };

/** One shape in a crop: separated from the background around it (the crop's border), traced to filled paths, plus its spine. */
export async function traceShape(crop: Buffer, options: { color?: string; tolerance?: number }): Promise<ShapeTrace & { width: number; height: number }> {
  const { data, info } = await sharp(crop).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info, pixel = (index: number): Rgb => [data[index * 3], data[index * 3 + 1], data[index * 3 + 2]];
  // The background is what the crop's border holds; the shape is the color that stands out from it most.
  const border: Rgb[] = [];
  for (let x = 0; x < width; x++) border.push(pixel(x), pixel((height - 1) * width + x));
  for (let y = 0; y < height; y++) border.push(pixel(y * width), pixel(y * width + width - 1));
  const background = [0, 1, 2].map(channel => median(border.map(rgb => rgb[channel]))) as Rgb;
  let target: Rgb;
  if (options.color) target = fromHex(options.color);
  else {
    const far: Rgb[] = [];
    for (let index = 0; index < width * height; index += 3) { const rgb = pixel(index); if (distance(rgb, background) > 60) far.push(rgb); }
    if (far.length < 20) throw new Error('Nothing in the box stands out from its background. Draw the box around the shape with a little background on each side, or pass its color.');
    target = [0, 1, 2].map(channel => median(far.map(rgb => rgb[channel]))) as Rgb;
  }
  const tolerance = options.tolerance ?? Math.max(40, distance(target, background) * .6);
  // A pixel is the shape when it is nearer the shape's color than the background's, within the tolerance.
  const mask = Buffer.alloc(width * height);
  const sum: Rgb = [0, 0, 0];
  let count = 0;
  for (let index = 0; index < width * height; index++) {
    const rgb = pixel(index), near = distance(rgb, target);
    if (near <= tolerance && near < distance(rgb, background)) { mask[index] = 255; sum[0] += rgb[0]; sum[1] += rgb[1]; sum[2] += rgb[2]; count++; }
  }
  if (count < 20) throw new Error('No pixels in the box match the shape color. Check the color with measureFrame or widen the tolerance.');
  const fill = hex(sum.map(value => value / count) as Rgb);
  // Brush texture and compression noise: a slight blur and threshold smooth the edge before tracing.
  const scale = Math.min(1, TRACE_SIDE / Math.max(width, height)), tw = Math.max(2, Math.round(width * scale)), th = Math.max(2, Math.round(height * scale));
  const smooth = await sharp(mask, { raw: { width, height, channels: 1 } }).resize(tw, th).blur(1.2).threshold(128).extractChannel(0).raw().toBuffer();
  const paths = tracePaths(smooth, tw, th, 1 / scale, fill);
  const centerline = spine(smooth, tw, th, 1 / scale);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill-rule="evenodd">${paths.map(path => `<path fill="${path.fill}" d="${path.d}"/>`).join('')}</svg>`;
  return { width, height, svg, paths, color: fill, background: hex(background), coverage: Math.round(count / (width * height) * 1000) / 1000, ...(centerline ? { centerline } : {}) };
}

/** Filled outlines (with their holes) of the mask, coarser until the markup is a size a scene can carry. */
function tracePaths(mask: Buffer, width: number, height: number, scale: number, fill: string) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) { const value = mask[index] ? 0 : 255; rgba.set([value, value, value, 255], index * 4); }
  for (const detail of [1, 2, 4, 8]) {
    const options = { ltres: detail, qtres: detail, pathomit: 8 * detail, colorsampling: 0, numberofcolors: 2, pal: [{ r: 0, g: 0, b: 0, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }], blurradius: 0, mincolorratio: 0, colorquantcycles: 1, layering: 0, strokewidth: 0, linefilter: true, scale, roundcoords: 1, desc: false, viewbox: false };
    const svg = ImageTracer.getsvgstring(ImageTracer.imagedataToTracedata({ width, height, data: rgba }, options), options);
    const paths = [...svg.matchAll(/<path[^>]*fill="rgb\(0,0,0\)"[^>]*\sd="([^"]+)"/g)].map(found => ({ d: found[1].trim().replace(/\s+/g, ' '), fill }));
    if (paths.reduce((total, path) => total + path.d.length, 0) <= MAX_PATH_TEXT || detail === 8) return paths;
  }
  return [];
}

/** The shape's spine: the longest run through its skeleton, as a smooth open path, with the stroke width that covers it. */
function spine(mask: Buffer, width: number, height: number, scale: number) {
  const k = Math.min(1, SKELETON_SIDE / Math.max(width, height)), w = Math.max(3, Math.round(width * k)), h = Math.max(3, Math.round(height * k));
  const grid = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grid[y * w + x] = mask[Math.min(height - 1, Math.floor(y / k)) * width + Math.min(width - 1, Math.floor(x / k))] ? 1 : 0;
  // Distance to the nearest background pixel (chamfer 3-4), for the stroke width.
  const dist = new Float32Array(w * h).map((_, index) => grid[index] ? 1e9 : 0);
  const pass = (x: number, y: number, steps: [number, number, number][]) => { const index = y * w + x; if (!dist[index]) return; for (const [dx, dy, cost] of steps) { const nx = x + dx, ny = y + dy; dist[index] = Math.min(dist[index], nx < 0 || ny < 0 || nx >= w || ny >= h ? cost : dist[ny * w + nx] + cost); } };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pass(x, y, [[-1, 0, 3], [0, -1, 3], [-1, -1, 4], [1, -1, 4]]);
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) pass(x, y, [[1, 0, 3], [0, 1, 3], [1, 1, 4], [-1, 1, 4]]);
  thin(grid, w, h);
  const points: number[] = [];
  for (let index = 0; index < w * h; index++) if (grid[index]) points.push(index);
  if (points.length < 4) return undefined;
  const around = (index: number) => { const x = index % w, y = Math.floor(index / w), out: number[] = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h && grid[ny * w + nx]) out.push(ny * w + nx); } return out; };
  const farthest = (from: number) => {
    const previous = new Map<number, number>([[from, -1]]), queue = [from];
    let last = from;
    for (let head = 0; head < queue.length; head++) { last = queue[head]; for (const next of around(last)) if (!previous.has(next)) { previous.set(next, last); queue.push(next); } }
    return { last, previous };
  };
  // The skeleton's diameter: the farthest point from anywhere, then the farthest from that.
  const largest = points.reduce((best, index) => dist[index] > dist[best] ? index : best, points[0]);
  const a = farthest(farthest(largest).last).last, { last: b, previous } = farthest(a);
  const run: number[] = [];
  for (let at = b; at !== -1; at = previous.get(at)!) run.push(at);
  if (run.length < 4) return undefined;
  const unit = scale / k, line = simplify(run.map(index => [(index % w + .5) * unit, (Math.floor(index / w) + .5) * unit] as [number, number]), 1.5 * unit);
  const radius = Math.max(...run.map(index => dist[index])) / 3 * unit;
  let length = 0;
  for (let index = 1; index < line.length; index++) length += Math.hypot(line[index][0] - line[index - 1][0], line[index][1] - line[index - 1][1]);
  return { d: smoothPath(line), width: Math.round(radius * 2 + 2 * unit), length: Math.round(length) };
}

/** Zhang-Suen thinning, in place: the mask down to one-pixel lines. */
function thin(grid: Uint8Array, w: number, h: number) {
  for (let changed = true; changed;) {
    changed = false;
    for (const step of [0, 1]) {
      const clear: number[] = [];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const index = y * w + x;
        if (!grid[index]) continue;
        const p = [grid[index - w], grid[index - w + 1], grid[index + 1], grid[index + w + 1], grid[index + w], grid[index + w - 1], grid[index - 1], grid[index - w - 1]];
        const neighbours = p.reduce((total, value) => total + value, 0);
        let transitions = 0;
        for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) transitions++;
        if (neighbours < 2 || neighbours > 6 || transitions !== 1) continue;
        if (step === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
        clear.push(index);
      }
      for (const index of clear) grid[index] = 0;
      if (clear.length) changed = true;
    }
  }
}

/** Ramer-Douglas-Peucker. */
function simplify(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points[points.length - 1]], length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  let worst = 0, at = 0;
  for (let index = 1; index < points.length - 1; index++) {
    const off = Math.abs((b[0] - a[0]) * (a[1] - points[index][1]) - (a[0] - points[index][0]) * (b[1] - a[1])) / length;
    if (off > worst) { worst = off; at = index; }
  }
  return worst <= tolerance ? [a, b] : [...simplify(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(points.slice(at), tolerance)];
}

/** Catmull-Rom through the points, as cubic curves. */
function smoothPath(points: [number, number][]) {
  const r = (value: number) => Math.round(value * 10) / 10;
  let d = `M${r(points[0][0])} ${r(points[0][1])}`;
  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[Math.max(0, index - 1)], p1 = points[index], p2 = points[index + 1], p3 = points[Math.min(points.length - 1, index + 2)];
    d += `C${r(p1[0] + (p2[0] - p0[0]) / 6)} ${r(p1[1] + (p2[1] - p0[1]) / 6)} ${r(p2[0] - (p3[0] - p1[0]) / 6)} ${r(p2[1] - (p3[1] - p1[1]) / 6)} ${r(p2[0])} ${r(p2[1])}`;
  }
  return d;
}
