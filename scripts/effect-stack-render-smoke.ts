import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { generateComposition } from '../lib/editor/composition';
import { NEUTRAL_MOTION } from '../lib/editor/clip-effects';
import { runRenderWorker } from '../lib/server/render-worker';
import type { Timeline } from '../lib/editor/types';

async function main() {
  const sharp = createRequire(join(process.cwd(),'package.json'))('sharp');
  const directory = await mkdtemp(join(tmpdir(), 'revline-effect-stack-render-'));
  const server = createServer(async (request, response) => {
    const name = new URL(request.url!, 'http://127.0.0.1').pathname.slice(1) || 'index.html';
    if (!['index.html', 'source.mp4', 'visual-effects.js', 'remotion-text.js', 'gsap.min.js', 'font.woff2'].includes(name)) { response.writeHead(404).end(); return; }
    const body = await readFile(join(directory, name));
    const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range ?? '');
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Number(range[2]) : body.length - 1;
    response.writeHead(range ? 206 : 200, { 'Content-Type': name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.js') ? 'text/javascript' : name.endsWith('.woff2') ? 'font/woff2' : 'text/html', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${body.length}` } : {}) });
    response.end(body.subarray(start, end + 1));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=768'] });
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=gray:size=320x180:rate=24', '-t', '1', '-threads', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(directory, 'source.mp4')]);
    for (const name of ['gsap.min.js', 'visual-effects.js', 'remotion-text.js']) await copyFile('public/vendor/' + name, join(directory, name));
    await copyFile('public/fonts/space-grotesk-latin.woff2', join(directory, 'font.woff2'));
    const timeline: Timeline = { fps: 24, aspectRatio: 'landscape', tracks: { visual: 1, overlay: 0, audio: 0, effects: 2 }, clips: [
      { id: 'base', kind: 'video', assetId: 'source', track: 1, start: 0, duration: 1, sourceStart: 0, volume: 0, dither: { enabled: true, amount: 1, levels: 2, size: 8 } },
      ...[1, 2].map(track => ({ id: 'blur-' + track, kind: 'effect' as const, effectPreset: 'zoom-blur' as const, track, start: 0, duration: 1, sourceStart: 0, zoomBlur: { enabled: true, amount: .15, centerX: .5, centerY: .5 }, motion: [0, 1].map(time => ({ time, ...NEUTRAL_MOTION })) })),
    ] };
    await writeFile(join(directory, 'index.html'), generateComposition(timeline, [{ _id: 'source', kind: 'video', fileName: 'Owned gray video', width: 320, height: 180, url: './source.mp4' }], { resolution: 720, gsapUrl: './gsap.min.js', visualEffectsUrl: './visual-effects.js', remotionTextUrl: './remotion-text.js', fontUrl: './font.woff2' }));
    const page = await browser.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error instanceof Error?error.message:String(error))); await page.setViewport({ width: 1280, height: 720 });
    await page.goto('http://127.0.0.1:' + (server.address() as { port: number }).port, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.visual-effect-output');
    await page.evaluate(() => { const host = window as unknown as { __timelines: { revline: { seek(time: number): void } }; __revlineEffects: { redraw(): void } }; host.__timelines.revline.seek(.5); host.__revlineEffects.redraw(); });
    const preview: Buffer = await sharp(await (await page.$('.visual-effect-output'))!.screenshot()).removeAlpha().raw().toBuffer();
    assert.deepEqual(errors, []); await browser.close();
    const output = join(directory, 'output.mp4');
    const result = await runRenderWorker(directory, output, { fps: 24, quality: 'high' }, () => {}, AbortSignal.timeout(90_000));
    assert.equal(result.warnings, 0);
    const exported = execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 4 * 1024 * 1024 });
    assert.equal(exported.length, preview.length);
    let difference = 0;
    for (let index = 0; index < exported.length; index++) difference += Math.abs(exported[index] - preview[index]);
    const meanError = difference / exported.length;
    assert.ok(meanError < 12, 'MP4 must match the sequential two-blur output; mean RGB error ' + meanError.toFixed(2));
    console.log('PASS: actual 720p MP4 applies Dither then two ordered FX blur passes; full-frame browser/export mean RGB error ' + meanError.toFixed(2) + ', no render warnings. Owned synthetic source only.');
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
