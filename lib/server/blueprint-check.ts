import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { sceneRuntimeNames, SCENE_RUNTIME_BUNDLES } from '../editor/scene-modules';
import sharp from 'sharp';
import type { MediaTaskResult, MediaWorkItem } from '@/convex/mediaTasks';
import { AnalysisError } from '@/lib/media-analysis/errors';

type Work = NonNullable<MediaWorkItem['blueprint']>;
type Result = NonNullable<MediaTaskResult['blueprint']>;
export type Pixels = { data: Buffer; width: number; height: number };

/** A pixel "matches" when its luminance difference is at most this (of 255): invisible at a glance. */
const TOLERANCE = 24;
const hex = (pixels: Pixels, x: number, y: number) => { const i = (y * pixels.width + x) * 3; return '#' + [0, 1, 2].map(c => pixels.data[i + c].toString(16).padStart(2, '0')).join(''); };

async function download(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new AnalysisError(`A kit file could not be downloaded (${response.status}).`, 502);
  return { type: response.headers.get('content-type') ?? 'application/octet-stream', data: Buffer.from(await response.arrayBuffer()) };
}
const pixelsOf = async (image: Buffer, width?: number, height?: number): Promise<Pixels> => {
  const { data, info } = await sharp(image).removeAlpha().resize(width && height ? { width, height, fit: 'fill' } : undefined).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

/** Exact colors at points, and where the color changes along lines (anti-aliased runs merged into one edge). */
export function measure(screen: Pixels, work: Pick<Work, 'points' | 'lines'>): Pick<Result, 'colors' | 'edges'> {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < screen.width && y < screen.height;
  const colors = (work.points ?? []).filter(point => inside(Math.round(point.x), Math.round(point.y))).map(point => ({ x: Math.round(point.x), y: Math.round(point.y), hex: hex(screen, Math.round(point.x), Math.round(point.y)), ...(point.label ? { label: point.label } : {}) }));
  const edges = (work.lines ?? []).map(line => {
    const at = Math.round(line.at), from = Math.max(0, Math.round(Math.min(line.from, line.to))), to = Math.round(Math.max(line.from, line.to));
    // axis 'y' is a row (y = at, walking along x); axis 'x' is a column (x = at, walking along y).
    const end = Math.min(to, (line.axis === 'y' ? screen.width : screen.height) - 1);
    const read = (position: number) => line.axis === 'y' ? [position, at] as const : [at, position] as const;
    const changes: { at: number; before: string; after: string }[] = [];
    let previous = hex(screen, ...read(from)), run: { at: number; before: string } | null = null;
    for (let position = from + 1; position <= end && inside(...read(position)); position++) {
      const color = hex(screen, ...read(position));
      const delta = [1, 3, 5].reduce((sum, offset) => sum + Math.abs(parseInt(color.slice(offset, offset + 2), 16) - parseInt(previous.slice(offset, offset + 2), 16)), 0);
      if (delta > 12) run ??= { at: position, before: previous };
      else if (run) { changes.push({ at: run.at, before: run.before, after: color }); run = null; }
      previous = color;
      if (changes.length >= 80) break;
    }
    if (run && changes.length < 80) changes.push({ at: run.at, before: run.before, after: previous });
    return { axis: line.axis, at, from, to: end, ...(line.label ? { label: line.label } : {}), changes };
  });
  return { colors, edges };
}

/** Runs the scene code in the editor's own sandbox at an exact size; returns the frame and every data-part's box. */
async function render(work: Work, signal: AbortSignal) {
  if (!work.code) throw new AnalysisError('There is no code to render.', 400);
  const vendor = join(process.cwd(), 'public/vendor');
  const scripts = await Promise.all(sceneRuntimeNames({ code: work.code }).map(async name => {
    const code = await readFile(join(vendor, SCENE_RUNTIME_BUNDLES[name].file), 'utf8');
    return `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`;
  }));
  const allIcons = JSON.parse(await readFile(join(vendor, 'lucide-icons.json'), 'utf8')) as Record<string, string>;
  const icons = Object.fromEntries([...work.code.matchAll(/['"`]([a-z0-9]+(?:-[a-z0-9]+)*)['"`]/g)].map(match => match[1]).filter(name => allIcons[name] !== undefined).map(name => [name, allIcons[name]]));
  const brand = work.brand as { fonts?: { family: string; weight: string; url: string }[]; screens?: { name: string; url: string }[] } | null;
  const fonts = await Promise.all((brand?.fonts ?? []).filter(font => work.code!.includes(font.family)).map(async font => ({ family: font.family, weight: font.weight, data: (await download(font.url, signal)).data.toString('base64') })));
  const media = await Promise.all((brand?.screens ?? []).map(async screen => { const file = await download(screen.url, signal); return { name: screen.name, type: file.type, data: file.data.toString('base64') }; }));
  const { width, height } = work;
  const frame = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data: blob:"><style>html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:transparent}body{font-family:Arial,sans-serif;-webkit-font-smoothing:antialiased}#scene-root{position:absolute;inset:0;overflow:hidden}</style></head><body><div id="scene-root"></div>${scripts.join('')}</body></html>`;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    signal.throwIfAborted();
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#000"><iframe id="f" sandbox="allow-scripts" style="border:0;width:${width}px;height:${height}px"></iframe></body></html>`);
    // tsx/esbuild wrap named functions in __name(); define it where the evaluated code runs.
    await page.evaluate('globalThis.__name = fn => fn');
    const error = await page.evaluate(({ frame, code, brand, fonts, media, icons, width, height }) => new Promise<string | null>(resolve => {
      const target = document.getElementById('f') as HTMLIFrameElement, bytes = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
      const send = (message: object) => target.contentWindow!.postMessage({ source: 'revline-scene-host', ...message }, '*');
      window.addEventListener('message', event => {
        const data = event.data; if (data?.source !== 'revline-scene') return;
        if (data.type === 'ready') send({ type: 'init', code, brand, width, height, fps: 30, duration: 1, icons, fonts: fonts.map(font => ({ family: font.family, weight: font.weight, data: bytes(font.data) })), media: media.map(item => ({ name: item.name, type: item.type, data: bytes(item.data) })) });
        else if (data.type === 'compiled') send({ type: 'seek', time: 0, seq: 1 });
        else if (data.type === 'painted') resolve(null);
        else if (data.type === 'error') resolve(String(data.message));
      });
      setTimeout(() => resolve('The blueprint did not finish drawing in 30 seconds.'), 30_000);
      target.srcdoc = frame;
    }), { frame, code: work.code, brand: work.brand, fonts, media, icons, width, height });
    if (error) throw new AnalysisError(`The blueprint code failed: ${error}`.slice(0, 600), 400);
    await new Promise(resolve => setTimeout(resolve, 150));
    const image = Buffer.from(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } }));
    const scene = page.frames().find(item => item !== page.mainFrame());
    if (scene) await scene.evaluate('globalThis.__name = fn => fn');
    const parts = scene ? await scene.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-part]')].map(element => { const box = element.getBoundingClientRect(); return { name: element.dataset.part!, x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) }; }).filter(part => part.width > 0 && part.height > 0)) : [];
    return { image, parts: parts.slice(0, 300) };
  } finally { await browser.close(); }
}

