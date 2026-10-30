import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import opentype from 'opentype.js';
import sharp from 'sharp';
import { AnalysisError } from '@/lib/media-analysis/errors';
import { forEachLimited } from './run-limited';

// Which Google Font a piece of reference type is set in: render the same words in a shortlist of families,
// compare each with the crop by edges, shape, width and stroke weight, then refine the best families over weights and italics.

export type FontCategory = 'serif' | 'sans' | 'mono' | 'handwritten' | 'display';
export type FontMatch = { family: string; weight: number; style: 'normal' | 'italic'; category: FontCategory; score: number };
type Face = { family: string; weight: number; style: 'normal' | 'italic'; category: FontCategory };
type Mask = { data: Float32Array; width: number; height: number };
type Family = { family: string; category: FontCategory; styles: string[] };

const CACHE = join(tmpdir(), 'revline-font-match');
const CATEGORIES: Record<string, FontCategory> = { Serif: 'serif', 'Sans Serif': 'sans', Monospace: 'mono', Handwriting: 'handwritten', Display: 'display' };
/** Families launch films and product sites lean on, kept even when they are not among the most popular. */
const EXTRAS: Record<FontCategory, string[]> = {
  serif: ['Instrument Serif', 'Fraunces', 'Newsreader', 'Young Serif', 'Libre Caslon Text', 'Source Serif 4', 'DM Serif Display', 'Literata', 'Spectral', 'Gelasio', 'Domine', 'Petrona', 'Besley', 'Brygada 1918', 'Bodoni Moda'],
  sans: ['Inter', 'DM Sans', 'Manrope', 'Space Grotesk', 'Plus Jakarta Sans', 'Figtree', 'Outfit', 'Geist', 'Instrument Sans', 'Onest', 'Schibsted Grotesk', 'Bricolage Grotesque', 'Hanken Grotesk', 'Sora'],
  mono: ['JetBrains Mono', 'IBM Plex Mono', 'Space Mono', 'Geist Mono', 'DM Mono', 'Fira Code', 'Martian Mono'],
  handwritten: ['Caveat', 'Caveat Brush', 'Permanent Marker', 'Gochi Hand', 'Rock Salt', 'Kalam', 'Patrick Hand', 'Shadows Into Light', 'Reenie Beanie', 'Covered By Your Grace', 'Nanum Pen Script', 'Just Another Hand', 'Sedgwick Ave', 'Gaegu', 'Itim', 'Coming Soon', 'Nothing You Could Do', 'Kristi', 'Gloria Hallelujah', 'Schoolbell', 'Mansalva', 'Nanum Brush Script', 'Sue Ellen Francisco', 'Short Stack', 'Annie Use Your Telescope', 'Cabin Sketch'],
  display: ['Bebas Neue', 'Anton', 'Archivo Black', 'Abril Fatface', 'Syne', 'Unbounded', 'Righteous', 'Bungee', 'Alfa Slab One', 'Dela Gothic One'],
};
const PER_CATEGORY = 26, REFINE = 6, HEIGHT = 72;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

async function cached(key: string, maxAgeMs: number, load: () => Promise<Buffer>) {
  const path = join(CACHE, key);
  try { if (Date.now() - (await stat(path)).mtimeMs < maxAgeMs) return await readFile(path); } catch { /* not cached yet */ }
  const data = await load();
  await mkdir(CACHE, { recursive: true });
  await writeFile(path, data);
  return data;
}