/** Share of matching pixels and the mean luminance difference inside a box. */
function scoreBox(diff: Uint8Array, width: number, x0: number, y0: number, w: number, h: number) {
  let match = 0, sum = 0, count = 0;
  for (let y = Math.max(0, y0); y < y0 + h && y < diff.length / width; y++) for (let x = Math.max(0, x0); x < x0 + w && x < width; x++) { const value = diff[y * width + x]; sum += value; if (value <= TOLERANCE) match++; count++; }
  return count ? { score: Math.round(match / count * 1000) / 10, meanDiff: Math.round(sum / count * 100) / 100 } : null;
}

const jpeg = async (pixels: Pixels | Buffer, maxWidth: number, quality: number) => (Buffer.isBuffer(pixels) ? sharp(pixels) : sharp(pixels.data, { raw: { width: pixels.width, height: pixels.height, channels: 3 } })).resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality }).toBuffer();

export async function runBlueprintCheck(work: Work, signal: AbortSignal, onProgress: (percent: number) => void): Promise<Result> {
  if (work.mode === 'measure') {
    if (!work.screenUrl) throw new AnalysisError('Measuring needs a kit screen.', 400);
    const screen = await pixelsOf((await download(work.screenUrl, signal)).data);
    onProgress(80);
    return { width: screen.width, height: screen.height, ...measure(screen, work) };
  }
  const { image, parts } = await render(work, signal);
  onProgress(60);
  if (work.mode === 'render' || !work.screenUrl) return { width: work.width, height: work.height, image: (await jpeg(image, 1280, 82)).toString('base64'), parts };
  // Compare at the render's size; a screen of another size is scaled to it first.
  const rendered = await pixelsOf(image), screen = await pixelsOf((await download(work.screenUrl, signal)).data, rendered.width, rendered.height);
  const { width, height } = rendered, diff = new Uint8Array(width * height), marked = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const r = Math.abs(rendered.data[i * 3] - screen.data[i * 3]), g = Math.abs(rendered.data[i * 3 + 1] - screen.data[i * 3 + 1]), b = Math.abs(rendered.data[i * 3 + 2] - screen.data[i * 3 + 2]);
    const value = Math.round(.299 * r + .587 * g + .114 * b); diff[i] = value;
    // The diff image: the render dimmed, mismatching pixels in red.
    if (value > TOLERANCE) { marked[i * 3] = 255; marked[i * 3 + 1] = 40; marked[i * 3 + 2] = 40; }
    else for (let c = 0; c < 3; c++) marked[i * 3 + c] = Math.round(rendered.data[i * 3 + c] * .35);
  }
  const whole = scoreBox(diff, width, 0, 0, width, height)!;
  const scored = parts.map(part => ({ ...part, score: scoreBox(diff, width, part.x, part.y, part.width, part.height)?.score ?? 100 }));
  // The worst cells of an 8x8 grid tell the agent where to look next.
  const cell = { width: Math.ceil(width / 8), height: Math.ceil(height / 8) }, regions = [];
  for (let row = 0; row < 8; row++) for (let column = 0; column < 8; column++) { const box = { x: column * cell.width, y: row * cell.height, width: cell.width, height: cell.height }; const result = scoreBox(diff, width, box.x, box.y, box.width, box.height); if (result && result.score < 99) regions.push({ ...box, score: result.score }); }
  regions.sort((a, b) => a.score - b.score);
  onProgress(85);
  return { width, height, score: whole.score, meanDiff: whole.meanDiff, parts: scored, regions: regions.slice(0, 6), image: (await jpeg(image, 1280, 80)).toString('base64'), diff: (await jpeg({ data: marked, width, height }, 1024, 72)).toString('base64') };
}