async function fetchBuffer(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

/** The Google Fonts catalog: every family's category and styles (a week-old copy is fine). */
async function catalog(signal: AbortSignal): Promise<Family[]> {
  const data = await cached('metadata.json', 7 * 86_400_000, () => fetchBuffer('https://fonts.google.com/metadata/fonts', signal));
  const list = (JSON.parse(data.toString('utf8')) as { familyMetadataList: { family: string; category: string; popularity: number; fonts: Record<string, unknown>; subsets: string[] }[] }).familyMetadataList;
  return list.filter(item => CATEGORIES[item.category] && item.subsets.includes('latin')).sort((a, b) => a.popularity - b.popularity).map(item => ({ family: item.family, category: CATEGORIES[item.category], styles: Object.keys(item.fonts) }));
}

function shortlist(families: Family[], categories: FontCategory[]) {
  const picked = new Map<string, Family>();
  for (const category of categories) {
    const inCategory = families.filter(item => item.category === category);
    for (const name of EXTRAS[category]) { const found = families.find(item => item.family === name); if (found) picked.set(name, { ...found, category }); }
    for (const item of inCategory.slice(0, PER_CATEGORY)) picked.set(item.family, item);
  }
  return [...picked.values()];
}

/** One face of a family subset to just the glyphs of the text, as TTF (a few KB). */
async function loadFace(face: Face, text: string, signal: AbortSignal) {
  const glyphs = [...new Set(text.replace(/\s/g, ''))].join('');
  const axis = `${face.style === 'italic' ? 1 : 0},${face.weight}`;
  const key = createHash('sha1').update(`${face.family}|${axis}|${glyphs}`).digest('hex');
  const data = await cached(`${key}.ttf`, 30 * 86_400_000, async () => {
    const css = (await fetchBuffer(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(face.family).replace(/%20/g, '+')}:ital,wght@${axis}&text=${encodeURIComponent(glyphs)}`, signal)).toString('utf8');
    const url = css.match(/src:\s*url\(([^)]+)\)/)?.[1];
    if (!url) throw new Error(`No font file for ${face.family}.`);
    return fetchBuffer(url, signal);
  });
  return opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}

/** The text drawn as SVG path data, lines stacked and aligned, scaled so the ink is about `height` px tall per line. */
function layout(font: opentype.Font, lines: string[], align: 'left' | 'center' | 'right', size: number) {
  const paths = lines.map(line => font.getPath(line, 0, 0, size));
  const boxes = paths.map(path => path.getBoundingBox());
  const widest = Math.max(...boxes.map(box => box.x2 - box.x1));
  let y = 0, d = '';
  boxes.forEach((box, index) => {
    const width = box.x2 - box.x1, x = align === 'left' ? -box.x1 : align === 'right' ? widest - width - box.x1 : (widest - width) / 2 - box.x1;
    const line = font.getPath(lines[index], x, y - box.y1, size);
    d += line.toPathData(2);
    y += (box.y2 - box.y1) + size * .35;
  });
  return { d, width: Math.max(1, Math.ceil(widest)), height: Math.max(1, Math.ceil(y - size * .35)) };
}

async function rasterize(d: string, width: number, height: number, fill = '#000', background = '#fff', pad = 0) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width + pad * 2}" height="${height + pad * 2}"><rect width="100%" height="100%" fill="${background}"/><path transform="translate(${pad} ${pad})" d="${d}" fill="${fill}"/></svg>`;
  return sharp(Buffer.from(svg));
}

/** Ink coverage 0..1 from a gray image of dark-on-light ink. */
async function inkMask(image: ReturnType<typeof sharp>, width: number, height: number): Promise<Mask> {
  const { data } = await image.resize(width, height, { fit: 'fill' }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const mask = new Float32Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = 1 - data[i] / 255;
  return { data: mask, width, height };
}

/** The crop's ink against its background (light or dark type, any colors), trimmed to the type. */
async function referenceInk(crop: Buffer) {
  const { data, info } = await sharp(crop).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info, pixels = width * height;
  const rgb = (i: number) => [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
  // Background: the median of the border pixels.
  const border: number[][] = [];
  for (let x = 0; x < width; x++) border.push(rgb(x), rgb((height - 1) * width + x));
  for (let y = 0; y < height; y++) border.push(rgb(y * width), rgb(y * width + width - 1));
  const median = (channel: number) => border.map(color => color[channel]).sort((a, b) => a - b)[border.length >> 1];
  const background = [median(0), median(1), median(2)];
  const distance = new Float32Array(pixels);
  for (let i = 0; i < pixels; i++) { const [r, g, b] = rgb(i); distance[i] = Math.hypot(r - background[0], g - background[1], b - background[2]); }
  const sorted = Float32Array.from(distance).sort(), strong = sorted[Math.floor(pixels * .995)];
  if (strong < 40) throw new AnalysisError('No type stands out from the background in that crop. Crop tighter around the text.', 400);
  // The ink color: the average of the clearly-ink pixels.
  let inkSum = [0, 0, 0], inkCount = 0;
  const ink = new Float32Array(pixels);
  for (let i = 0; i < pixels; i++) {
    ink[i] = clamp01((distance[i] - strong * .2) / (strong * .5));
    if (distance[i] > strong * .7) { const color = rgb(i); inkSum = inkSum.map((sum, c) => sum + color[c]); inkCount++; }
  }
  // Trim to the rows and columns that hold ink.
  const rows = Array.from({ length: height }, (_, y) => { let sum = 0; for (let x = 0; x < width; x++) sum += ink[y * width + x]; return sum; });
  // Specks of a neighbouring line cut by the crop are not type: keep the runs of inked rows that hold a real share of the ink.
  const runs: { top: number; bottom: number; sum: number }[] = [];
  rows.forEach((value, y) => { if (value <= .6) return; const run = runs.at(-1); if (run && run.bottom === y - 1) { run.bottom = y; run.sum += value; } else runs.push({ top: y, bottom: y, sum: value }); });
  const total = runs.reduce((sum, run) => sum + run.sum, 0), kept = runs.filter(run => run.sum >= total * .04);
  const top = kept[0]?.top ?? -1, bottom = kept.at(-1)?.bottom ?? -1;
  const columns = Array.from({ length: width }, (_, x) => { let sum = 0; for (let y = Math.max(0, top); y <= bottom; y++) sum += ink[y * width + x]; return sum; });
  const left = columns.findIndex(value => value > .6), right = width - 1 - [...columns].reverse().findIndex(value => value > .6);
  if (top < 0 || bottom <= top || right <= left) throw new AnalysisError('No type found in that crop.', 400);
  const box = { left, top, width: right - left + 1, height: bottom - top + 1 };
  const trimmed = new Float32Array(box.width * box.height);
  for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) trimmed[y * box.width + x] = ink[(y + box.top) * width + x + box.left];
  const hex = (color: number[]) => `#${color.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
  return { ink: { data: trimmed, width: box.width, height: box.height }, box, rows: rows.slice(top, bottom + 1), inkColor: hex(inkSum.map(sum => sum / Math.max(1, inkCount))), background: hex(background), cropWidth: width, cropHeight: height };
}

/** Resize a float mask with bilinear sampling. */
function resample(mask: Mask, width: number, height: number): Mask {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(mask.height - 1, (y + .5) * mask.height / height - .5), y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(mask.height - 1, y0 + 1), fy = Math.max(0, sy - y0);
    for (let x = 0; x < width; x++) {
      const sx = Math.min(mask.width - 1, (x + .5) * mask.width / width - .5), x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(mask.width - 1, x0 + 1), fx = Math.max(0, sx - x0);
      const at = (xx: number, yy: number) => mask.data[yy * mask.width + xx];
      out[y * width + x] = (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
    }
  }
  return { data: out, width, height };
}

function blur(mask: Mask, radius: number): Mask {
  const { width, height } = mask, temp = new Float32Array(width * height), out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { let sum = 0, n = 0; for (let k = -radius; k <= radius; k++) { const xx = x + k; if (xx >= 0 && xx < width) { sum += mask.data[y * width + xx]; n++; } } temp[y * width + x] = sum / n; }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { let sum = 0, n = 0; for (let k = -radius; k <= radius; k++) { const yy = y + k; if (yy >= 0 && yy < height) { sum += temp[yy * width + x]; n++; } } out[y * width + x] = sum / n; }
  return { data: out, width, height };
}

/** Sobel gradient magnitude: the outlines of the letters. */
function edges(mask: Mask): Mask {
  const { width, height, data } = mask, out = new Float32Array(width * height);
  const at = (x: number, y: number) => data[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
    const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
    out[y * width + x] = Math.hypot(gx, gy);
  }
  return { data: out, width, height };
}

function correlation(a: Float32Array, b: Float32Array) {
  let sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / a.length, mb = sb / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}
const mean = (mask: Mask) => mask.data.reduce((sum, value) => sum + value, 0) / mask.data.length;

/** How alike two ink masks are, 0..1: outlines (most), filled shape, width for the same words, and stroke weight. */
function similarity(reference: Mask, candidate: Mask) {
  const height = HEIGHT, width = Math.max(8, Math.round(reference.width * height / reference.height));
  const a = resample(reference, width, height), b = resample(candidate, width, height);
  const edge = correlation(blur(edges(a), 2).data, blur(edges(b), 2).data);
  const shape = correlation(blur(a, 2).data, blur(b, 2).data);
  const aspect = Math.exp(-3 * Math.abs(Math.log((reference.width / reference.height) / (candidate.width / candidate.height))));
  const weight = Math.exp(-4 * Math.abs(Math.log(Math.max(.01, mean(a)) / Math.max(.01, mean(b)))));
  return clamp01(.45 * clamp01(edge) + .2 * clamp01(shape) + .2 * aspect + .15 * weight);
}

/** Split the reference into one band per line of text where the rows go empty between them. */
function lineBands(rows: number[], count: number) {
  if (count < 2) return [{ top: 0, bottom: rows.length - 1 }];
  const peak = Math.max(...rows), empty = rows.map(value => value < peak * .02);
  const bands: { top: number; bottom: number }[] = [];
  let start = -1;
  rows.forEach((_, y) => { if (!empty[y] && start < 0) start = y; if ((empty[y] || y === rows.length - 1) && start >= 0) { bands.push({ top: start, bottom: empty[y] ? y - 1 : y }); start = -1; } });
  const kept = bands.filter(band => band.bottom - band.top >= 3);
  return kept.length === count ? kept : undefined;
}

function cut(mask: Mask, top: number, bottom: number): Mask {
  // Trim the band's columns too, so each line compares at its own width.
  const height = bottom - top + 1, columns: number[] = [];
  for (let x = 0; x < mask.width; x++) { let sum = 0; for (let y = top; y <= bottom; y++) sum += mask.data[y * mask.width + x]; columns.push(sum); }
  const left = Math.max(0, columns.findIndex(value => value > .6)), right = mask.width - 1 - Math.max(0, [...columns].reverse().findIndex(value => value > .6));
  const width = Math.max(1, right - left + 1), data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = mask.data[(y + top) * mask.width + x + left];
  return { data, width, height };
}

export async function matchFont(crop: Buffer, text: string, options: { categories?: FontCategory[]; signal: AbortSignal; onProgress?: (percent: number) => void }) {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  if (!lines.length) throw new AnalysisError('Give the text exactly as it reads in the crop.', 400);
  const reference = await referenceInk(crop);
  const bands = lineBands(reference.rows, lines.length);
  const referenceLines = bands ? bands.map(band => cut(reference.ink, band.top, band.bottom)) : [reference.ink];
  const families = shortlist(await catalog(options.signal), options.categories?.length ? options.categories : ['serif', 'sans', 'mono', 'handwritten', 'display']);

  const score = async (face: Face) => {
    const font = await loadFace(face, text, options.signal);
    const parts = bands ? lines.map(line => [line]) : [lines];
    let total = 0;
    for (const [index, part] of parts.entries()) {
      const shape = layout(font, part, 'center', 120);
      const raster = await rasterize(shape.d, shape.width, shape.height);
      const target = referenceLines[index];
      total += similarity(target, await inkMask(raster, Math.max(8, Math.round(shape.width * HEIGHT / shape.height)), HEIGHT));
    }
    return total / parts.length;
  };
  const results: FontMatch[] = [];
  const tryFace = async (face: Face) => {
    try { results.push({ ...face, score: round(await score(face)) }); } catch (error) { if (options.signal.aborted) throw error; }
  };

  // Coarse: every family at its regular weight (or its only style).
  const regular = (family: Family): Face => {
    const weights = family.styles.filter(style => /^\d+$/.test(style)).map(Number);
    const weight = weights.includes(400) ? 400 : weights.sort((a, b) => Math.abs(a - 400) - Math.abs(b - 400))[0];
    return weight ? { family: family.family, weight, style: 'normal', category: family.category } : { family: family.family, weight: Number.parseInt(family.styles[0]) || 400, style: 'italic', category: family.category };
  };
  let done = 0;
  await forEachLimited(families, 8, async family => { await tryFace(regular(family)); options.onProgress?.(10 + 55 * ++done / families.length); });
  if (!results.length) throw new AnalysisError('No candidate fonts could be loaded from Google Fonts.', 502);

  // Fine: the best families over every weight and italic they have.
  const best = [...results].sort((a, b) => b.score - a.score).slice(0, REFINE);
  const faces: Face[] = [];
  for (const match of best) {
    const family = families.find(item => item.family === match.family)!;
    for (const style of family.styles) {
      const italic = style.endsWith('i'), weight = Number.parseInt(style) || 400;
      if (weight < 200 || weight > 900 || (weight === match.weight && (italic ? 'italic' : 'normal') === match.style)) continue;
      faces.push({ family: family.family, weight, style: italic ? 'italic' : 'normal', category: family.category });
    }
  }
  done = 0;
  await forEachLimited(faces, 8, async face => { await tryFace(face); options.onProgress?.(65 + 25 * ++done / Math.max(1, faces.length)); });

  // Top 3 distinct families, each at its best face.
  const top: FontMatch[] = [];
  for (const match of [...results].sort((a, b) => b.score - a.score)) if (!top.some(item => item.family === match.family)) { top.push(match); if (top.length === 3) break; }

  // The proof: the crop, then each candidate drawn with the same words in the crop's ink and background colors, at the type's size and place.
  const tiles = [{ image: crop, label: 'Reference crop' }];
  for (const [index, match] of top.entries()) {
    const font = await loadFace(match, text, options.signal);
    const shape = layout(font, lines, 'center', 120);
    const k = Math.min(reference.box.width / shape.width, reference.box.height / shape.height);
    const width = Math.max(1, Math.round(shape.width * k)), height = Math.max(1, Math.round(shape.height * k));
    const ink = await (await rasterize(shape.d, shape.width, shape.height, reference.inkColor, reference.background)).resize(width, height, { fit: 'fill' }).png().toBuffer();
    const left = Math.round(reference.box.left + (reference.box.width - width) / 2), topEdge = Math.round(reference.box.top + (reference.box.height - height) / 2);
    const image = await sharp({ create: { width: reference.cropWidth, height: reference.cropHeight, channels: 3, background: reference.background } }).composite([{ input: ink, left: Math.max(0, left), top: Math.max(0, topEdge) }]).png().toBuffer();
    tiles.push({ image, label: `${index + 1}  ${match.family} ${match.weight}${match.style === 'italic' ? ' italic' : ''}  ·  ${match.score.toFixed(2)}` });
  }
  return { matches: top, tiles, aspect: reference.cropWidth / reference.cropHeight, inkColor: reference.inkColor, background: reference.background, compared: results.length };
}
